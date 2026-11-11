import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateTaskId,
  appendTaskRecord,
  deleteTaskRecord,
  normalizeConfiguredTaskTable,
  parseBoardDocuments,
  updateTaskRecord,
  validateTaskDraft,
} from "./board-data.mjs";
import { validateBoardConfig } from "./board-config.mjs";
import { independentTestConfig, testConfig, testDocuments } from "./test-fixtures.mjs";

function loadProject(config = testConfig()) {
  const validatedConfig = validateBoardConfig(config);
  return { config: validatedConfig, documents: testDocuments(config) };
}

test("parses self-contained contract documents into status-derived columns", async () => {
  const { config, documents } = await loadProject();
  const board = parseBoardDocuments(documents, config);

  assert.equal(board.config.boardTitle, "Contract Test Board");
  assert.deepEqual(board.columns.map(({ status }) => status), config.statuses);
  assert.equal(board.tasks.length, 5);
  assert.ok(board.tasks.every((task) => config.statuses.includes(task.status)));
  assert.deepEqual(board.sources, config.sources.map(({ path }) => path));
});

test("keeps narrative dependency suggestions separate from the canonical graph", async () => {
  const { config, documents } = await loadProject();
  const baseline = parseBoardDocuments(documents, config);
  const roadmapPath = config.sources.find(({ key }) => key === "roadmap").path;
  const narrativeDocuments = {
    ...documents,
    [roadmapPath]: documents[roadmapPath].replace(
      "A generic contract record.",
      "This task depends on TD-01.",
    ),
  };
  const board = parseBoardDocuments(narrativeDocuments, config);

  assert.deepEqual(board.dependencyGraph, baseline.dependencyGraph);
  assert.deepEqual(
    board.tasks.find(({ id }) => id === "RM-001").dependencyView,
    baseline.tasks.find(({ id }) => id === "RM-001").dependencyView,
  );
  assert.deepEqual(
    board.dependencySuggestions.map(({ dependentTaskId, prerequisiteTaskId, field, relationshipPhrase }) => ({
      dependentTaskId,
      prerequisiteTaskId,
      field,
      relationshipPhrase,
    })),
    [{ dependentTaskId: "RM-001", prerequisiteTaskId: "TD-01", field: "Details", relationshipPhrase: "depends on" }],
  );
});

test("reads schema-v1 tables with omitted optional fields and normalizes them on write", async () => {
  const { config, documents } = await loadProject();
  const source = config.sources[0];
  const olderMarkdown = `# Roadmap

## Kanban tasks
${config.schemaMarker}
| ID | Title | Status | Priority | Order | Area | Category | Details |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RM-001 | Retain old schema rows | Planned | High | 100 | Core | Delivery | Existing task. |
`;
  const parsed = parseBoardDocuments({ ...documents, [source.path]: olderMarkdown }, config);
  const task = parsed.tasks.find(({ id }) => id === "RM-001");

  assert.equal(task.acceptanceCriteria, "");
  assert.equal(task.dependsOn, "");
  assert.equal(task.executionType, "");
  const normalized = normalizeConfiguredTaskTable(olderMarkdown, source, config);
  assert.match(normalized, /\| Acceptance Criteria \|/);
  assert.match(normalized, /\| Depends On \|/);
  assert.match(normalized, /\| Execution Type \|/);
  assert.doesNotMatch(normalized, /\| Blocked By \|/);
  assert.equal(
    parseBoardDocuments({ ...documents, [source.path]: normalized }, config).tasks.find(({ id }) => id === "RM-001").dependsOn,
    "",
  );
});

test("preserves historic br cells during schema normalization until the row is edited", async () => {
  const { config, documents } = await loadProject();
  const source = config.sources[0];
  const olderMarkdown = `# Roadmap

## Kanban tasks
${config.schemaMarker}
| ID | Title | Status | Priority | Order | Area | Category | Details |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RM-001 | Retain old schema rows | Planned | High | 100 | Core | Delivery | Existing<br>multiline details. |
`;
  const normalized = normalizeConfiguredTaskTable(olderMarkdown, source, config);
  assert.ok(normalized.includes("Existing<br>multiline details."));
  assert.equal(
    parseBoardDocuments({ ...documents, [source.path]: normalized }, config)
      .tasks.find(({ id }) => id === "RM-001").details,
    "Existing\nmultiline details.",
  );

  const edited = updateTaskRecord(normalized, "RM-001", { title: "Edited old task" }, source, config);
  assert.ok(edited.includes("Existing&#10;multiline details."));
  assert.doesNotMatch(edited, /<br\s*\/?>/i);
});

test("round-trips multiline text through table-safe newline entities", () => {
  const { config, documents } = loadProject();
  const source = config.sources[0];
  const details = "Description:\n1. First item\n2. Second item";
  const acceptanceCriteria = "Criteria:\n1. First outcome\n2. Second outcome";
  const encoded = updateTaskRecord(documents[source.path], "RM-001", {
    details,
    acceptanceCriteria,
  }, source, config);

  assert.ok(encoded.includes("Description:&#10;1. First item&#10;2. Second item"));
  assert.ok(encoded.includes("Criteria:&#10;1. First outcome&#10;2. Second outcome"));
  assert.doesNotMatch(encoded, /<br\s*\/?>/i);
  const task = parseBoardDocuments({ ...documents, [source.path]: encoded }, config)
    .tasks.find(({ id }) => id === "RM-001");
  assert.equal(task.details, details);
  assert.equal(task.acceptanceCriteria, acceptanceCriteria);

  const literalMarker = "Literal &#10; marker, C:\\notes, and pipe A | B.";
  const encodedLiteral = updateTaskRecord(encoded, "RM-001", { details: literalMarker }, source, config);
  assert.ok(encodedLiteral.includes("Literal \\&#10; marker"));
  assert.equal(
    parseBoardDocuments({ ...documents, [source.path]: encodedLiteral }, config)
      .tasks.find(({ id }) => id === "RM-001").details,
    literalMarker,
  );
});

test("reads historic br line breaks and normalizes them on edit", () => {
  const { config, documents } = loadProject();
  const source = config.sources[0];
  const details = "Description:\n1. Historic item\n2. Retained item";
  const acceptanceCriteria = "Criteria:\n1. Historic outcome\n2. Retained outcome";
  const encoded = updateTaskRecord(documents[source.path], "RM-001", {
    details,
    acceptanceCriteria,
  }, source, config);
  const legacy = encoded.replaceAll("&#10;", "<br>");
  const legacyBoard = parseBoardDocuments({ ...documents, [source.path]: legacy }, config);
  const legacyTask = legacyBoard.tasks.find(({ id }) => id === "RM-001");

  assert.equal(legacyTask.details, details);
  assert.equal(legacyTask.acceptanceCriteria, acceptanceCriteria);

  const normalized = updateTaskRecord(legacy, "RM-001", { title: "Edited historic task" }, source, config);
  assert.doesNotMatch(normalized, /<br\s*\/?>/i);
  assert.ok(normalized.includes("Description:&#10;1. Historic item"));
  const normalizedTask = parseBoardDocuments({ ...documents, [source.path]: normalized }, config)
    .tasks.find(({ id }) => id === "RM-001");
  assert.equal(normalizedTask.details, details);
  assert.equal(normalizedTask.acceptanceCriteria, acceptanceCriteria);
});

test("preserves historical ID aliases without a legacy-format adapter", () => {
  const rawConfig = testConfig();
  rawConfig.sources[2].legacyIdPrefixes = ["OLD"];
  const { config, documents } = loadProject(rawConfig);
  const audit = config.sources[2];
  const roadmap = config.sources[0];
  const aliasedAudit = documents[audit.path].replace("| RA-001 |", "| OLD-20 |");
  const dependentRoadmap = updateTaskRecord(
    documents[roadmap.path],
    "RM-001",
    { dependsOn: "OLD-20" },
    roadmap,
    config,
  );
  const board = parseBoardDocuments({
    ...documents,
    [audit.path]: aliasedAudit,
    [roadmap.path]: dependentRoadmap,
  }, config);

  const historicalTask = board.tasks.find(({ id }) => id === "OLD-20");
  assert.equal(historicalTask.source.document, audit.path);
  assert.deepEqual(board.tasks.find(({ id }) => id === "RM-001").dependencyView.dependsOn, ["OLD-20"]);
  assert.equal(allocateTaskId("repositoryAudit", board.tasks, config), "RA-001");
});

test("parses a separately configured project's statuses, source paths, priorities, and extra fields", () => {
  const { config, documents } = loadProject(independentTestConfig());
  const board = parseBoardDocuments(documents, config);
  const experiment = board.tasks.find(({ id }) => id === "EXP-001");

  assert.deepEqual(board.columns.map(({ status }) => status), ["Open", "Doing", "Done"]);
  assert.equal(experiment.hypothesis, "A weekly review will reduce missed follow-ups.");
  assert.equal(experiment.createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "PLAN-001").priority, "Urgent");
  assert.deepEqual(experiment.dependencyView.dependsOn, ["PLAN-001"]);
});

test("allocates configured IDs and appends configured extra fields", () => {
  const { config, documents } = loadProject(independentTestConfig());
  const board = parseBoardDocuments(documents, config);
  const source = config.sources.find(({ key }) => key === "experiments");
  const draft = validateTaskDraft("experiments", {
    title: "Test a weekly review",
    area: "Research",
    category: "Workflow Research",
    status: "Open",
    priority: "Standard",
    details: "Compare completion rates.",
    acceptanceCriteria: "A successful test has measurable results.",
    hypothesis: "Weekly review will reduce missed items.",
  }, config);
  const task = {
    ...draft,
    id: allocateTaskId("experiments", board.tasks, config),
    order: 200,
  };
  const updated = appendTaskRecord(documents[source.path], task, source, config);
  const parsed = parseBoardDocuments({ ...documents, [source.path]: updated }, config);

  assert.equal(task.id, "EXP-002");
  assert.equal(parsed.tasks.find(({ id }) => id === "EXP-002").hypothesis, "Weekly review will reduce missed items.");
  assert.equal(parsed.tasks.find(({ id }) => id === "EXP-002").category, "Workflow Research");
  assert.equal(parsed.tasks.find(({ id }) => id === "EXP-002").acceptanceCriteria, "A successful test has measurable results.");
  assert.match(updated, /A successful test has measurable results\./);
  assert.equal(validateTaskDraft("experiments", {
    title: "Use the configured category",
    area: "Research",
    status: "Open",
    priority: "Standard",
    details: "",
    acceptanceCriteria: "",
    hypothesis: "Check the configured category fallback.",
  }, config).category, source.category);
  assert.throws(() => validateTaskDraft("experiments", {
    title: "Reject an empty category",
    area: "Research",
    category: "",
    status: "Open",
    priority: "Standard",
    details: "",
    acceptanceCriteria: "",
    hypothesis: "Check that invalid categories are rejected.",
  }, config), /Category must be a non-empty string/);
  assert.throws(() => validateTaskDraft("experiments", {
    title: "Reject oversized criteria",
    area: "Research",
    status: "Open",
    priority: "Standard",
    details: "",
    acceptanceCriteria: "x".repeat(5001),
    hypothesis: "Verify field limits.",
  }, config), /Acceptance Criteria is empty or exceeds its maximum length/);
});

test("edits and deletes only the selected canonical row while preserving prose", () => {
  const { config, documents } = loadProject(independentTestConfig());
  const source = config.sources.find(({ key }) => key === "experiments");
  const edited = updateTaskRecord(
    documents[source.path],
    "EXP-001",
    {
      status: "Done",
      details: "Verified | repeatable",
      acceptanceCriteria: "Observed | repeatable result.",
      hypothesis: "Updated hypothesis.",
    },
    source,
    config,
  );
  assert.match(edited, /## Kanban tasks/);
  assert.match(edited, /Verified \\| repeatable/);
  assert.match(edited, /Updated hypothesis/);
  assert.match(edited, /Observed \\| repeatable result\./);

  const deleted = deleteTaskRecord(edited, "EXP-001", source, config);
  assert.match(deleted, /Use the Hypothesis field/);
  assert.doesNotMatch(deleted, /\| EXP-001 \|/);
});

test("rejects malformed schemas, invalid values, and duplicate task IDs", async () => {
  const { config, documents } = await loadProject();
  const audit = config.sources[2];
  const missingMarker = documents[audit.path].replace(config.schemaMarker, "<!-- other-schema:1 -->");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: missingMarker }, config), /schema marker/);

  const missingTable = documents[audit.path].replace("## Kanban tasks", "## Historical notes");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: missingTable }, config), /canonical schema-v1 task table/);

  const invalidSequence = `${documents[audit.path]}\n<!-- project-kanban-id-sequence:TD:2 -->`;
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: invalidSequence }, config), /does not match RA/);

  const invalidPriority = documents[audit.path].replace("| Low | 100 |", "| Urgent | 100 |");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: invalidPriority }, config), /unsupported Priority/);

  const roadmap = config.sources[0];
  const originalRow = documents[roadmap.path].split(/\r?\n/).find((line) => line.startsWith("| RM-001 |"));
  assert.ok(originalRow);
  const duplicateRow = documents[roadmap.path].replace(originalRow, `${originalRow}\n${originalRow}`);
  assert.throws(() => parseBoardDocuments({ ...documents, [roadmap.path]: duplicateRow }, config), /Duplicate task ID/);

  const invalidDate = documents[audit.path].replace("2026-10-05", "2026-02-30");
  assert.throws(
    () => parseBoardDocuments({ ...documents, [audit.path]: invalidDate }, config),
    /invalid Completion Date/,
  );
});
