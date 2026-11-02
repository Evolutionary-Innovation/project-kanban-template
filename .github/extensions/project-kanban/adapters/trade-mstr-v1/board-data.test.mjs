import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateTaskId,
  appendTaskRecord,
  deleteTaskRecord,
  migrateLegacyMarkdown,
  nextTaskOrder,
  parseBoardDocuments,
  SOURCE_FILES,
  updateTaskRecord,
} from "./board-data.mjs";

const roadmap = `# Roadmap
## Completed
**Dashboard**
- The dashboard loads its data.
## Next
1. **Tests for pure libraries** (\`metrics.ts\`, \`kpis.ts\`).
## Future
- **Data pipeline:** automate daily ingestion.
`;

const technicalDebt = `# Technical Debt Register
## Register
| ID | Severity | Area | Limitation | Recommended fix | Rationale |
|---|---|---|---|---|---|
| TD-02 | Medium | Testing | Some tests are missing. | Add unit tests for pure libraries. | Regressions may be silent. |
| TD-14 | Low | Dashboard | Browser behavior is untested. | Verify the empty range in a browser. | Avoid confusing users. |
## Closed: TD-19 - Moving averages restarted warm-up at the display boundary
The closed task details must remain available.
`;

const repositoryAudit = `# Repository Audit
## Recommendations
Recommendations require current-state verification before action.
`;

function parseFixtures() {
  return parseBoardDocuments({ roadmap, technicalDebt, repositoryAudit });
}

test("parses legacy Markdown into status columns and assigns stable numeric order", () => {
  const board = parseFixtures();
  assert.deepEqual(
    board.columns.map(({ status }) => status),
    ["Complete", "In Progress", "Planned", "Research", "Future Ideas"],
  );
  assert.equal(board.columns[0].cards[0].title, "The dashboard loads its data");
  assert.equal(board.columns[1].cards.length, 0);
  assert.equal(board.columns[2].cards.length, 2);
  assert.equal(board.columns[3].cards.length, 2);
  assert.equal(board.columns[4].cards.length, 1);
  assert.ok(board.tasks.every(({ order }) => Number.isFinite(order)));
  assert.ok(board.tasks.some(({ id, category }) => id === "TD-20" && category === "Research/Audit"));
});

test("migrates each source without deleting its legacy documentation", () => {
  const board = parseFixtures();
  const documents = { [SOURCE_FILES.roadmap]: roadmap, [SOURCE_FILES.technicalDebt]: technicalDebt, [SOURCE_FILES.repositoryAudit]: repositoryAudit };
  const migrated = Object.fromEntries(
    Object.entries(documents).map(([source, markdown]) => [
      source,
      migrateLegacyMarkdown(
        markdown,
        source,
        board.tasks.filter((task) => task.source.document === source),
      ),
    ]),
  );

  assert.match(migrated[SOURCE_FILES.roadmap], /## Completed[\s\S]*## Next[\s\S]*## Future/);
  assert.match(migrated[SOURCE_FILES.technicalDebt], /Some tests are missing\./);
  assert.match(migrated[SOURCE_FILES.technicalDebt], /The closed task details must remain available\./);
  assert.match(migrated[SOURCE_FILES.repositoryAudit], /Recommendations require current-state verification/);
  const canonicalBoard = parseBoardDocuments({
    roadmap: migrated[SOURCE_FILES.roadmap],
    technicalDebt: migrated[SOURCE_FILES.technicalDebt],
    repositoryAudit: migrated[SOURCE_FILES.repositoryAudit],
  });
  assert.deepEqual(
    canonicalBoard.tasks.map(({ id, title, status, priority, order, area, category }) => ({
      id,
      title,
      status,
      priority,
      order,
      area,
      category,
    })),
    board.tasks.map(({ id, title, status, priority, order, area, category }) => ({
      id,
      title,
      status,
      priority,
      order,
      area,
      category,
    })),
  );
});

test("updates only Status and Order in a canonical task record", () => {
  const board = parseFixtures();
  const sourceTasks = board.tasks.filter((task) => task.source.document === SOURCE_FILES.roadmap);
  const migrated = migrateLegacyMarkdown(roadmap, SOURCE_FILES.roadmap, sourceTasks);
  const updated = updateTaskRecord(migrated, "RM-001", { status: "In Progress", order: 42 });
  const parsed = parseBoardDocuments({
    roadmap: updated,
    technicalDebt: migrateLegacyMarkdown(
      technicalDebt,
      SOURCE_FILES.technicalDebt,
      board.tasks.filter((task) => task.source.document === SOURCE_FILES.technicalDebt),
    ),
    repositoryAudit: migrateLegacyMarkdown(
      repositoryAudit,
      SOURCE_FILES.repositoryAudit,
      board.tasks.filter((task) => task.source.document === SOURCE_FILES.repositoryAudit),
    ),
  });
  const moved = parsed.tasks.find(({ id }) => id === "RM-001");
  assert.equal(moved.status, "In Progress");
  assert.equal(moved.order, 42);
  assert.equal(moved.title, "The dashboard loads its data");
  assert.equal(moved.priority, "Medium");
});

test("keeps technical-debt detail columns editable as separate fields", () => {
  const board = parseFixtures();
  const debtTasks = board.tasks.filter((task) => task.source.document === SOURCE_FILES.technicalDebt);
  const migrated = migrateLegacyMarkdown(technicalDebt, SOURCE_FILES.technicalDebt, debtTasks);
  const canonicalBoard = parseBoardDocuments({
    roadmap: migrateLegacyMarkdown(
      roadmap,
      SOURCE_FILES.roadmap,
      board.tasks.filter((task) => task.source.document === SOURCE_FILES.roadmap),
    ),
    technicalDebt: migrated,
    repositoryAudit: migrateLegacyMarkdown(
      repositoryAudit,
      SOURCE_FILES.repositoryAudit,
      board.tasks.filter((task) => task.source.document === SOURCE_FILES.repositoryAudit),
    ),
  });
  const debt = canonicalBoard.tasks.find(({ id }) => id === "TD-02");
  assert.equal(debt.details, "");
  assert.equal(debt.limitation, "Some tests are missing.");
  assert.equal(debt.recommendedFix, "Add unit tests for pure libraries.");
  assert.equal(debt.rationale, "Regressions may be silent.");

  const edited = updateTaskRecord(migrated, "TD-02", {
    title: "Test coverage",
    status: "Research",
    priority: "High",
    area: "Quality",
    category: "Research/Audit",
    details: "Track the remaining test gaps.",
    limitation: "Unit tests are missing.",
    recommendedFix: "Add deterministic unit tests.",
    rationale: "Prevent silent regressions.",
  });
  const parsedEdit = parseBoardDocuments({
    roadmap,
    technicalDebt: edited,
    repositoryAudit,
  });
  const updated = parsedEdit.tasks.find(({ id }) => id === "TD-02");
  assert.deepEqual(
    {
      title: updated.title,
      status: updated.status,
      priority: updated.priority,
      area: updated.area,
      category: updated.category,
      details: updated.details,
      limitation: updated.limitation,
      recommendedFix: updated.recommendedFix,
      rationale: updated.rationale,
    },
    {
      title: "Test coverage",
      status: "Research",
      priority: "High",
      area: "Quality",
      category: "Research/Audit",
      details: "Track the remaining test gaps.",
      limitation: "Unit tests are missing.",
      recommendedFix: "Add deterministic unit tests.",
      rationale: "Prevent silent regressions.",
    },
  );
});

test("reads v1 debt rows with the previous concatenated detail representation", () => {
  const legacyV1Debt = `# Technical Debt Register
## Register
## Kanban tasks
<!-- trade-mstr-kanban-schema:1 -->
| ID | Title | Status | Priority | Order | Area | Category | Limitation | Recommended fix | Rationale | Details |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-02 | Test debt item | Planned | Medium | 100 | Testing | Technical Debt |  |  |  | Limitation: Tests are missing. Recommended fix: Add tests. Rationale: Prevent regressions. |
`;
  const board = parseBoardDocuments({
    roadmap,
    technicalDebt: legacyV1Debt,
    repositoryAudit,
  });
  const task = board.tasks.find(({ id }) => id === "TD-02");
  assert.equal(task.limitation, "Tests are missing.");
  assert.equal(task.recommendedFix, "Add tests.");
  assert.equal(task.rationale, "Prevent regressions.");
  assert.equal(task.details, "");
});

test("appends and deletes canonical rows without changing surrounding narrative", () => {
  const board = parseFixtures();
  const auditTasks = board.tasks.filter((task) => task.source.document === SOURCE_FILES.repositoryAudit);
  const migrated = migrateLegacyMarkdown(repositoryAudit, SOURCE_FILES.repositoryAudit, auditTasks);
  const task = {
    id: allocateTaskId("researchAudit", board.tasks),
    title: "Review repository recommendation",
    status: "Planned",
    priority: "Low",
    order: nextTaskOrder(board.tasks, "Planned"),
    area: "Repository",
    category: "Research/Audit",
    details: "Review the recommendation before implementation.",
    source: { document: SOURCE_FILES.repositoryAudit },
  };
  assert.equal(task.id, "RA-001");
  assert.equal(task.order, 100200);
  const withTask = appendTaskRecord(migrated, task);
  assert.match(withTask, /Recommendations require current-state verification before action\./);
  assert.match(withTask, /\| RA-001 \| Review repository recommendation \| Planned \| Low \| 100200 \| Repository \| Research\/Audit \|/);
  const withoutTask = deleteTaskRecord(withTask, task.id, SOURCE_FILES.repositoryAudit);
  assert.doesNotMatch(withoutTask, /\| RA-001 \|/);
  assert.match(withoutTask, /Recommendations require current-state verification before action\./);
});

test("rejects malformed or duplicate canonical tasks", () => {
  const board = parseFixtures();
  const sourceTasks = board.tasks.filter((task) => task.source.document === SOURCE_FILES.roadmap);
  const canonicalRoadmap = migrateLegacyMarkdown(roadmap, SOURCE_FILES.roadmap, sourceTasks);
  assert.throws(
    () =>
      parseBoardDocuments({
        roadmap: canonicalRoadmap.replace("| --- | --- |", "| bad | --- |"),
        technicalDebt: migrateLegacyMarkdown(
          technicalDebt,
          SOURCE_FILES.technicalDebt,
          board.tasks.filter((task) => task.source.document === SOURCE_FILES.technicalDebt),
        ),
        repositoryAudit,
      }),
    /invalid separator/,
  );
});
