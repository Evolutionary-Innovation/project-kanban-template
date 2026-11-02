import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  allocateTaskId,
  appendTaskRecord,
  deleteTaskRecord,
  parseBoardDocuments,
  updateTaskRecord,
  validateTaskDraft,
} from "./board-data.mjs";
import { readBoardConfig } from "./board-config.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function loadProject(root = workspaceRoot) {
  const config = await readBoardConfig(root);
  const documents = Object.fromEntries(
    await Promise.all(
      config.sources.map(async (source) => [source.path, await readFile(`${root}/${source.path}`, "utf8")]),
    ),
  );
  return { config, documents };
}

test("parses the configured starter documents into status-derived columns", async () => {
  const { config, documents } = await loadProject();
  const board = parseBoardDocuments(documents, config);

  assert.equal(board.config.boardTitle, "Project Kanban");
  assert.deepEqual(board.columns.map(({ status }) => status), config.statuses);
  assert.equal(board.tasks.length, 4);
  assert.ok(board.tasks.every((task) => config.statuses.includes(task.status)));
  assert.deepEqual(board.sources, config.sources.map(({ path }) => path));
});

test("parses an independent project's statuses, source paths, priorities, and extra fields", async () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const { config, documents } = await loadProject(exampleRoot);
  const board = parseBoardDocuments(documents, config);
  const experiment = board.tasks.find(({ id }) => id === "EXP-001");

  assert.deepEqual(board.columns.map(({ status }) => status), ["Open", "Doing", "Done"]);
  assert.equal(experiment.hypothesis, "A short daily review will reduce missed follow-ups.");
  assert.equal(board.tasks.find(({ id }) => id === "PLAN-001").priority, "Urgent");
});

test("allocates source-specific IDs and appends configured extra fields", async () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const { config, documents } = await loadProject(exampleRoot);
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

test("edits and deletes only the selected canonical row while preserving prose", async () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const { config, documents } = await loadProject(exampleRoot);
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

  const invalidPriority = documents[audit.path].replace("| Medium | 100 |", "| Urgent | 100 |");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: invalidPriority }, config), /unsupported Priority/);

  const roadmap = config.sources[0];
  const duplicateRow = documents[roadmap.path].replace(
    "| RM-002 | Add optional task-field display preferences | Future Ideas | Low | 200 | User experience | Enhancement | Consider only if real projects need per-field card summaries. |",
    "| RM-001 | Duplicate | Planned | High | 300 | Example | Feature | Duplicate ID. |",
  );
  assert.throws(() => parseBoardDocuments({ ...documents, [roadmap.path]: duplicateRow }, config), /Duplicate task ID/);
});
