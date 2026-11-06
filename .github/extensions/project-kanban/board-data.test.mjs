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

  assert.equal(task.dependsOn, "");
  assert.equal(task.executionType, "");
  const normalized = normalizeConfiguredTaskTable(olderMarkdown, source, config);
  assert.match(normalized, /\| Depends On \|/);
  assert.match(normalized, /\| Execution Type \|/);
  assert.doesNotMatch(normalized, /\| Blocked By \|/);
  assert.equal(
    parseBoardDocuments({ ...documents, [source.path]: normalized }, config).tasks.find(({ id }) => id === "RM-001").dependsOn,
    "",
  );
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
    status: "Open",
    priority: "Standard",
    details: "Compare completion rates.",
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
});

test("edits and deletes only the selected canonical row while preserving prose", () => {
  const { config, documents } = loadProject(independentTestConfig());
  const source = config.sources.find(({ key }) => key === "experiments");
  const edited = updateTaskRecord(
    documents[source.path],
    "EXP-001",
    { status: "Done", details: "Verified | repeatable", hypothesis: "Updated hypothesis." },
    source,
    config,
  );
  assert.match(edited, /## Kanban tasks/);
  assert.match(edited, /Verified \\| repeatable/);
  assert.match(edited, /Updated hypothesis/);

  const deleted = deleteTaskRecord(edited, "EXP-001", source, config);
  assert.match(deleted, /Use the Hypothesis field/);
  assert.doesNotMatch(deleted, /\| EXP-001 \|/);
});

test("rejects malformed schemas, invalid values, and duplicate task IDs", async () => {
  const { config, documents } = await loadProject();
  const audit = config.sources[2];
  const missingMarker = documents[audit.path].replace(config.schemaMarker, "<!-- other-schema:1 -->");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: missingMarker }, config), /schema marker/);

  const invalidSequence = `${documents[audit.path]}\n<!-- project-kanban-id-sequence:${config.sources[2].legacyIdPrefixes[0] ?? "TD"}:2 -->`;
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
