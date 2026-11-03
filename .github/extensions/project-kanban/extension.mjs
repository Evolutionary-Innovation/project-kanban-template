import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { readBoardConfig } from "./board-config.mjs";
import { createBoardRequestHandler } from "./board-server.mjs";
import {
  buildNextWorkPrompt,
  buildPlanningContext,
  buildPlanningCoverage,
  parsePlanningAnswer,
  PlanningError,
  readPlanningDocuments,
} from "./planning-context.mjs";
import {
  BoardStorageError,
  createTaskInDocuments,
  deleteTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
} from "./board-storage.mjs";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverByInstance = new Map();
let config;

try {
  config = await readBoardConfig(workspaceRoot);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown project config error.";
  throw new CanvasError("board_config_invalid", message);
}

async function loadBoard() {
  try {
    return await readBoardSnapshot(workspaceRoot, config);
  } catch (error) {
    if (error instanceof BoardStorageError) throw new CanvasError(error.code, error.message);
    throw error;
  }
}

async function runStorageOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BoardStorageError) throw new CanvasError(error.code, error.message);
    throw error;
  }
}

async function getPlanningContext(currentView) {
  const [board, documents] = await Promise.all([
    loadBoard(),
    readPlanningDocuments(workspaceRoot),
  ]);
  return buildPlanningContext({ board, documents, currentView });
}

async function requestNextWork(currentView) {
  const context = await getPlanningContext(currentView);
  const ui = copilotSession.rpc?.ui;
  if (typeof ui?.ephemeralQuery !== "function") {
    throw new PlanningError(
      "planning_unavailable",
      "The current Copilot host does not support transient planning queries.",
    );
  }

  const result = await ui.ephemeralQuery({ question: buildNextWorkPrompt(context) });
  const plan = parsePlanningAnswer(result?.answer, context);
  return {
    contextGeneratedAt: context.generatedAt,
    boardSnapshotAt: context.boardSnapshotAt,
    coverage: buildPlanningCoverage(context),
    plan,
  };
}

const moveTask = (input) =>
  runStorageOperation(() => moveTaskInDocuments(workspaceRoot, config, input));
const createTask = (input) =>
  runStorageOperation(() => createTaskInDocuments(workspaceRoot, config, input));
const editTask = (input) =>
  runStorageOperation(() => editTaskInDocuments(workspaceRoot, config, input));
const deleteTask = (input) =>
  runStorageOperation(() => deleteTaskInDocuments(workspaceRoot, config, input));

const revisionPaths = config.sources.map(({ path }) => path);
const revisionSchema = {
  type: "object",
  additionalProperties: false,
  required: revisionPaths,
  properties: Object.fromEntries(revisionPaths.map((path) => [path, { type: "string", pattern: "^[a-f0-9]{64}$" }])),
};
const taskDraftSchemas = config.sources.map((source) => {
  const extraProperties = Object.fromEntries(
    source.extraFields.map((field) => [
      field.key,
      {
        type: "string",
        ...(field.required ? { minLength: 1 } : {}),
        maxLength: field.maxLength,
      },
    ]),
  );
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "area", "priority", "status", "details", ...source.extraFields.map(({ key }) => key)],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      area: { type: "string", minLength: 1, maxLength: 100 },
      priority: { type: "string", enum: config.priorities.map(({ name }) => name) },
      status: { type: "string", enum: config.statuses },
      details: { type: "string", maxLength: 5000 },
      ...extraProperties,
    },
  };
});
const editableProperties = Object.fromEntries([
  ["title", { type: "string", minLength: 1, maxLength: 200 }],
  ["status", { type: "string", enum: config.statuses }],
  ["priority", { type: "string", enum: config.priorities.map(({ name }) => name) }],
  ["area", { type: "string", minLength: 1, maxLength: 100 }],
  ["category", { type: "string", minLength: 1, maxLength: 100 }],
  ["details", { type: "string", maxLength: 5000 }],
  ...config.sources.flatMap((source) =>
    source.extraFields.map((field) => [
      field.key,
      {
        type: "string",
        ...(field.required ? { minLength: 1 } : {}),
        maxLength: field.maxLength,
      },
    ]),
  ),
]);
const taskIdPattern = `^(${config.sources.flatMap(({ idPrefix, idWidth, legacyIdPrefixes }) => [
  `${idPrefix}-\\d{${idWidth},}`,
  ...legacyIdPrefixes.map((prefix) => `${prefix}-\\d{2,6}`),
]).join("|")})$`;

function getInstanceKey(context) {
  if (
    typeof context.sessionId !== "string" ||
    context.sessionId.length === 0 ||
    typeof context.instanceId !== "string" ||
    context.instanceId.length === 0 ||
    context.instanceId.length > 128
  ) {
    throw new CanvasError("board_instance_invalid", "A valid session and canvas instance ID are required.");
  }
  return `${context.sessionId}\u0000${context.instanceId}`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

async function closeInstance(context) {
  const key = getInstanceKey(context);
  const record = serverByInstance.get(key);
  if (!record) return;

  serverByInstance.delete(key);
  const closed = new Promise((resolve, reject) => {
    record.server.close((error) => {
      if (error) {
        reject(new CanvasError("board_server_close_failed", `Unable to stop the board server: ${error.message}`));
      } else {
        resolve();
      }
    });
  });
  record.server.closeAllConnections?.();
  await closed;
}

const kanbanCanvas = createCanvas({
  id: "project-kanban-template",
  displayName: config.boardTitle,
  description: "Shows Markdown-backed project tasks grouped by configured status, priority, and category.",
  actions: [
    {
      name: "refreshBoard",
      description: "Re-read configured Markdown sources and return the current Kanban cards.",
      handler: loadBoard,
    },
    {
      name: "moveTask",
      description: "Move a task to a configured status and order.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "status", "order", "revisions"],
        properties: {
          taskId: { type: "string", pattern: taskIdPattern },
          status: { type: "string", enum: config.statuses },
          order: { type: "number", minimum: 0 },
          revisions: revisionSchema,
        },
      },
      handler: ({ input }) => moveTask(input),
    },
    {
      name: "createTask",
      description: "Create a task in one of the configured Markdown sources.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "task", "revisions"],
        properties: {
          sourceType: { type: "string", enum: config.sources.map(({ key }) => key) },
          task: { anyOf: taskDraftSchemas },
          revisions: revisionSchema,
        },
      },
      handler: ({ input }) => createTask(input),
    },
    {
      name: "editTask",
      description: "Edit an existing task's configured fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "updates", "revisions"],
        properties: {
          taskId: { type: "string", pattern: taskIdPattern },
          updates: {
            type: "object",
            minProperties: 1,
            additionalProperties: false,
            properties: editableProperties,
          },
          revisions: revisionSchema,
        },
      },
      handler: ({ input }) => editTask(input),
    },
    {
      name: "deleteTask",
      description: "Delete a task row from its Markdown source after explicit confirmation.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "confirmed", "revisions"],
        properties: {
          taskId: { type: "string", pattern: taskIdPattern },
          confirmed: { const: true },
          revisions: revisionSchema,
        },
      },
      handler: ({ input }) => deleteTask(input),
    },
  ],
  open: async (context) => {
    await loadBoard();
    const key = getInstanceKey(context);
    let record = serverByInstance.get(key);

    if (!record || !record.server.listening) {
      const handler = await createBoardRequestHandler({
        loadBoard,
        moveTask,
        createTask,
        editTask,
        deleteTask,
        getPlanningContext: () => getPlanningContext(),
        requestNextWork,
      });
      const server = createServer(handler);
      try {
        await listen(server);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown server error.";
        throw new CanvasError("board_server_start_failed", `Unable to start the board server: ${message}`);
      }

      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        throw new CanvasError("board_server_address_unavailable", "The board server did not receive a local address.");
      }
      record = { server, port: address.port };
      serverByInstance.set(key, record);
    }

    return {
      url: `http://127.0.0.1:${record.port}/`,
      title: config.boardTitle,
      status: `${config.projectName} task board loaded.`,
    };
  },
  onClose: closeInstance,
});

await joinSession({ canvases: [kanbanCanvas] });
