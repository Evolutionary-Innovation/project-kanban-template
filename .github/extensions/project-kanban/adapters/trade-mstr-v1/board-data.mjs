export const TASK_SCHEMA_VERSION = 1;
export const STATUSES = Object.freeze([
  "Complete",
  "In Progress",
  "Planned",
  "Research",
  "Future Ideas",
]);
export const PRIORITIES = Object.freeze(["High", "Medium", "Low"]);
export const TASK_COLUMNS = Object.freeze([
  "ID",
  "Title",
  "Status",
  "Priority",
  "Order",
  "Area",
  "Category",
]);

const SCHEMA_HEADING = "## Kanban tasks";
const SCHEMA_MARKER = "<!-- trade-mstr-kanban-schema:1 -->";
export const SOURCE_FILES = Object.freeze({
  roadmap: "docs/roadmap.md",
  technicalDebt: "docs/technical-debt.md",
  repositoryAudit: "docs/repository-audit.md",
});
export const TASK_SOURCES = Object.freeze({
  roadmap: Object.freeze({
    document: SOURCE_FILES.roadmap,
    prefix: "RM",
    category: "Roadmap",
  }),
  technicalDebt: Object.freeze({
    document: SOURCE_FILES.technicalDebt,
    prefix: "TD",
    category: "Technical Debt",
  }),
  researchAudit: Object.freeze({
    document: SOURCE_FILES.repositoryAudit,
    prefix: "RA",
    category: "Research/Audit",
  }),
});
const SOURCE_ORDER_BASE = Object.freeze({
  [SOURCE_FILES.roadmap]: 0,
  [SOURCE_FILES.technicalDebt]: 100_000,
  [SOURCE_FILES.repositoryAudit]: 200_000,
});

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty Markdown document.`);
  }
}

function splitMarkdownRow(line) {
  let value = "";
  const cells = [];

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

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatMarkdownRow(cells) {
  return `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
}

function fieldName(header) {
  const [first, ...rest] = header.toLowerCase().split(/\s+/);
  return first + rest.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

function splitLegacyDebtDetails(details) {
  const match = details.match(
    /^Limitation:\s*([\s\S]*?)\s+Recommended fix:\s*([\s\S]*?)\s+Rationale:\s*([\s\S]*)$/i,
  );
  if (!match) return null;
  return {
    limitation: match[1],
    recommendedFix: match[2],
    rationale: match[3],
    details: "",
  };
}

function plainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(text, limit = 86) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function titleFromText(markdown) {
  const emphasized = markdown.match(/^\*\*([^*]+)\*\*/);
  if (emphasized) return truncate(emphasized[1].replace(/:\s*$/, ""));

  const text = plainText(markdown).replace(/[.!?]+$/, "");
  const firstClause = text.split(/\s+[—–]\s+|:\s+|\.\s+|\s+\(/, 1)[0];
  return truncate(firstClause || text);
}

function validateTask(task, source) {
  for (const field of ["id", "title", "area", "category"]) {
    if (typeof task[field] !== "string" || task[field].trim() === "") {
      throw new Error(`${source}: task ${task.id || "(unknown)"} has an empty ${field}.`);
    }
  }
  if (!/^[A-Z][A-Z0-9]*-\d{2,4}$/.test(task.id)) {
    throw new Error(`${source}: invalid task ID "${task.id}".`);
  }
  if (!STATUSES.includes(task.status)) {
    throw new Error(`${source}: ${task.id} has unsupported Status "${task.status}".`);
  }
  if (!PRIORITIES.includes(task.priority)) {
    throw new Error(`${source}: ${task.id} has unsupported Priority "${task.priority}".`);
  }
  if (!Number.isFinite(task.order)) {
    throw new Error(`${source}: ${task.id} has a non-numeric Order.`);
  }
  if (typeof task.details !== "string") {
    throw new Error(`${source}: ${task.id} has invalid Details.`);
  }
  return task;
}

function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`Missing "## ${heading}" section.`);

  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function findSchemaTable(markdown, source) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SCHEMA_HEADING);
  if (headingIndex === -1) return null;

  const end = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const section = lines.slice(headingIndex + 1, end === -1 ? lines.length : end);
  if (!section.some((line) => line.trim() === SCHEMA_MARKER)) {
    throw new Error(`${source}: ${SCHEMA_HEADING} is missing the schema version marker.`);
  }

  const tableLines = section.filter((line) => line.trim().startsWith("|"));
  if (tableLines.length < 2) throw new Error(`${source}: the task table is missing its header or separator.`);

  const headers = splitMarkdownRow(tableLines[0]);
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  for (const field of TASK_COLUMNS) {
    if (!normalizedHeaders.includes(field.toLowerCase())) {
      throw new Error(`${source}: the task table is missing the ${field} column.`);
    }
  }

  if (!splitMarkdownRow(tableLines[1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error(`${source}: the task table has an invalid separator row.`);
  }

  const rows = tableLines.slice(2).map((line) => splitMarkdownRow(line));
  const tasks = rows.map((cells) => {
    if (cells.length !== headers.length) {
      throw new Error(`${source}: task row has ${cells.length} cells; expected ${headers.length}.`);
    }
    const values = Object.fromEntries(
      headers.map((header, index) => [header.toLowerCase(), cells[index]]),
    );
    const extraFields = Object.fromEntries(
      headers
        .filter((header) => !TASK_COLUMNS.some((field) => field.toLowerCase() === header.toLowerCase()))
        .map((header) => [fieldName(header), values[header.toLowerCase()]]),
    );
    if (
      extraFields.limitation === "" &&
      extraFields.recommendedFix === "" &&
      extraFields.rationale === "" &&
      typeof extraFields.details === "string"
    ) {
      Object.assign(extraFields, splitLegacyDebtDetails(extraFields.details) ?? {});
    }

    return validateTask(
      {
        id: values.id,
        title: values.title,
        status: values.status,
        priority: values.priority,
        order: Number(values.order),
        area: values.area,
        category: values.category,
        ...extraFields,
        details: extraFields.details ?? "",
        source: { document: source, section: "Kanban tasks", schemaVersion: TASK_SCHEMA_VERSION },
      },
      source,
    );
  });

  return { headers, tasks };
}

export function hasCanonicalTaskTable(markdown, source) {
  return findSchemaTable(markdown, source) !== null;
}

function createLegacyTask({
  id,
  title,
  status,
  priority,
  area,
  category,
  details,
  limitation,
  recommendedFix,
  rationale,
  source,
  legacyPosition,
}) {
  return {
    id,
    title,
    status,
    priority,
    order: legacyPosition,
    area,
    category,
    details,
    limitation,
    recommendedFix,
    rationale,
    source,
    legacyPosition,
    legacy: true,
  };
}

function parseLegacyRoadmap(roadmap) {
  const tasks = [];
  let group = "";
  let roadmapId = 0;
  let position = 0;
  const add = (input) => {
    roadmapId += 1;
    position += 1;
    tasks.push(
      createLegacyTask({
        ...input,
        id: `RM-${String(roadmapId).padStart(3, "0")}`,
        legacyPosition: position,
        source: { document: SOURCE_FILES.roadmap, section: input.section },
        category: "Roadmap",
      }),
    );
  };

  for (const line of sectionLines(roadmap, "Completed")) {
    const heading = line.trim().match(/^\*\*(.+)\*\*$/);
    if (heading) {
      group = heading[1];
      continue;
    }
    const item = line.match(/^\s*-\s+(.+)$/);
    if (!item || /TD-19\b/.test(item[1])) continue;
    add({
      title: titleFromText(item[1]),
      status: "Complete",
      priority: "Medium",
      area: group || "Roadmap",
      details: plainText(item[1]),
      section: "Completed",
    });
  }

  for (const line of sectionLines(roadmap, "Next")) {
    const item = line.match(/^\s*\d+\.\s+(.+)$/);
    if (!item) continue;

    const remaining = item[1].match(/Still to do:\s*(.+)$/i);
    if (remaining) {
      const completedTitle = titleFromText(item[1].replace(/Still to do:.+$/i, "").replace(/[:—–\s]+$/, ""));
      if (!/Custom date ranges/i.test(completedTitle)) {
        throw new Error(`Unrecognized partially completed roadmap item "${completedTitle}".`);
      }
      add({
        title: completedTitle,
        status: "Complete",
        priority: "Medium",
        area: "Dashboard",
        details: "Custom DateRange model, URL parameters, and canonical filtering are implemented (ADR-19).",
        section: "Next",
      });
      add({
        title: titleFromText(remaining[1]),
        status: "Planned",
        priority: "Medium",
        area: "Analytics",
        details: `Remaining work: ${plainText(remaining[1])}`,
        section: "Next",
      });
      continue;
    }

    if (item[1].includes("~~")) {
      const title = titleFromText(item[1]);
      if (/moving-average period boundary|exponential moving averages/i.test(title)) continue;
      add({
        title,
        status: "Complete",
        priority: "Medium",
        area: "Analytics",
        details: plainText(item[1]),
        section: "Next",
      });
      continue;
    }

    const title = titleFromText(item[1]);
    add({
      title,
      status: "Planned",
      priority: "Medium",
      area: /tests?/i.test(title) ? "Testing" : "Analytics",
      details: plainText(item[1]),
      section: "Next",
    });
  }

  for (const line of sectionLines(roadmap, "Future")) {
    const item = line.match(/^\s*-\s+(.+)$/);
    if (!item) continue;
    const title = titleFromText(item[1]);
    add({
      title,
      status: "Future Ideas",
      priority: "Low",
      area: futureArea(title),
      details: plainText(item[1]),
      section: "Future",
    });
  }
  return tasks;
}

function futureArea(title) {
  const normalized = title.toLowerCase();
  if (normalized.includes("pipeline") || normalized.includes("history")) return "Data";
  if (normalized.includes("portfolio")) return "Portfolio";
  if (normalized.includes("signal") || normalized.includes("backtest")) return "Analytics";
  if (normalized.includes("asset")) return "Data";
  if (normalized.includes("operational")) return "Platform";
  if (normalized.includes("export")) return "Dashboard";
  return "Product";
}

function debtStatus(id, text) {
  const normalized = text.toLowerCase();
  if (id === "TD-06" || id === "TD-15") return "Future Ideas";
  if (
    /\bverify\b|\bconsider\b|\bdecide\b|\bwhether\b|\bnot reproduced\b|\bif deploying\b|\bif deployed\b/.test(
      normalized,
    )
  ) {
    return "Research";
  }
  return "Planned";
}

function parseLegacyTechnicalDebt(technicalDebt) {
  const tasks = [];
  for (const line of sectionLines(technicalDebt, "Register")) {
    if (/^\s*\|\s*TD-\d+\s*\|/.test(line)) {
      const cells = splitMarkdownRow(line);
      if (cells.length !== 6) throw new Error("The legacy technical-debt table has an unexpected shape.");
      const [id, severity, area, limitation, recommendedFix, rationale] = cells;
      const status = debtStatus(id, `${limitation} ${recommendedFix} ${rationale}`);
      tasks.push(
        createLegacyTask({
          id,
          title: `${id} · ${titleFromText(recommendedFix)}`,
          status,
          priority: severity,
          area,
          category: "Technical Debt",
          details: `Limitation: ${plainText(limitation)} Recommended fix: ${plainText(recommendedFix)} Rationale: ${plainText(rationale)}`,
          limitation: plainText(limitation),
          recommendedFix: plainText(recommendedFix),
          rationale: plainText(rationale),
          source: { document: SOURCE_FILES.technicalDebt, section: "Register", reference: id },
          legacyPosition: tasks.length + 1,
        }),
      );
    }
  }

  const closedEntries = [
    {
      id: "TD-01",
      title: "Terraform state exposure and historical review",
      area: "Security",
      sourceHeading: "Closed: TD-01 - Terraform state exposure and historical review",
    },
    {
      id: "TD-19",
      title: "Moving-average warm-up across display ranges",
      area: "Analytics",
      sourceHeading: "Closed: TD-19 - Moving averages restarted warm-up at the display boundary",
    },
  ];

  for (const entry of closedEntries) {
    const headingIndex = technicalDebt
      .split(/\r?\n/)
      .findIndex((line) => line.trim() === `## ${entry.sourceHeading}`);
    if (headingIndex === -1) continue;
    const following = technicalDebt.split(/\r?\n/).slice(headingIndex + 1);
    const text = [];
    for (const line of following) {
      if (/^##\s/.test(line)) break;
      if (line.trim()) text.push(line.trim());
    }
    tasks.push(
      createLegacyTask({
        id: entry.id,
        title: entry.title,
        status: "Complete",
        priority: "Low",
        area: entry.area,
        category: "Technical Debt",
        details: plainText(text.join(" ")),
        source: { document: SOURCE_FILES.technicalDebt, section: "Closed", reference: entry.id },
        legacyPosition: tasks.length + 1,
      }),
    );
  }

  return tasks;
}

function parseLegacyAudit(repositoryAudit) {
  requireText(repositoryAudit, SOURCE_FILES.repositoryAudit);
  if (!/^# Repository Audit\b/m.test(repositoryAudit) || !/^## Recommendations\b/m.test(repositoryAudit)) {
    throw new Error("The repository audit is missing its expected title or recommendations section.");
  }
  return [
    createLegacyTask({
      id: "TD-20",
      title: "Revalidate repository-audit recommendations",
      status: "Research",
      priority: "Low",
      order: 0,
      area: "Repository",
      category: "Research/Audit",
      details:
        "The repository audit says its recommendations need approval and current-state verification. Recheck each candidate before acting.",
      source: { document: SOURCE_FILES.repositoryAudit, section: "Recommendations", reference: "TD-20" },
      legacyPosition: 1,
    }),
  ];
}

function assignLegacyOrders(tasks) {
  for (const task of tasks) {
    const sourceBase = SOURCE_ORDER_BASE[task.source.document];
    if (sourceBase === undefined) {
      throw new Error(`Unknown legacy task source "${task.source.document}".`);
    }
    task.order = sourceBase + task.legacyPosition * 100;
  }
}

export function parseBoardDocuments({ roadmap, technicalDebt, repositoryAudit }) {
  requireText(roadmap, SOURCE_FILES.roadmap);
  requireText(technicalDebt, SOURCE_FILES.technicalDebt);
  requireText(repositoryAudit, SOURCE_FILES.repositoryAudit);

  const parsed = [
    [roadmap, SOURCE_FILES.roadmap, () => parseLegacyRoadmap(roadmap)],
    [technicalDebt, SOURCE_FILES.technicalDebt, () => parseLegacyTechnicalDebt(technicalDebt)],
    [repositoryAudit, SOURCE_FILES.repositoryAudit, () => parseLegacyAudit(repositoryAudit)],
  ].map(([markdown, source, legacyParser]) => {
    const schema = findSchemaTable(markdown, source);
    return schema ? { tasks: schema.tasks, legacy: false } : { tasks: legacyParser(), legacy: true };
  });

  const canonicalTasks = parsed.filter(({ legacy }) => !legacy).flatMap(({ tasks }) => tasks);
  const legacyTasks = parsed.filter(({ legacy }) => legacy).flatMap(({ tasks }) => tasks);
  assignLegacyOrders(legacyTasks);
  const tasks = [...canonicalTasks, ...legacyTasks];
  const seenIds = new Set();
  for (const task of tasks) {
    if (seenIds.has(task.id)) throw new Error(`Duplicate task ID "${task.id}" across source documents.`);
    seenIds.add(task.id);
  }

  const sortedTasks = [...tasks].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  return {
    tasks: sortedTasks,
    columns: STATUSES.map((status) => ({
      id: slugify(status),
      title: status,
      status,
      cards: sortedTasks.filter((task) => task.status === status),
    })),
    sources: Object.values(SOURCE_FILES),
    schemaVersion: TASK_SCHEMA_VERSION,
  };
}

export function updateTaskRecord(markdown, taskId, updates) {
  if (typeof taskId !== "string" || !/^[A-Z][A-Z0-9]*-\d{2,4}$/.test(taskId)) {
    throw new TypeError("A valid task ID is required.");
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new TypeError("Task updates must be an object.");
  }
  const keys = Object.keys(updates);
  const editableFields = new Set([
    "title",
    "status",
    "priority",
    "order",
    "area",
    "category",
    "details",
    "limitation",
    "recommendedFix",
    "rationale",
  ]);
  if (keys.length === 0 || keys.some((key) => !editableFields.has(key))) {
    throw new TypeError("Task updates contain no editable fields or include an unsupported field.");
  }
  for (const [field, value] of Object.entries(updates)) {
    if (field === "status" && !STATUSES.includes(value)) {
      throw new TypeError(`Unsupported Status "${value}".`);
    }
    if (field === "priority" && !PRIORITIES.includes(value)) {
      throw new TypeError(`Unsupported Priority "${value}".`);
    }
    if (field === "order" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new TypeError("Order must be a finite number.");
    }
    if (field !== "status" && field !== "priority" && field !== "order") {
      if (typeof value !== "string" || (["title", "area", "category"].includes(field) && value.trim() === "")) {
        throw new TypeError(`${field} must be ${["title", "area", "category"].includes(field) ? "a non-empty" : "a"} string.`);
      }
      const maxLength = ["details", "limitation", "recommendedFix", "rationale"].includes(field)
        ? 5000
        : ["area", "category"].includes(field)
          ? 100
          : 200;
      if (value.length > maxLength) {
        throw new TypeError(`${field} exceeds its maximum length.`);
      }
    }
  }

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SCHEMA_HEADING);
  if (headingIndex === -1) throw new Error("The source document must be migrated before it can be edited.");
  const end = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const sectionEnd = end === -1 ? lines.length : end;
  const markerIndex = lines.findIndex(
    (line, index) => index > headingIndex && index < sectionEnd && line.trim() === SCHEMA_MARKER,
  );
  if (markerIndex === -1) throw new Error("The source task table has no supported schema marker.");

  let headerIndex = markerIndex + 1;
  while (headerIndex < sectionEnd && !lines[headerIndex].trim().startsWith("|")) headerIndex += 1;
  const headers = splitMarkdownRow(lines[headerIndex]);
  const indexes = new Map(headers.map((header, index) => [fieldName(header), index]));
  const idIndex = indexes.get("id");
  if (idIndex === undefined) {
    throw new Error("The source task table is missing a required field.");
  }

  for (let rowIndex = headerIndex + 2; rowIndex < sectionEnd && lines[rowIndex].trim().startsWith("|"); rowIndex += 1) {
    const cells = splitMarkdownRow(lines[rowIndex]);
    if (cells[idIndex] !== taskId) continue;
    if (cells.length !== headers.length) throw new Error(`${taskId} has a malformed source row.`);
    for (const [field, value] of Object.entries(updates)) {
      const fieldIndex = indexes.get(field);
      if (fieldIndex === undefined) throw new Error(`The source task table has no ${field} column.`);
      cells[fieldIndex] = String(value).trim();
    }
    lines[rowIndex] = formatMarkdownRow(cells);
    return lines.join("\n");
  }
  throw new Error(`Task "${taskId}" was not found in the source document.`);
}

export function validateTaskDraft(sourceType, draft) {
  const source = TASK_SOURCES[sourceType];
  if (!source) throw new TypeError(`Unsupported task source "${sourceType}".`);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new TypeError("Task fields must be an object.");
  }

  const fields = sourceType === "technicalDebt"
    ? ["title", "area", "priority", "status", "limitation", "recommendedFix", "rationale", "details"]
    : ["title", "area", "priority", "status", "details"];
  const keys = Object.keys(draft);
  if (keys.length !== fields.length || keys.some((field) => !fields.includes(field))) {
    throw new TypeError(`Task fields must contain exactly: ${fields.join(", ")}.`);
  }
  if (typeof draft.title !== "string" || draft.title.trim() === "") {
    throw new TypeError("Title must be a non-empty string.");
  }
  if (draft.title.trim().length > 200) throw new TypeError("Title must be 200 characters or fewer.");
  if (typeof draft.area !== "string" || draft.area.trim() === "") {
    throw new TypeError("Area must be a non-empty string.");
  }
  if (draft.area.trim().length > 100) throw new TypeError("Area must be 100 characters or fewer.");
  if (!PRIORITIES.includes(draft.priority)) throw new TypeError("Priority is not supported.");
  if (!STATUSES.includes(draft.status)) throw new TypeError("Status is not supported.");
  for (const field of fields.filter((name) => ["details", "limitation", "recommendedFix", "rationale"].includes(name))) {
    const value = draft[field];
    if (typeof value !== "string") throw new TypeError(`${field} must be a string.`);
    if (value.length > 5000) throw new TypeError(`${field} must be 5000 characters or fewer.`);
  }

  for (const field of ["limitation", "recommendedFix", "rationale"]) {
    if (!(field in draft)) continue;
    if (typeof draft[field] !== "string") throw new TypeError(`${field} must be a string.`);
    if (draft[field].length > 5000) throw new TypeError(`${field} must be 5000 characters or fewer.`);
  }

  return {
    ...Object.fromEntries(fields.map((field) => [field, typeof draft[field] === "string" ? draft[field].trim() : draft[field]])),
    category: source.category,
    source: { document: source.document, section: "Kanban tasks", schemaVersion: TASK_SCHEMA_VERSION },
  };
}

export function allocateTaskId(sourceType, tasks) {
  const source = TASK_SOURCES[sourceType];
  if (!source) throw new TypeError(`Unsupported task source "${sourceType}".`);
  const prefix = `${source.prefix}-`;
  const maxId = tasks.reduce((maximum, task) => {
    if (!task.id.startsWith(prefix)) return maximum;
    const suffix = task.id.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(maximum, Number(suffix)) : maximum;
  }, 0);
  const width = source.prefix === "TD" ? 2 : 3;
  return `${source.prefix}-${String(maxId + 1).padStart(width, "0")}`;
}

export function nextTaskOrder(tasks, status) {
  const maxOrder = tasks
    .filter((task) => task.status === status)
    .reduce((maximum, task) => Math.max(maximum, task.order), Number.NEGATIVE_INFINITY);
  return Number.isFinite(maxOrder) ? maxOrder + 100 : 100;
}

function taskTableLayout(markdown, source) {
  const schema = findSchemaTable(markdown, source);
  if (!schema) throw new Error(`${source}: the task schema is required for this operation.`);

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SCHEMA_HEADING);
  const sectionEnd = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const limit = sectionEnd === -1 ? lines.length : sectionEnd;
  const markerIndex = lines.findIndex(
    (line, index) => index > headingIndex && index < limit && line.trim() === SCHEMA_MARKER,
  );
  let headerIndex = markerIndex + 1;
  while (headerIndex < limit && !lines[headerIndex].trim().startsWith("|")) headerIndex += 1;
  if (headerIndex + 1 >= limit) throw new Error(`${source}: task table header or separator is missing.`);

  let insertionIndex = headerIndex + 2;
  while (insertionIndex < limit && lines[insertionIndex].trim().startsWith("|")) insertionIndex += 1;
  return { lines, headers: schema.headers, headerIndex, insertionIndex };
}

function formatTaskRow(task, headers) {
  const values = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    order: task.order,
    area: task.area,
    category: task.category,
    details: task.details,
    limitation: task.limitation,
    recommendedFix: task.recommendedFix,
    rationale: task.rationale,
  };
  return formatMarkdownRow(headers.map((header) => values[fieldName(header)] ?? ""));
}

export function appendTaskRecord(markdown, task) {
  const { lines, headers, insertionIndex } = taskTableLayout(markdown, task.source.document);
  if (!headers.includes("ID") || !headers.includes("Title")) {
    throw new Error(`${task.source.document}: task table is missing required columns.`);
  }
  lines.splice(insertionIndex, 0, formatTaskRow(task, headers));
  return lines.join("\n");
}

export function deleteTaskRecord(markdown, taskId, source) {
  if (typeof taskId !== "string" || !/^[A-Z][A-Z0-9]*-\d{2,4}$/.test(taskId)) {
    throw new TypeError("A valid task ID is required.");
  }
  const { lines, headers, headerIndex, insertionIndex } = taskTableLayout(markdown, source);
  const idIndex = headers.findIndex((header) => header.toLowerCase() === "id");
  if (idIndex === -1) throw new Error(`${source}: task table is missing the ID column.`);
  const rowIndex = lines.findIndex((line, index) => {
    if (index < headerIndex + 2 || index >= insertionIndex || !line.trim().startsWith("|")) return false;
    const cells = splitMarkdownRow(line);
    return cells[idIndex] === taskId;
  });
  if (rowIndex === -1) throw new Error(`Task "${taskId}" was not found in the source document.`);
  lines.splice(rowIndex, 1);
  return lines.join("\n");
}

export function renderTaskTable(tasks, extraColumns = ["Details"]) {
  const headers = [...TASK_COLUMNS, ...extraColumns];
  const separator = headers.map(() => "---");
  const rows = tasks.map((task) => [
    task.id,
    task.title,
    task.status,
    task.priority,
    task.order,
    task.area,
    task.category,
    ...extraColumns.map((column) => task[fieldName(column)] ?? ""),
  ]);
  return [formatMarkdownRow(headers), formatMarkdownRow(separator), ...rows.map(formatMarkdownRow)].join("\n");
}

export function migrateLegacyMarkdown(markdown, sourceFile, tasks) {
  requireText(markdown, sourceFile);
  if (!Array.isArray(tasks)) throw new TypeError(`${sourceFile}: tasks must be an array.`);
  if (findSchemaTable(markdown, sourceFile)) {
    throw new Error(`${sourceFile}: the task schema is already present.`);
  }

  const isTechnicalDebt = sourceFile === SOURCE_FILES.technicalDebt;
  const extraColumns = isTechnicalDebt
    ? ["Limitation", "Recommended fix", "Rationale", "Details"]
    : ["Details"];
  const tableTasks = isTechnicalDebt
    ? tasks.map((task) => ({ ...task, details: task.limitation ? "" : task.details }))
    : tasks;
  const table = `${SCHEMA_HEADING}\n${SCHEMA_MARKER}\n${renderTaskTable(tableTasks, extraColumns)}`;
  const lines = markdown.split(/\r?\n/);

  if (sourceFile === SOURCE_FILES.roadmap) {
    if (!lines.some((line) => line.trim() === "## Completed")) {
      throw new Error(`${sourceFile}: legacy roadmap sections were not found.`);
    }
    return `${markdown.trimEnd()}\n\n${table}\n`;
  }

  if (sourceFile === SOURCE_FILES.technicalDebt) {
    const start = lines.findIndex((line) => line.trim() === "## Register");
    const nextHeading = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
    if (start === -1) {
      throw new Error(`${sourceFile}: legacy debt register was not found.`);
    }
    const insertAt = nextHeading === -1 ? lines.length : nextHeading;
    return [
      ...lines.slice(0, start + 1),
      "",
      "<!-- Kanban task rows are canonical for board status, priority, and order. -->",
      SCHEMA_HEADING,
      SCHEMA_MARKER,
      renderTaskTable(tableTasks, extraColumns),
      "",
      ...lines.slice(insertAt),
    ].join("\n");
  }

  if (sourceFile === SOURCE_FILES.repositoryAudit) {
    return `${markdown.trimEnd()}\n\n${table}\n`;
  }

  throw new Error(`Unsupported task source "${sourceFile}".`);
}
