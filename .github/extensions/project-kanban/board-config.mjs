import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const CONFIG_FILE = "project-kanban.config.json";
const PRIORITY_TONES = new Set(["high", "medium", "low"]);
const CATEGORY_TONES = new Set(["blue", "purple", "green", "orange", "slate"]);
const RESERVED_FIELDS = new Set([
  "id",
  "title",
  "status",
  "priority",
  "order",
  "area",
  "category",
  "details",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireKeys(value, label, required, optional = []) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has missing or unsupported properties.`);
  }
}

function requireText(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maxLength ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function validateSourcePath(sourcePath) {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.trim() === "" ||
    isAbsolute(sourcePath) ||
    sourcePath.includes("\\") ||
    sourcePath.split("/").some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new TypeError(`Source path "${sourcePath}" must be a normalized workspace-relative path.`);
  }
  return sourcePath;
}

function validateExtraField(field, sourceKey, keys) {
  requireKeys(field, `Extra field for "${sourceKey}"`, ["key", "label", "type"], [
    "required",
    "maxLength",
    "choices",
  ]);
  const key = requireText(field.key, "Extra field key", 64);
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key) || RESERVED_FIELDS.has(key) || keys.has(key)) {
    throw new TypeError(`Extra field key "${key}" is invalid or duplicated.`);
  }
  keys.add(key);

  const label = requireText(field.label, `Label for "${key}"`, 100);
  if (!["text", "textarea", "date", "task-ids"].includes(field.type)) {
    throw new TypeError(`Extra field "${key}" has an unsupported type.`);
  }
  if (field.required !== undefined && typeof field.required !== "boolean") {
    throw new TypeError(`Extra field "${key}" required must be a boolean.`);
  }
  let choices;
  if (field.choices !== undefined) {
    if (
      field.type !== "text" ||
      !Array.isArray(field.choices) ||
      field.choices.length === 0 ||
      field.choices.some((choice) => typeof choice !== "string" || choice.trim() === "") ||
      new Set(field.choices).size !== field.choices.length
    ) {
      throw new TypeError(`Extra field "${key}" choices must be unique non-empty strings on a text field.`);
    }
    choices = Object.freeze([...field.choices]);
  }
  const maxLength = field.maxLength ?? (field.type === "date" ? 10 : 5000);
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 5000) {
    throw new TypeError(`Extra field "${key}" maxLength must be from 1 to 5000.`);
  }
  return Object.freeze({
    key,
    label,
    type: field.type,
    required: field.required ?? false,
    maxLength,
    ...(choices ? { choices } : {}),
  });
}

function validateSource(source, sourceKeys, paths, prefixes) {
  requireKeys(
    source,
    "Task source",
    ["key", "label", "path", "idPrefix", "idWidth", "category", "categoryTone"],
    ["extraFields", "legacyIdPrefixes", "legacyAdapter"],
  );
  const key = requireText(source.key, "Source key", 64);
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key) || sourceKeys.has(key)) {
    throw new TypeError(`Source key "${key}" is invalid or duplicated.`);
  }
  if (source.legacyAdapter !== undefined) {
    requireText(source.legacyAdapter, `legacyAdapter for "${key}"`, 64);
  }
  sourceKeys.add(key);

  const label = requireText(source.label, `Label for "${key}"`, 100);
  const path = validateSourcePath(source.path);
  if (paths.has(path)) throw new TypeError(`Source path "${path}" is duplicated.`);
  paths.add(path);

  const idPrefix = requireText(source.idPrefix, `ID prefix for "${key}"`, 16);
  if (!/^[A-Z][A-Z0-9]*$/.test(idPrefix) || prefixes.has(idPrefix)) {
    throw new TypeError(`ID prefix "${idPrefix}" is invalid or duplicated.`);
  }
  prefixes.add(idPrefix);
  if (!Number.isInteger(source.idWidth) || source.idWidth < 2 || source.idWidth > 6) {
    throw new TypeError(`ID width for "${key}" must be an integer from 2 to 6.`);
  }

  const category = requireText(source.category, `Category for "${key}"`, 100);
  if (!CATEGORY_TONES.has(source.categoryTone)) {
    throw new TypeError(`Category tone for "${key}" is unsupported.`);
  }
  const extraFields = source.extraFields ?? [];
  if (!Array.isArray(extraFields)) throw new TypeError(`Extra fields for "${key}" must be an array.`);
  const fieldKeys = new Set();
  const validatedFields = extraFields.map((field) => validateExtraField(field, key, fieldKeys));
  const legacyIdPrefixes = source.legacyIdPrefixes ?? [];
  if (!Array.isArray(legacyIdPrefixes) || legacyIdPrefixes.some((prefix) => typeof prefix !== "string" || !/^[A-Z][A-Z0-9]*$/.test(prefix))) {
    throw new TypeError(`Legacy ID prefixes for "${key}" are invalid.`);
  }
  if (legacyIdPrefixes.includes(idPrefix) || new Set(legacyIdPrefixes).size !== legacyIdPrefixes.length) {
    throw new TypeError(`Legacy ID prefixes for "${key}" are duplicated.`);
  }

  return Object.freeze({
    key,
    label,
    path,
    idPrefix,
    idWidth: source.idWidth,
    category,
    categoryTone: source.categoryTone,
    extraFields: Object.freeze(validatedFields),
    legacyIdPrefixes: Object.freeze(legacyIdPrefixes),
  });
}

export function validateBoardConfig(input, workspaceRoot) {
  requireKeys(
    input,
    "Project Kanban config",
    [
      "configVersion",
      "projectName",
      "boardTitle",
      "schemaMarker",
      "statuses",
      "priorities",
      "sources",
      "defaultStatus",
    ],
    ["completionStatus"],
  );
  if (input.configVersion !== 1) throw new TypeError("Project Kanban configVersion must be 1.");

  const projectName = requireText(input.projectName, "projectName", 120);
  const boardTitle = requireText(input.boardTitle, "boardTitle", 120);
  const schemaMarker = requireText(input.schemaMarker, "schemaMarker", 120);
  if (!/^<!-- [a-z0-9-]+-schema:1 -->$/.test(schemaMarker)) {
    throw new TypeError("schemaMarker must be a version-1 HTML comment marker.");
  }
  if (!Array.isArray(input.statuses) || input.statuses.length === 0 || input.statuses.length > 12) {
    throw new TypeError("statuses must contain between 1 and 12 values.");
  }
  const statuses = input.statuses.map((status) => requireText(status, "Status", 60));
  if (new Set(statuses).size !== statuses.length) throw new TypeError("Status values must be unique.");
  if (!Array.isArray(input.priorities) || input.priorities.length === 0 || input.priorities.length > 8) {
    throw new TypeError("priorities must contain between 1 and 8 values.");
  }
  const priorityNames = new Set();
  const priorities = input.priorities.map((priority) => {
    requireKeys(priority, "Priority", ["name", "tone"]);
    const name = requireText(priority.name, "Priority name", 60);
    if (priorityNames.has(name)) throw new TypeError(`Priority "${name}" is duplicated.`);
    if (!PRIORITY_TONES.has(priority.tone)) throw new TypeError(`Priority tone for "${name}" is unsupported.`);
    priorityNames.add(name);
    return Object.freeze({ name, tone: priority.tone });
  });
  if (!statuses.includes(input.defaultStatus)) {
    throw new TypeError("defaultStatus must match one of the configured statuses.");
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > 12) {
    throw new TypeError("sources must contain between 1 and 12 values.");
  }

  const sourceKeys = new Set();
  const sourcePaths = new Set();
  const prefixes = new Set();
  const sources = input.sources.map((source) => validateSource(source, sourceKeys, sourcePaths, prefixes));
  if (input.completionStatus !== undefined) {
    if (!statuses.includes(input.completionStatus)) {
      throw new TypeError("completionStatus must match one of the configured statuses.");
    }
    if (
      sources.some(
        (source) => !source.extraFields.some(({ key, type }) => key === "completionDate" && type === "date"),
      )
    ) {
      throw new TypeError("Every source must configure completionDate as a date field when completionStatus is set.");
    }
  }
  if (workspaceRoot) {
    const root = resolve(workspaceRoot);
    for (const source of sources) {
      const target = resolve(root, source.path);
      const rel = relative(root, target);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new TypeError(`Source path "${source.path}" resolves outside the workspace.`);
      }
    }
  }

  return Object.freeze({
    configVersion: 1,
    projectName,
    boardTitle,
    schemaMarker,
    statuses: Object.freeze(statuses),
    priorities: Object.freeze(priorities),
    sources: Object.freeze(sources),
    defaultStatus: input.defaultStatus,
    ...(input.completionStatus !== undefined ? { completionStatus: input.completionStatus } : {}),
  });
}

export async function readBoardConfig(workspaceRoot) {
  let contents;
  try {
    contents = await readFile(resolve(workspaceRoot, CONFIG_FILE), "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "unknown";
    throw new Error(`Unable to read ${CONFIG_FILE} (${code}).`);
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${CONFIG_FILE} must contain valid JSON.`);
  }
  return validateBoardConfig(parsed, workspaceRoot);
}
