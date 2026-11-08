import {
  analyzeDependencies,
  findDependencySuggestions,
  normalizeDependencyIds,
  parseDependencyIds,
} from "./board-dependencies.mjs";

export const TASK_SCHEMA_VERSION = 1;
export const SCHEMA_HEADING = "## Kanban tasks";
export const TASK_COLUMNS = Object.freeze([
  "ID",
  "Title",
  "Status",
  "Priority",
  "Order",
  "Area",
  "Category",
  "Details",
]);

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function fieldName(header) {
  const words = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  return words[0] + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

function splitMarkdownRow(line) {
  const cells = [];
  let value = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && line[index + 1] === "|") {
      value += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function formatMarkdownRow(cells) {
  return `| ${cells.map((cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")).join(" | ")} |`;
}

function taskIdPattern(source) {
  const patterns = [
    `${source.idPrefix}-\\d{${source.idWidth},}`,
    ...source.legacyIdPrefixes.map((prefix) => `${prefix}-\\d{2,6}`),
  ];
  return new RegExp(`^(?:${patterns.join("|")})$`);
}

function taskIdSequenceMarker(source, nextValue) {
  return `<!-- project-kanban-id-sequence:${source.idPrefix}:${nextValue} -->`;
}

function readTaskIdSequence(markdown, source) {
  const lines = markdown.split(/\r?\n/);
  const markerLines = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.startsWith("<!-- project-kanban-id-sequence:"));
  if (markerLines.length > 1) {
    throw new Error(`${source.path}: only one task ID sequence marker is allowed.`);
  }
  if (markerLines.length === 0) return null;

  const { line, index } = markerLines[0];
  const match = line.match(new RegExp(`^<!-- project-kanban-id-sequence:${source.idPrefix}:(\\d+) -->$`));
  if (!match) {
    throw new Error(`${source.path}: the task ID sequence marker does not match ${source.idPrefix}.`);
  }
  const nextValue = Number(match[1]);
  if (!Number.isSafeInteger(nextValue) || nextValue < 1) {
    throw new Error(`${source.path}: the next task ID sequence value is invalid.`);
  }
  return { index, nextValue };
}

function maximumTaskIdSequence(tasks, source) {
  const pattern = new RegExp(`^${source.idPrefix}-(\\d{${source.idWidth},})$`);
  return tasks.reduce((maximum, task) => {
    const match = task.id.match(pattern);
    if (!match) return maximum;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) ? Math.max(maximum, value) : maximum;
  }, 0);
}

export function validateTaskIdSequence(markdown, source) {
  readTaskIdSequence(markdown, source);
}

export function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateTask(task, source, config) {
  for (const field of ["id", "title", "area", "category"]) {
    if (typeof task[field] !== "string" || task[field].trim() === "") {
      throw new Error(`${source.path}: task ${task.id || "(unknown)"} has an empty ${field}.`);
    }
  }
  if (!taskIdPattern(source).test(task.id)) {
    throw new Error(`${source.path}: invalid task ID "${task.id}" for prefix ${source.idPrefix}.`);
  }
  if (!config.statuses.includes(task.status)) {
    throw new Error(`${source.path}: ${task.id} has unsupported Status "${task.status}".`);
  }
  if (!config.priorities.some(({ name }) => name === task.priority)) {
    throw new Error(`${source.path}: ${task.id} has unsupported Priority "${task.priority}".`);
  }
  if (!Number.isSafeInteger(task.order) || task.order < 0) {
    throw new Error(`${source.path}: ${task.id} has an invalid Order.`);
  }
  if (typeof task.details !== "string") {
    throw new Error(`${source.path}: ${task.id} has invalid Details.`);
  }
  for (const field of source.extraFields) {
    const value = task[field.key] ?? "";
    if (
      typeof value !== "string" ||
      value.length > field.maxLength ||
      (field.type === "date" && value !== "" && !isValidDateOnly(value)) ||
      (field.choices && value !== "" && !field.choices.includes(value))
    ) {
      throw new Error(`${source.path}: ${task.id} has invalid ${field.label}.`);
    }
    if (field.type === "task-ids" && parseDependencyIds(value, config).includes(task.id)) {
      throw new Error(`${source.path}: ${task.id} cannot depend on itself.`);
    }
  }
  return task;
}

function findSchemaTable(markdown, source, config) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SCHEMA_HEADING);
  if (headingIndex === -1) return null;

  const end = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const limit = end === -1 ? lines.length : end;
  const section = lines.slice(headingIndex + 1, limit);
  if (!section.some((line) => line.trim() === config.schemaMarker)) {
    throw new Error(`${source.path}: ${SCHEMA_HEADING} is missing the configured schema marker.`);
  }

  const tableLines = section.filter((line) => line.trim().startsWith("|"));
  if (tableLines.length < 2) throw new Error(`${source.path}: the task table is missing its header or separator.`);
  const headers = splitMarkdownRow(tableLines[0]);
  const normalizedHeaders = headers.map((header) => fieldName(header));
  const requiredFields = [
    ...TASK_COLUMNS.map(fieldName),
    ...source.extraFields.filter(({ required }) => required).map(({ key }) => key),
  ];
  for (const field of requiredFields) {
    if (!normalizedHeaders.includes(field)) {
      throw new Error(`${source.path}: the task table is missing the ${field} column.`);
    }
  }
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error(`${source.path}: task table column names must be unique.`);
  }
  if (!splitMarkdownRow(tableLines[1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error(`${source.path}: the task table has an invalid separator row.`);
  }

  const tasks = tableLines.slice(2).map((line) => {
    const cells = splitMarkdownRow(line);
    if (cells.length !== headers.length) {
      throw new Error(`${source.path}: task row has ${cells.length} cells; expected ${headers.length}.`);
    }
    const values = Object.fromEntries(headers.map((header, index) => [fieldName(header), cells[index]]));
    const task = {
      id: values.id,
      title: values.title,
      status: values.status,
      priority: values.priority,
      order: Number(values.order),
      area: values.area,
      category: values.category,
      details: values.details,
      source: { document: source.path, section: "Kanban tasks", schemaVersion: TASK_SCHEMA_VERSION },
    };
    for (const field of source.extraFields) task[field.key] = values[field.key] ?? "";
    return validateTask(task, source, config);
  });
  return { headers, tasks };
}

function buildBoard(tasks, config) {
  const sourceOrder = new Map(config.sources.map((source, index) => [source.path, index]));
  const sortedTasks = [...tasks].sort(
    (left, right) =>
      left.order - right.order ||
      (sourceOrder.get(left.source.document) ?? 0) - (sourceOrder.get(right.source.document) ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const dependencyAnalysis = analyzeDependencies(sortedTasks, config);
  const dependencySuggestions = findDependencySuggestions(sortedTasks, config);
  const projectedTasks = sortedTasks.map((task) => ({
    ...task,
    dependencyView: dependencyAnalysis.taskViews.get(task.id),
  }));
  return {
    tasks: projectedTasks,
    columns: config.statuses.map((status) => ({
      id: status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title: status,
      status,
      cards: projectedTasks.filter((task) => task.status === status),
    })),
    dependencyGraph: dependencyAnalysis.graph,
    dependencySuggestions,
    sources: config.sources.map(({ path }) => path),
    config: {
      projectName: config.projectName,
      boardTitle: config.boardTitle,
      statuses: config.statuses,
      priorities: config.priorities,
      sources: config.sources,
      defaultStatus: config.defaultStatus,
      ...(config.completionStatus !== undefined ? { completionStatus: config.completionStatus } : {}),
    },
    schemaVersion: TASK_SCHEMA_VERSION,
  };
}

export function parseBoardDocuments(documents, config) {
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) {
    throw new TypeError("Source documents must be provided as a path-to-content object.");
  }

  const parsedSources = config.sources.map((source) => {
    const markdown = documents[source.path];
    requireText(markdown, source.path);
    validateTaskIdSequence(markdown, source);
    return { source, markdown, schema: findSchemaTable(markdown, source, config) };
  });
  const missingSchema = parsedSources.find(({ schema }) => !schema);
  if (missingSchema) {
    throw new Error(`${missingSchema.source.path}: a canonical schema-v1 task table is required.`);
  }
  const tasks = parsedSources.flatMap(({ schema }) => schema.tasks);

  const sourceByPath = new Map(config.sources.map((source) => [source.path, source]));
  const seenIds = new Set();
  for (const task of tasks) {
    const source = sourceByPath.get(task.source.document);
    if (!source) throw new Error(`Task "${task.id}" belongs to an unconfigured source.`);
    validateTask(task, source, config);
    if (seenIds.has(task.id)) throw new Error(`Duplicate task ID "${task.id}" across source documents.`);
    seenIds.add(task.id);
  }
  return buildBoard(tasks, config);
}

function headerIndex(headers, key) {
  return headers.findIndex((header) => fieldName(header) === key);
}

function tableLayout(markdown, source, config) {
  const schema = findSchemaTable(markdown, source, config);
  if (!schema) throw new Error(`${source.path}: a canonical task table is required for this operation.`);

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SCHEMA_HEADING);
  const end = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const limit = end === -1 ? lines.length : end;
  const markerIndex = lines.findIndex(
    (line, index) => index > headingIndex && index < limit && line.trim() === config.schemaMarker,
  );
  let headerRow = markerIndex + 1;
  while (headerRow < limit && !lines[headerRow].trim().startsWith("|")) headerRow += 1;
  let insertionIndex = headerRow + 2;
  while (insertionIndex < limit && lines[insertionIndex].trim().startsWith("|")) insertionIndex += 1;
  return { lines, headers: schema.headers, headerRow, insertionIndex };
}

export function normalizeConfiguredTaskTable(markdown, source, config) {
  const { lines, headers, headerRow, insertionIndex } = tableLayout(markdown, source, config);
  const configuredHeaders = [
    ...TASK_COLUMNS,
    ...source.extraFields.map(({ label }) => label),
  ];
  const configuredKeys = new Set([
    ...TASK_COLUMNS.map(fieldName),
    ...source.extraFields.map(({ key }) => key),
  ]);
  const unconfiguredHeaders = headers.filter((header) => !configuredKeys.has(fieldName(header)));
  const targetHeaders = [...configuredHeaders, ...unconfiguredHeaders];
  if (headers.length === targetHeaders.length && headers.every((header, index) =>
    fieldName(header) === fieldName(targetHeaders[index]))) {
    return markdown;
  }

  const originalKeys = headers.map(fieldName);
  lines[headerRow] = formatMarkdownRow(targetHeaders);
  lines[headerRow + 1] = formatMarkdownRow(targetHeaders.map(() => "---"));
  for (let rowIndex = headerRow + 2; rowIndex < insertionIndex; rowIndex += 1) {
    const cells = splitMarkdownRow(lines[rowIndex]);
    if (cells.length !== headers.length) {
      throw new Error(`${source.path}: cannot normalize a malformed task row.`);
    }
    const values = new Map(originalKeys.map((key, index) => [key, cells[index]]));
    lines[rowIndex] = formatMarkdownRow(targetHeaders.map((header) => values.get(fieldName(header)) ?? ""));
  }
  return lines.join("\n");
}

export function ensureTaskIdSequence(markdown, tasks, source, config) {
  const existing = readTaskIdSequence(markdown, source);
  const maximum = maximumTaskIdSequence(tasks, source);
  const nextValue = Math.max(maximum + 1, existing?.nextValue ?? 1);
  if (!Number.isSafeInteger(nextValue)) {
    throw new Error(`${source.path}: no safe task ID sequence value remains.`);
  }
  if (existing) {
    if (existing.nextValue === nextValue) return markdown;
    const lines = markdown.split(/\r?\n/);
    lines[existing.index] = taskIdSequenceMarker(source, nextValue);
    return lines.join("\n");
  }
  const { lines, insertionIndex } = tableLayout(markdown, source, config);
  lines.splice(insertionIndex, 0, taskIdSequenceMarker(source, nextValue));
  return lines.join("\n");
}

function advanceTaskIdSequence(markdown, task, source, config) {
  const idPattern = new RegExp(`^${source.idPrefix}-(\\d{${source.idWidth},})$`);
  const match = task.id.match(idPattern);
  if (!match) throw new Error(`${source.path}: cannot reserve a sequence for invalid task ID "${task.id}".`);
  const allocatedValue = Number(match[1]);
  const existing = readTaskIdSequence(markdown, source);
  const nextValue = Math.max(existing?.nextValue ?? 1, allocatedValue + 1);
  if (!Number.isSafeInteger(nextValue)) {
    throw new Error(`${source.path}: no safe task ID sequence value remains.`);
  }

  const lines = markdown.split(/\r?\n/);
  if (existing) {
    lines[existing.index] = taskIdSequenceMarker(source, nextValue);
  } else {
    const layout = tableLayout(markdown, source, config);
    layout.lines.splice(layout.insertionIndex, 0, taskIdSequenceMarker(source, nextValue));
    return layout.lines.join("\n");
  }
  return lines.join("\n");
}

function allFieldKeys(source) {
  return new Set([
    "title",
    "status",
    "priority",
    "order",
    "area",
    "category",
    "details",
    ...source.extraFields.map(({ key }) => key),
  ]);
}

export function updateTaskRecord(markdown, taskId, updates, source, config) {
  if (typeof taskId !== "string" || !taskIdPattern(source).test(taskId)) {
    throw new TypeError("A valid source task ID is required.");
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new TypeError("Task updates must be an object.");
  }
  const entries = Object.entries(updates);
  const allowedFields = allFieldKeys(source);
  if (entries.length === 0 || entries.some(([key]) => !allowedFields.has(key))) {
    throw new TypeError("Task updates contain no editable fields or include an unsupported field.");
  }
  for (const [field, value] of entries) {
    if (field === "status" && !config.statuses.includes(value)) {
      throw new TypeError(`Unsupported Status "${value}".`);
    }
    if (field === "priority" && !config.priorities.some(({ name }) => name === value)) {
      throw new TypeError(`Unsupported Priority "${value}".`);
    }
    if (field === "order" && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError("Order must be a non-negative safe integer.");
    }
    if (field !== "status" && field !== "priority" && field !== "order") {
      const fieldConfig = source.extraFields.find(({ key }) => key === field);
      const maxLength = fieldConfig?.maxLength ?? (field === "title" ? 200 : field === "area" || field === "category" ? 100 : 5000);
      const required = ["title", "area", "category"].includes(field) || fieldConfig?.required;
      if (
        typeof value !== "string" ||
        (required && value.trim() === "") ||
        value.length > maxLength ||
        (fieldConfig?.type === "date" && value !== "" && !isValidDateOnly(value)) ||
        (fieldConfig?.choices && value !== "" && !fieldConfig.choices.includes(value))
      ) {
        throw new TypeError(`${field} is empty or exceeds its maximum length.`);
      }
      if (fieldConfig?.type === "task-ids") parseDependencyIds(value, config);
    }
  }

  const { lines, headers, headerRow, insertionIndex } = tableLayout(markdown, source, config);
  const idIndex = headerIndex(headers, "id");
  const rowIndex = lines.findIndex((line, index) => {
    if (index < headerRow + 2 || index >= insertionIndex || !line.trim().startsWith("|")) return false;
    return splitMarkdownRow(line)[idIndex] === taskId;
  });
  if (rowIndex === -1) throw new Error(`Task "${taskId}" was not found in ${source.path}.`);
  const cells = splitMarkdownRow(lines[rowIndex]);
  for (const [field, value] of entries) {
    const index = headerIndex(headers, field);
    if (index === -1) throw new Error(`${source.path}: the task table has no ${field} column.`);
    const fieldConfig = source.extraFields.find(({ key }) => key === field);
    cells[index] = fieldConfig?.type === "task-ids"
      ? normalizeDependencyIds(value, config)
      : String(value).trim();
  }
  lines[rowIndex] = formatMarkdownRow(cells);
  return lines.join("\n");
}

export function validateTaskDraft(sourceKey, draft, config) {
  const source = config.sources.find(({ key }) => key === sourceKey);
  if (!source) throw new TypeError(`Unsupported task source "${sourceKey}".`);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new TypeError("Task fields must be an object.");
  }

  const fields = ["title", "area", "category", "priority", "status", "details", ...source.extraFields.map(({ key }) => key)];
  const requiredFields = [
    "title",
    "area",
    "priority",
    "status",
    ...source.extraFields.filter(({ required }) => required).map(({ key }) => key),
  ];
  const keys = Object.keys(draft);
  if (requiredFields.some((field) => !Object.hasOwn(draft, field)) || keys.some((field) => !fields.includes(field))) {
    throw new TypeError(`Task fields must include: ${requiredFields.join(", ")} and no unsupported fields.`);
  }
  if (typeof draft.title !== "string" || draft.title.trim() === "" || draft.title.length > 200) {
    throw new TypeError("Title must be a non-empty string of at most 200 characters.");
  }
  if (typeof draft.area !== "string" || draft.area.trim() === "" || draft.area.length > 100) {
    throw new TypeError("Area must be a non-empty string of at most 100 characters.");
  }
  const category = Object.hasOwn(draft, "category") ? draft.category : source.category;
  if (typeof category !== "string" || category.trim() === "" || category.length > 100) {
    throw new TypeError("Category must be a non-empty string of at most 100 characters.");
  }
  if (!config.priorities.some(({ name }) => name === draft.priority)) {
    throw new TypeError("Priority is not supported.");
  }
  if (!config.statuses.includes(draft.status)) throw new TypeError("Status is not supported.");
  const normalizedDraft = { ...draft };
  for (const field of ["details", ...source.extraFields.map(({ key }) => key)]) {
    const fieldConfig = source.extraFields.find(({ key }) => key === field);
    const value = draft[field] ?? "";
    if (
      typeof value !== "string" ||
      value.length > (fieldConfig?.maxLength ?? 5000) ||
      (fieldConfig?.required && value.trim() === "") ||
      (fieldConfig?.type === "date" && value !== "" && !isValidDateOnly(value)) ||
      (fieldConfig?.choices && value !== "" && !fieldConfig.choices.includes(value))
    ) {
      throw new TypeError(`${fieldConfig?.label ?? "Details"} is empty or exceeds its maximum length.`);
    }
    normalizedDraft[field] = fieldConfig?.type === "task-ids"
      ? normalizeDependencyIds(value, config)
      : value.trim();
  }

  return {
    ...Object.fromEntries(fields.map((field) => [field, (normalizedDraft[field] ?? "").trim()])),
    category: category.trim(),
    source: { document: source.path, section: "Kanban tasks", schemaVersion: TASK_SCHEMA_VERSION },
  };
}

export function allocateTaskId(sourceKey, tasks, config, markdown = "") {
  const source = config.sources.find(({ key }) => key === sourceKey);
  if (!source) throw new TypeError(`Unsupported task source "${sourceKey}".`);
  const maximum = maximumTaskIdSequence(tasks, source);
  const sequence = markdown ? readTaskIdSequence(markdown, source) : null;
  const nextValue = Math.max(maximum + 1, sequence?.nextValue ?? 1);
  if (!Number.isSafeInteger(nextValue)) {
    throw new TypeError(`No safe task ID remains for source "${source.key}".`);
  }
  return `${source.idPrefix}-${String(nextValue).padStart(source.idWidth, "0")}`;
}

export function nextTaskOrder(tasks, status) {
  const maximum = tasks
    .filter((task) => task.status === status)
    .reduce((max, task) => Math.max(max, task.order), 0);
  return maximum + 100;
}

function formatTaskRow(task, headers) {
  const values = { ...task, ...task.source, details: task.details };
  return formatMarkdownRow(headers.map((header) => values[fieldName(header)] ?? ""));
}

export function appendTaskRecord(markdown, task, source, config) {
  const { lines, headers, insertionIndex } = tableLayout(markdown, source, config);
  lines.splice(insertionIndex, 0, formatTaskRow(task, headers));
  return advanceTaskIdSequence(lines.join("\n"), task, source, config);
}

export function deleteTaskRecord(markdown, taskId, source, config) {
  if (typeof taskId !== "string" || !taskIdPattern(source).test(taskId)) {
    throw new TypeError("A valid source task ID is required.");
  }
  const { lines, headers, headerRow, insertionIndex } = tableLayout(markdown, source, config);
  const idIndex = headerIndex(headers, "id");
  const rowIndex = lines.findIndex((line, index) => {
    if (index < headerRow + 2 || index >= insertionIndex || !line.trim().startsWith("|")) return false;
    return splitMarkdownRow(line)[idIndex] === taskId;
  });
  if (rowIndex === -1) throw new Error(`Task "${taskId}" was not found in ${source.path}.`);
  lines.splice(rowIndex, 1);
  return lines.join("\n");
}
