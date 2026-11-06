import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createBoardRequestHandler } from "./board-server.mjs";
import {
  buildPlanningContext,
  buildPlanningCoverage,
  queryCurrentSessionPlan,
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
import { resolveWorkspaceContext, WorkspaceDiscoveryError } from "./workspace-root.mjs";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const serverByInstance = new Map();

function createRuntime(workspaceRoot, config) {
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
    const plan = await queryCurrentSessionPlan(copilotSession, context);
    return {
      contextGeneratedAt: context.generatedAt,
      boardSnapshotAt: context.boardSnapshotAt,
      coverage: buildPlanningCoverage(context),
      plan,
    };
  }

  return {
    workspaceRoot,
    config,
    loadBoard,
    getPlanningContext,
    requestNextWork,
    moveTask: (input) => runStorageOperation(() => moveTaskInDocuments(workspaceRoot, config, input)),
    createTask: (input) => runStorageOperation(() => createTaskInDocuments(workspaceRoot, config, input)),
    editTask: (input) => runStorageOperation(() => editTaskInDocuments(workspaceRoot, config, input)),
    deleteTask: (input) => runStorageOperation(() => deleteTaskInDocuments(workspaceRoot, config, input)),
  };
}

const taskIdSchema = { type: "string", pattern: "^[A-Z][A-Z0-9]*-\\d+$" };
const revisionsSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: { type: "string", pattern: "^[a-f0-9]{64}$" },
};
const taskDraftSchema = {
  type: "object",
  additionalProperties: true,
  required: ["title", "area", "priority", "status", "details"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    area: { type: "string", minLength: 1, maxLength: 100 },
    priority: { type: "string", maxLength: 60 },
    status: { type: "string", maxLength: 60 },
    details: { type: "string", maxLength: 5000 },
  },
};
const editableProperties = {
  title: { type: "string", minLength: 1, maxLength: 200 },
  status: { type: "string", maxLength: 60 },
  priority: { type: "string", maxLength: 60 },
  area: { type: "string", minLength: 1, maxLength: 100 },
  category: { type: "string", minLength: 1, maxLength: 100 },
  details: { type: "string", maxLength: 5000 },
};

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

function getRuntime(context) {
  const record = serverByInstance.get(getInstanceKey(context));
  if (!record) {
    throw new CanvasError("board_instance_unavailable", "Open the canvas before invoking an action.");
  }
  return record.runtime;
}

function invokeWithRuntime(context, operation) {
  return operation(getRuntime(context), context.input);
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
  displayName: "Project Kanban",
  description: "Shows Markdown-backed project tasks grouped by configured status, priority, and category.",
  actions: [
    {
      name: "refreshBoard",
      description: "Re-read configured Markdown sources and return the current Kanban cards.",
      handler: (context) => invokeWithRuntime(context, (runtime) => runtime.loadBoard()),
    },
    {
      name: "moveTask",
      description: "Move a task to a configured status and order.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "status", "order", "revisions"],
        properties: {
          taskId: taskIdSchema,
          status: { type: "string", maxLength: 60 },
          order: { type: "number", minimum: 0 },
          revisions: revisionsSchema,
        },
      },
      handler: (context) => invokeWithRuntime(context, (runtime, input) => runtime.moveTask(input)),
    },
    {
      name: "createTask",
      description: "Create a task in one of the configured Markdown sources.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "task", "revisions"],
        properties: {
          sourceType: { type: "string", maxLength: 64 },
          task: taskDraftSchema,
          revisions: revisionsSchema,
        },
      },
      handler: (context) => invokeWithRuntime(context, (runtime, input) => runtime.createTask(input)),
    },
    {
      name: "editTask",
      description: "Edit an existing task's configured fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "updates", "revisions"],
        properties: {
          taskId: taskIdSchema,
          updates: {
            type: "object",
            minProperties: 1,
            additionalProperties: true,
            properties: editableProperties,
          },
          revisions: revisionsSchema,
        },
      },
      handler: (context) => invokeWithRuntime(context, (runtime, input) => runtime.editTask(input)),
    },
    {
      name: "deleteTask",
      description: "Delete a task row from its Markdown source after explicit confirmation.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "confirmed", "revisions"],
        properties: {
          taskId: taskIdSchema,
          confirmed: { const: true },
          revisions: revisionsSchema,
        },
      },
      handler: (context) => invokeWithRuntime(context, (runtime, input) => runtime.deleteTask(input)),
    },
  ],
  open: async (context) => {
    const key = getInstanceKey(context);
    let record = serverByInstance.get(key);

    if (!record || !record.server.listening) {
      let workspace;
      try {
        workspace = await resolveWorkspaceContext({
          hostWorkingDirectory: context.session?.workingDirectory,
          extensionDirectory,
        });
      } catch (error) {
        if (error instanceof WorkspaceDiscoveryError) throw new CanvasError(error.code, error.message);
        throw error;
      }
      const runtime = createRuntime(workspace.workspaceRoot, workspace.config);
      await runtime.loadBoard();
      const handler = await createBoardRequestHandler({
        loadBoard: runtime.loadBoard,
        moveTask: runtime.moveTask,
        createTask: runtime.createTask,
        editTask: runtime.editTask,
        deleteTask: runtime.deleteTask,
        getPlanningContext: () => runtime.getPlanningContext(),
        requestNextWork: runtime.requestNextWork,
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
      record = { server, port: address.port, runtime };
      serverByInstance.set(key, record);
    } else {
      await record.runtime.loadBoard();
    }

    return {
      url: `http://127.0.0.1:${record.port}/`,
      title: record.runtime.config.boardTitle,
      status: `${record.runtime.config.projectName} task board loaded.`,
    };
  },
  onClose: closeInstance,
});

const copilotSession = await joinSession({ canvases: [kanbanCanvas] });
