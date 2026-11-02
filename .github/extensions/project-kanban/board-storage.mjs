import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, mkdir, stat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  allocateTaskId,
  appendTaskRecord,
  deleteTaskRecord,
  ensureTaskIdSequence,
  hasCanonicalTaskTable,
  isValidDateOnly,
  migrateLegacyMarkdown,
  nextTaskOrder,
  normalizeConfiguredTaskTable,
  parseBoardDocuments,
  updateTaskRecord,
  validateTaskDraft,
} from "./board-data.mjs";
import {
  findIntroducedDependencyCycle,
  parseDependencyIds,
} from "./board-dependencies.mjs";

const LOCK_DIRECTORY = ".github/extensions/project-kanban";

export class BoardStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BoardStorageError";
    this.code = code;
  }
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function sourcePath(workspaceRoot, source) {
  const root = resolve(workspaceRoot);
  const lexicalTarget = resolve(root, source.path);
  const lexicalRel = relative(root, lexicalTarget);
  if (isAbsolute(source.path) || lexicalRel.startsWith("..") || isAbsolute(lexicalRel)) {
    throw new BoardStorageError("board_source_invalid", `Source path "${source.path}" is outside the workspace.`);
  }
  const [canonicalRoot, target] = await Promise.all([realpath(root), realpath(lexicalTarget)]);
  const rel = relative(canonicalRoot, target);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new BoardStorageError("board_source_invalid", `Source path "${source.path}" resolves outside the workspace.`);
  }
  return target;
}

async function readDocuments(workspaceRoot, config) {
  const documents = {};
  for (const source of config.sources) {
    try {
      documents[source.path] = await readFile(await sourcePath(workspaceRoot, source), "utf8");
    } catch (error) {
      if (error instanceof BoardStorageError) throw error;
      const code = error instanceof Error && "code" in error ? error.code : "unknown";
      throw new BoardStorageError("board_source_unavailable", `Unable to read ${source.path} (${code}).`);
    }
  }
  return documents;
}

export async function readBoardSnapshot(workspaceRoot, config) {
  const documents = await readDocuments(workspaceRoot, config);
  let board;
  try {
    board = parseBoardDocuments(documents, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parsing error.";
    throw new BoardStorageError("board_source_invalid", `Unable to build the board from Markdown: ${message}`);
  }
  return {
    ...board,
    revisions: Object.fromEntries(
      Object.entries(documents).map(([path, contents]) => [path, hash(contents)]),
    ),
    generatedAt: new Date().toISOString(),
  };
}

function requireObject(input, label, keys) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BoardStorageError("board_input_invalid", `${label} must be an object.`);
  }
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new BoardStorageError("board_input_invalid", `${label} must contain exactly: ${keys.join(", ")}.`);
  }
}

function validateRevisions(revisions, config) {
  if (!revisions || typeof revisions !== "object" || Array.isArray(revisions)) {
    throw new BoardStorageError("board_input_invalid", "Expected document revisions are required.");
  }
  const expectedPaths = config.sources.map(({ path }) => path).sort();
  const actualPaths = Object.keys(revisions).sort();
  if (
    expectedPaths.join("\n") !== actualPaths.join("\n") ||
    Object.values(revisions).some((revision) => typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
  ) {
    throw new BoardStorageError("board_input_invalid", "Document revisions are incomplete or invalid.");
  }
}

function validateTaskId(taskId, config) {
  if (
    typeof taskId !== "string" ||
    !config.sources.some((source) => {
      const patterns = [
        `${source.idPrefix}-\\d{${source.idWidth},}`,
        ...source.legacyIdPrefixes.map((prefix) => `${prefix}-\\d{2,6}`),
      ];
      return new RegExp(`^(?:${patterns.join("|")})$`).test(taskId);
    })
  ) {
    throw new BoardStorageError("board_input_invalid", "A valid configured task ID is required.");
  }
}

function validateMoveRequest(input, config) {
  requireObject(input, "A task move", ["taskId", "status", "order", "revisions"]);
  validateTaskId(input.taskId, config);
  if (!config.statuses.includes(input.status)) {
    throw new BoardStorageError("board_input_invalid", "The requested Status is not supported.");
  }
  if (!Number.isSafeInteger(input.order) || input.order < 0) {
    throw new BoardStorageError("board_input_invalid", "Order must be a non-negative safe integer.");
  }
  validateRevisions(input.revisions, config);
}

function validateCreateRequest(input, config) {
  requireObject(input, "A task creation request", ["sourceType", "task", "revisions"]);
  if (!config.sources.some(({ key }) => key === input.sourceType)) {
    throw new BoardStorageError("board_input_invalid", "A supported task source is required.");
  }
  validateRevisions(input.revisions, config);
  try {
    return validateTaskDraft(input.sourceType, input.task, config);
  } catch (error) {
    throw new BoardStorageError("board_input_invalid", error instanceof Error ? error.message : "Invalid task fields.");
  }
}

function validateEditRequest(input, config) {
  requireObject(input, "A task edit", ["taskId", "updates", "revisions"]);
  validateTaskId(input.taskId, config);
  validateRevisions(input.revisions, config);
  if (!input.updates || typeof input.updates !== "object" || Array.isArray(input.updates)) {
    throw new BoardStorageError("board_input_invalid", "Task updates must be an object.");
  }
  const allowedFields = new Set([
    "title",
    "status",
    "priority",
    "area",
    "category",
    "details",
    ...config.sources.flatMap((source) => source.extraFields.map(({ key }) => key)),
  ]);
  const fields = Object.keys(input.updates);
  if (fields.length === 0 || fields.some((field) => !allowedFields.has(field))) {
    throw new BoardStorageError("board_input_invalid", "Task edits contain no editable fields or include an unsupported field.");
  }
  for (const [field, value] of Object.entries(input.updates)) {
    if (field === "status" && !config.statuses.includes(value)) {
      throw new BoardStorageError("board_input_invalid", "The requested Status is not supported.");
    }
    if (field === "priority" && !config.priorities.some(({ name }) => name === value)) {
      throw new BoardStorageError("board_input_invalid", "The requested Priority is not supported.");
    }
    if (field !== "status" && field !== "priority" && typeof value !== "string") {
      throw new BoardStorageError("board_input_invalid", `${field} must be a string.`);
    }
    const dateField = config.sources
      .flatMap(({ extraFields }) => extraFields)
      .find(({ key, type }) => key === field && type === "date");
    if (dateField && value !== "" && !isValidDateOnly(value)) {
      throw new BoardStorageError(
        "board_input_invalid",
        `${dateField.label} must be a valid YYYY-MM-DD date.`,
      );
    }
    const fieldConfig = config.sources
      .flatMap(({ extraFields }) => extraFields)
      .find(({ key }) => key === field);
    if (
      fieldConfig &&
      ((fieldConfig.required && value.trim() === "") ||
        value.length > fieldConfig.maxLength ||
        (fieldConfig.choices && value !== "" && !fieldConfig.choices.includes(value)))
    ) {
      throw new BoardStorageError("board_input_invalid", `${fieldConfig.label} is empty, unsupported, or too long.`);
    }
    if (fieldConfig?.type === "task-ids") {
      try {
        parseDependencyIds(value, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid dependency references.";
        throw new BoardStorageError("board_input_invalid", message);
      }
    }
  }
}

function validateDeleteRequest(input, config) {
  requireObject(input, "A task deletion", ["taskId", "confirmed", "revisions"]);
  validateTaskId(input.taskId, config);
  if (input.confirmed !== true) {
    throw new BoardStorageError("board_input_invalid", "Task deletion requires explicit confirmation.");
  }
  validateRevisions(input.revisions, config);
}

async function writeAtomically(targetPath, contents) {
  const temporaryPath = join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    const targetMode = (await stat(targetPath)).mode & 0o777;
    handle = await open(temporaryPath, "wx", targetMode);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close();
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
        throw new BoardStorageError("board_write_cleanup_failed", `Unable to clean up a temporary write for ${targetPath}.`);
      }
    }
    const message = error instanceof Error ? error.message : "Unknown file error.";
    throw new BoardStorageError("board_write_failed", `Unable to update ${targetPath}: ${message}`);
  }
}

async function withLockedDocuments(workspaceRoot, config, revisions, mutate) {
  const lockPath = join(workspaceRoot, LOCK_DIRECTORY, ".kanban-write.lock");
  await mkdir(dirname(lockPath), { recursive: true });

  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${process.pid}\n`, "utf8");
    await lock.sync();
  } catch (error) {
    if (lock) await lock.close();
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new BoardStorageError("board_write_busy", "Another board edit is in progress. Refresh the board and retry.");
    }
    const message = error instanceof Error ? error.message : "Unknown lock error.";
    throw new BoardStorageError("board_write_lock_failed", `Unable to lock the task documents: ${message}`);
  }

  try {
    const documents = await readDocuments(workspaceRoot, config);
    const currentRevisions = Object.fromEntries(
      Object.entries(documents).map(([path, contents]) => [path, hash(contents)]),
    );
    for (const source of config.sources) {
      if (currentRevisions[source.path] !== revisions[source.path]) {
        throw new BoardStorageError(
          "board_revision_conflict",
          "A source document changed since this board was loaded. Refresh before editing tasks.",
        );
      }
    }

    let board;
    try {
      board = parseBoardDocuments(documents, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parsing error.";
      throw new BoardStorageError("board_source_invalid", `Unable to build the board from Markdown: ${message}`);
    }

    const { source, markdown } = await mutate(documents, board);
    await writeAtomically(await sourcePath(workspaceRoot, source), markdown);
    return await readBoardSnapshot(workspaceRoot, config);
  } finally {
    await lock.close();
    try {
      await unlink(lockPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown lock cleanup error.";
      throw new BoardStorageError("board_write_lock_cleanup_failed", `Unable to remove the board write lock: ${message}`);
    }
  }
}

function canonicalMarkdown(documents, board, source, config) {
  const markdown = documents[source.path];
  let canonical = markdown;
  const tasks = board.tasks.filter(({ source: taskSource }) => taskSource.document === source.path);
  if (!hasCanonicalTaskTable(markdown, source, config)) {
    try {
      canonical = migrateLegacyMarkdown(markdown, source, tasks, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown migration error.";
      throw new BoardStorageError("board_migration_failed", `Unable to migrate ${source.path}: ${message}`);
    }
  }
  try {
    canonical = normalizeConfiguredTaskTable(canonical, source, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown schema normalization error.";
    throw new BoardStorageError(
      "board_schema_normalization_failed",
      `Unable to normalize ${source.path}: ${message}`,
    );
  }
  try {
    return ensureTaskIdSequence(canonical, tasks, source, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown task ID sequence error.";
    throw new BoardStorageError("board_id_sequence_invalid", `Unable to initialize task IDs for ${source.path}: ${message}`);
  }
}

function findTask(board, taskId, config) {
  const task = board.tasks.find(({ id }) => id === taskId);
  if (!task) throw new BoardStorageError("board_task_not_found", `Task "${taskId}" no longer exists.`);
  const source = config.sources.find(({ path }) => path === task.source.document);
  if (!source) throw new BoardStorageError("board_source_invalid", `Task "${task.id}" has an unsupported source document.`);
  return { task, source };
}

function currentDateOnly() {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function completionDateFor(task, status, source, config) {
  if (
    status !== config.completionStatus ||
    task.status === status ||
    !source.extraFields.some(({ key, type }) => key === "completionDate" && type === "date")
  ) {
    return null;
  }
  return currentDateOnly();
}

function validateDependencyChanges(task, updates, board, config) {
  if (!Object.hasOwn(updates, "dependsOn")) return;
  let previousIds;
  let nextIds;
  try {
    previousIds = parseDependencyIds(task.dependsOn ?? "", config);
    nextIds = parseDependencyIds(updates.dependsOn, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid dependency references.";
    throw new BoardStorageError("board_input_invalid", message);
  }
  if (nextIds.includes(task.id)) {
    throw new BoardStorageError("board_input_invalid", "A task cannot depend on itself.");
  }
  const candidateTasks = board.tasks.map((candidate) =>
    candidate.id === task.id
      ? { ...candidate, ...updates, dependsOn: nextIds.join(", ") }
      : candidate,
  );
  const cycle = findIntroducedDependencyCycle(task.id, previousIds, nextIds, candidateTasks, config);
  if (cycle) {
    throw new BoardStorageError(
      "board_dependency_cycle",
      `This dependency would create a cycle: ${cycle.join(" -> ")}.`,
    );
  }
}

export async function moveTaskInDocuments(workspaceRoot, config, input) {
  validateMoveRequest(input, config);
  return withLockedDocuments(workspaceRoot, config, input.revisions, (documents, board) => {
    const { task, source } = findTask(board, input.taskId, config);
    const markdown = canonicalMarkdown(documents, board, source, config);
    const completionDate = completionDateFor(task, input.status, source, config);
    const updates = { status: input.status, order: input.order };
    if (completionDate) updates.completionDate = completionDate;
    try {
      return {
        source,
        markdown: updateTaskRecord(markdown, task.id, updates, source, config),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown row update error.";
      throw new BoardStorageError("board_task_update_failed", `Unable to move ${task.id}: ${message}`);
    }
  });
}

export async function createTaskInDocuments(workspaceRoot, config, input) {
  const draft = validateCreateRequest(input, config);
  const source = config.sources.find(({ key }) => key === input.sourceType);
  return withLockedDocuments(workspaceRoot, config, input.revisions, (documents, board) => {
    const markdown = canonicalMarkdown(documents, board, source, config);
    if (
      source.extraFields.some(({ key, type }) => key === "createdDate" && type === "date") &&
      !draft.createdDate
    ) {
      draft.createdDate = currentDateOnly();
    }
    if (config.completionStatus === draft.status && !draft.completionDate) {
      draft.completionDate = currentDateOnly();
    }
    const task = {
      ...draft,
      id: allocateTaskId(source.key, board.tasks, config, markdown),
      order: nextTaskOrder(board.tasks, draft.status),
    };
    if (task.dependsOn) {
      if (parseDependencyIds(task.dependsOn, config).includes(task.id)) {
        throw new BoardStorageError("board_input_invalid", "A task cannot depend on itself.");
      }
      const cycle = findIntroducedDependencyCycle(task.id, [], parseDependencyIds(task.dependsOn, config), [
        ...board.tasks,
        task,
      ], config);
      if (cycle) {
        throw new BoardStorageError(
          "board_dependency_cycle",
          `This dependency would create a cycle: ${cycle.join(" -> ")}.`,
        );
      }
    }
    try {
      return { source, markdown: appendTaskRecord(markdown, task, source, config) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown task creation error.";
      throw new BoardStorageError("board_task_create_failed", `Unable to create ${task.id}: ${message}`);
    }
  });
}

export async function editTaskInDocuments(workspaceRoot, config, input) {
  validateEditRequest(input, config);
  return withLockedDocuments(workspaceRoot, config, input.revisions, (documents, board) => {
    const { task, source } = findTask(board, input.taskId, config);
    const sourceFields = new Set([
      "title",
      "status",
      "priority",
      "area",
      "category",
      "details",
      ...source.extraFields.map(({ key }) => key),
    ]);
    if (Object.keys(input.updates).some((field) => !sourceFields.has(field))) {
      throw new BoardStorageError("board_input_invalid", "The edit includes a field that is not configured for this task source.");
    }
    validateDependencyChanges(task, input.updates, board, config);
    const markdown = canonicalMarkdown(documents, board, source, config);
    const completionDate = input.updates.completionDate === undefined
      ? completionDateFor(task, input.updates.status, source, config)
      : null;
    const updates = completionDate
      ? { ...input.updates, completionDate }
      : input.updates;
    try {
      return {
        source,
        markdown: updateTaskRecord(markdown, task.id, updates, source, config),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown row update error.";
      throw new BoardStorageError("board_task_update_failed", `Unable to edit ${task.id}: ${message}`);
    }
  });
}

export async function deleteTaskInDocuments(workspaceRoot, config, input) {
  validateDeleteRequest(input, config);
  return withLockedDocuments(workspaceRoot, config, input.revisions, (documents, board) => {
    const { task, source } = findTask(board, input.taskId, config);
    const markdown = canonicalMarkdown(documents, board, source, config);
    try {
      return { source, markdown: deleteTaskRecord(markdown, task.id, source, config) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown task deletion error.";
      throw new BoardStorageError("board_task_delete_failed", `Unable to delete ${task.id}: ${message}`);
    }
  });
}
