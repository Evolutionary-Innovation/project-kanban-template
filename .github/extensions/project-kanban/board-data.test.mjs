import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  allocateTaskId,
  appendTaskRecord,
  deleteTaskRecord,
  migrateLegacyMarkdown,
  parseBoardDocuments,
  updateTaskRecord,
  validateTaskDraft,
} from "./board-data.mjs";
import { readBoardConfig, validateBoardConfig } from "./board-config.mjs";

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
  assert.equal(experiment.createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "PLAN-001").priority, "Urgent");
});

test("adds configured date fields when an explicit legacy adapter migrates a source", async () => {
  const rawConfig = JSON.parse(await readFile(`${workspaceRoot}/project-kanban.config.json`, "utf8"));
  rawConfig.schemaMarker = "<!-- trade-mstr-kanban-schema:1 -->";
  for (const source of rawConfig.sources) {
    source.legacyAdapter = "trade-mstr-v1";
    source.extraFields = [
      { key: "createdDate", label: "Created Date", type: "date" },
      { key: "completionDate", label: "Completion Date", type: "date" },
    ];
  }
  rawConfig.sources[2].legacyIdPrefixes = ["TD"];
  const config = validateBoardConfig(rawConfig);
  const documents = {
    "docs/roadmap.md": `# Roadmap
## Completed
**Dashboard**
- The dashboard loads its data.
## Next
1. **Tests for pure libraries** (\`metrics.ts\`, \`kpis.ts\`).
## Future
- **Data pipeline:** automate daily ingestion.
`,
    "docs/technical-debt.md": `# Technical Debt Register
## Register
| ID | Severity | Area | Limitation | Recommended fix | Rationale |
|---|---|---|---|---|---|
| TD-02 | Medium | Testing | Some tests are missing. | Add unit tests for pure libraries. | Regressions may be silent. |
## Closed: TD-19 - Moving averages restarted warm-up at the display boundary
The closed task details must remain available.
`,
    "docs/repository-audit.md": `# Repository Audit
## Recommendations
Recommendations require current-state verification before action.
`,
  };
  const board = parseBoardDocuments(documents, config);
  assert.ok(board.tasks.every(({ createdDate, completionDate }) => createdDate === "" && completionDate === ""));
  assert.ok(board.tasks.every(({ completionDate }) => completionDate === ""));
  const migrated = Object.fromEntries(
    config.sources.map((source) => [
      source.path,
      migrateLegacyMarkdown(
        documents[source.path],
        source,
        board.tasks.filter(({ source: taskSource }) => taskSource.document === source.path),
        config,
      ),
    ]),
  );
  assert.match(migrated["docs/roadmap.md"], /\| Completion Date \|/);
  assert.match(migrated["docs/roadmap.md"], /\| Created Date \|/);
  assert.ok(parseBoardDocuments(migrated, config).tasks.every(({ createdDate, completionDate }) => createdDate === "" && completionDate === ""));
});

test("parses the isolated synthetic browser fixture with its exact UX data distributions", async () => {
  const fixtureRoot = fileURLToPath(new URL("../../../examples/synthetic-browser-project/", import.meta.url));
  const { config, documents } = await loadProject(fixtureRoot);
  const board = parseBoardDocuments(documents, config);
  const counts = (field) =>
    Object.fromEntries([...new Set(board.tasks.map((task) => task[field]))]
      .map((value) => [value, board.tasks.filter((task) => task[field] === value).length]));

  assert.equal(board.tasks.length, 60);
  assert.equal(board.config.completionStatus, "Complete");
  assert.deepEqual(counts("status"), {
    Complete: 10,
    "In Progress": 10,
    Planned: 16,
    Research: 12,
    "Future Ideas": 12,
  });
  assert.deepEqual(counts("priority"), { High: 20, Medium: 24, Low: 16 });
  assert.deepEqual(counts("category"), {
    Delivery: 12,
    Reliability: 12,
    "User experience": 10,
    Compatibility: 10,
    Documentation: 8,
    Research: 8,
  });
  assert.equal(new Set(board.tasks.map((task) => task.area)).size, 9);
  assert.equal(board.tasks.filter(({ createdDate }) => createdDate).length, 58);
  assert.equal(board.tasks.filter(({ completionDate }) => completionDate).length, 10);
  assert.ok(board.tasks.every(({ id, title }) => title.startsWith(`${id}: `)));
  assert.equal(board.tasks.find(({ id }) => id === "RM-019").createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "RA-005").createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "RM-005").completionDate, "2026-03-14");
  assert.equal(board.tasks.find(({ id }) => id === "RA-008").status, "Complete");
  assert.equal(board.tasks.find(({ id }) => id === "RA-008").completionDate, "");
  assert.match(board.tasks.find(({ id }) => id === "RM-002").details, /escaped pipe \| stays/);
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

  const invalidSequence = `${documents[audit.path]}\n<!-- project-kanban-id-sequence:TD:2 -->`;
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: invalidSequence }, config), /does not match RA/);

  const invalidPriority = documents[audit.path].replace("| Medium | 100 |", "| Urgent | 100 |");
  assert.throws(() => parseBoardDocuments({ ...documents, [audit.path]: invalidPriority }, config), /unsupported Priority/);

  const roadmap = config.sources[0];
  const originalRow = documents[roadmap.path].split(/\r?\n/).find((line) => line.startsWith("| RM-001 |"));
  assert.ok(originalRow);
  const duplicateRow = documents[roadmap.path].replace(originalRow, `${originalRow}\n${originalRow}`);
  assert.throws(() => parseBoardDocuments({ ...documents, [roadmap.path]: duplicateRow }, config), /Duplicate task ID/);

  const fixtureRoot = fileURLToPath(new URL("../../../examples/synthetic-browser-project/", import.meta.url));
  const fixture = await loadProject(fixtureRoot);
  const fixtureAudit = fixture.config.sources[2];
  const invalidDate = fixture.documents[fixtureAudit.path].replace("2026-10-05", "2026-02-30");
  assert.throws(
    () => parseBoardDocuments({ ...fixture.documents, [fixtureAudit.path]: invalidDate }, fixture.config),
    /invalid Completion Date/,
  );
});
