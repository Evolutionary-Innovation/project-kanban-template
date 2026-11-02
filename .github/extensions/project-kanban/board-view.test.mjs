import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "./board-config.mjs";
import { parseBoardDocuments } from "./board-data.mjs";
import {
  calculateOrderValue,
  filterTasks,
  formatCardTitle,
  getCardPresentation,
  getDependencyReadiness,
  getWorkflowSummary,
  hasActiveTaskFilters,
  isManualOrderView,
  sortTasks,
} from "./board-view.mjs";

const fixtureRoot = fileURLToPath(new URL("../../../examples/synthetic-browser-project/", import.meta.url));

async function loadFixture(root = fixtureRoot) {
  const config = await readBoardConfig(root);
  const documents = Object.fromEntries(
    await Promise.all(
      config.sources.map(async (source) => [
        source.path,
        await readFile(`${root}/${source.path}`, "utf8"),
      ]),
    ),
  );
  return parseBoardDocuments(documents, config);
}

test("searches case-insensitively across titles, details, and configured source fields", async () => {
  const board = await loadFixture();
  assert.deepEqual(filterTasks(board.tasks, board.config, { search: "cobalt" }).map(({ id }) => id), ["RM-001"]);
  assert.deepEqual(filterTasks(board.tasks, board.config, { search: "saffron details token" }).map(({ id }) => id), ["RM-002"]);
  assert.ok(filterTasks(board.tasks, board.config, { search: "fictional limitation" }).every(({ id }) => id.startsWith("TD-")));
  assert.ok(filterTasks(board.tasks, board.config, { search: "ivory rationale token" }).length > 0);
  assert.ok(filterTasks(board.tasks, board.config, { search: "violet recommendations token" }).length > 0);
  assert.deepEqual(filterTasks(board.tasks, board.config, { search: "no-such-record" }), []);
});

test("combines status, source, priority, category, area, and search filters with AND", async () => {
  const board = await loadFixture();
  const sample = board.tasks.find(({ id }) => id.startsWith("TD-"));
  const criteria = {
    status: sample.status,
    source: "technicalDebt",
    priority: sample.priority,
    category: sample.category,
    area: sample.area,
    search: sample.id.toLowerCase(),
  };

  assert.deepEqual(filterTasks(board.tasks, board.config, criteria).map(({ id }) => id), [sample.id]);
  assert.equal(hasActiveTaskFilters(criteria), true);
  assert.deepEqual(filterTasks(board.tasks, board.config, { status: sample.status })
    .map(({ status }) => status), Array(filterTasks(board.tasks, board.config, { status: sample.status }).length).fill(sample.status));
  assert.equal(isManualOrderView(criteria), false);
  assert.equal(isManualOrderView({}, "priority"), false);
  assert.equal(isManualOrderView({}, "manual"), true);
});

test("searches dependency references and filters blocked, unresolved, and cyclic tasks", async () => {
  const board = await loadFixture();
  const blocked = board.tasks.find(({ dependencyView }) => dependencyView?.isBlocked);
  const unresolved = board.tasks.find(({ dependencyView }) => dependencyView?.hasUnresolved);
  const cyclic = board.tasks.find(({ dependencyView }) => dependencyView?.hasCycle);
  assert.ok(blocked);
  assert.ok(unresolved);
  assert.ok(cyclic);
  assert.ok(filterTasks(board.tasks, board.config, { dependency: "blocked" }).some(({ id }) => id === blocked.id));
  assert.ok(filterTasks(board.tasks, board.config, { dependency: "unresolved" }).some(({ id }) => id === unresolved.id));
  assert.ok(filterTasks(board.tasks, board.config, { dependency: "cycle" }).some(({ id }) => id === cyclic.id));
  assert.ok(filterTasks(board.tasks, board.config, { search: unresolved.dependencyView.unresolved[0] })
    .some(({ id }) => id === unresolved.id));
});

test("derives dependency readiness without changing configured status or persistence", async () => {
  const board = await loadFixture();
  const summary = getWorkflowSummary(board.tasks, board.config);
  const activeCount = board.tasks.filter(({ status }) => status !== board.config.completionStatus).length;
  assert.equal(summary.activeTaskCount, activeCount);
  assert.equal(summary.readyCount + summary.blockedCount + summary.reviewCount, activeCount);
  assert.ok(summary.readyCount > 0);
  assert.ok(summary.blockedCount > 0);
  assert.ok(summary.cycleCount > 0);
  assert.ok(summary.unresolvedCount > 0);

  for (const id of summary.readyTaskIds) {
    const task = board.tasks.find((candidate) => candidate.id === id);
    assert.equal(getDependencyReadiness(task, board.config), "ready");
    assert.equal(task.dependencyView.isBlocked, false);
    assert.equal(task.dependencyView.hasCycle, false);
  }
  for (const id of summary.blockedTaskIds) {
    assert.equal(board.tasks.find((candidate) => candidate.id === id).dependencyView.isBlocked, true);
  }

  const independentRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const independent = await loadFixture(independentRoot);
  const independentSummary = getWorkflowSummary(independent.tasks, independent.config);
  assert.equal(independent.config.completionStatus, "Done");
  assert.equal(getDependencyReadiness(
    { ...independent.tasks[0], status: independent.config.completionStatus },
    independent.config,
  ), "complete");
  assert.equal(independentSummary.activeTaskCount,
    independent.tasks.filter(({ status }) => status !== independent.config.completionStatus).length);
  assert.throws(() => getWorkflowSummary({}, independent.config), /Tasks and board configuration/);
});

test("sorts without mutating canonical order and keeps blank dates last", async () => {
  const board = await loadFixture();
  const originalIds = board.columns.find(({ status }) => status === "Complete").cards.map(({ id }) => id);
  const complete = board.tasks.filter(({ status }) => status === "Complete");

  const prioritySorted = sortTasks(complete, board.config, "priority");
  assert.deepEqual(
    prioritySorted.map(({ priority }) => board.config.priorities.findIndex(({ name }) => name === priority)),
    [...prioritySorted].map(({ priority }) => board.config.priorities.findIndex(({ name }) => name === priority)).sort((a, b) => a - b),
  );
  const categorySorted = sortTasks(complete, board.config, "category");
  assert.deepEqual(
    categorySorted.map(({ category }) => category),
    [...categorySorted].map(({ category }) => category).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })),
  );
  const areaSorted = sortTasks(complete, board.config, "area");
  assert.deepEqual(
    areaSorted.map(({ area }) => area),
    [...areaSorted].map(({ area }) => area).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })),
  );
  const typeSorted = sortTasks(complete, board.config, "type");
  assert.deepEqual(
    typeSorted.map(({ source }) => board.config.sources.findIndex(({ path }) => path === source.document)),
    [...typeSorted]
      .map(({ source }) => board.config.sources.findIndex(({ path }) => path === source.document))
      .sort((left, right) => left - right),
  );
  for (const dateField of ["createdDate", "completionDate"]) {
    const withUnknownDate = complete.map((task, index) =>
      index === 0 ? { ...task, [dateField]: "" } : task);
    const dateSorted = sortTasks(withUnknownDate, board.config, dateField);
    const dates = dateSorted.map((task) => task[dateField] || "");
    assert.deepEqual(dates, [...dates].sort((left, right) => {
      if (!left && right) return 1;
      if (left && !right) return -1;
      return left.localeCompare(right);
    }));
    assert.equal(dates.at(-1), "");
  }
  assert.deepEqual(board.columns.find(({ status }) => status === "Complete").cards.map(({ id }) => id), originalIds);
  assert.deepEqual(sortTasks(complete, board.config, "manual").map(({ id }) => id), originalIds);
});

test("builds generic card sections, lifecycle labels, and collapsed visibility", async () => {
  const board = await loadFixture();
  const completed = board.tasks.find(({ id }) => id === "TD-03");
  const active = board.tasks.find(({ id }) => id === "RM-005");
  const unknownActive = board.tasks.find(({ id }) => id === "RM-019");
  const unknownComplete = board.tasks.find(({ id }) => id === "RA-008");

  const completedView = getCardPresentation(completed, board.config);
  assert.equal(completedView.title, "TD-03: Strengthen reliability checks around file writes");
  assert.deepEqual(completedView.lifecycleDates, [
    { label: "Completed", value: completed.completionDate },
  ]);
  assert.deepEqual(completedView.detailSections.map(({ label }) => label), [
    "Details",
    "Limitation",
    "Recommended Fix",
    "Rationale",
    "Recommendations",
  ]);
  assert.deepEqual(completedView.relationshipSections, []);

  const activeView = getCardPresentation(active, board.config, true);
  assert.equal(activeView.detailsHidden, true);
  assert.deepEqual(activeView.lifecycleDates, [
    { label: "Added", value: active.createdDate },
    { label: "Last completed", value: active.completionDate },
  ]);
  assert.deepEqual(activeView.lifecycleDates, getCardPresentation(active, board.config).lifecycleDates);
  assert.deepEqual(activeView.detailSections.map(({ label }) => label), [
    "Details",
    "Rationale",
    "Recommendations",
  ]);
  assert.equal(activeView.detailsHidden, true);
  assert.equal(getCardPresentation(active, board.config).detailsHidden, false);
  assert.deepEqual(getCardPresentation(unknownActive, board.config).lifecycleDates, []);
  assert.deepEqual(getCardPresentation(unknownComplete, board.config).lifecycleDates, []);

  const relationshipView = getCardPresentation(
    board.tasks.find(({ id }) => id === "RM-001"),
    board.config,
    true,
  );
  assert.equal(relationshipView.detailsHidden, true);
  assert.deepEqual(relationshipView.relationshipSections, [
    { label: "Depends On", value: "RM-002" },
    { label: "Blocked By", value: "RM-002" },
    { label: "Dependency warning", value: "Cycle detected" },
  ]);
  assert.deepEqual(
    getCardPresentation(unknownActive, board.config).relationshipSections,
    [
      { label: "Depends On", value: "TD-999" },
      { label: "Blocked By", value: "TD-999 (unresolved)" },
    ],
  );
});

test("formats card titles with one configured ID and without source/category prefixes", async () => {
  const board = await loadFixture();
  const technicalDebt = board.config.sources.find(({ key }) => key === "technicalDebt");
  const roadmap = board.config.sources.find(({ key }) => key === "roadmap");
  const audit = board.config.sources.find(({ key }) => key === "repositoryAudit");

  assert.equal(
    formatCardTitle({
      id: "TD-03",
      title: "Reliability: Strengthen reliability checks around file writes (TD-03)",
      category: "Reliability",
    }, technicalDebt),
    "TD-03: Strengthen reliability checks around file writes",
  );
  assert.equal(
    formatCardTitle({ id: "RM-019", title: "Roadmap: Returns tab" }, roadmap),
    "RM-019: Returns tab",
  );
  assert.equal(
    formatCardTitle({ id: "RA-005", title: "RA-005: Research/Audit: Verify architecture links (RA-005)" }, audit),
    "RA-005: Verify architecture links",
  );
});

test("calculates safe integer insertion orders and rejects impossible gaps", async () => {
  const board = await loadFixture();
  const makeTask = (id, order) => ({
    id,
    status: "Planned",
    order,
    source: { document: board.config.sources[0].path },
  });
  const tasks = [makeTask("RM-100", 100), makeTask("RM-101", 200)];

  assert.equal(calculateOrderValue(tasks, "RM-102", "Planned", 1, board.config), 150);
  assert.equal(calculateOrderValue(tasks, "RM-102", "Planned", 0, board.config), 0);
  assert.equal(calculateOrderValue(tasks, "RM-102", "Planned", Number.POSITIVE_INFINITY, board.config), 300);
  assert.equal(calculateOrderValue([], "RM-102", "Planned", 0, board.config), 100);
  assert.throws(
    () => calculateOrderValue([makeTask("RM-100", 0)], "RM-101", "Planned", 0, board.config),
    /no non-negative Order value/,
  );
  assert.throws(
    () => calculateOrderValue([makeTask("RM-100", 100), makeTask("RM-101", 101)], "RM-102", "Planned", 1, board.config),
    /unused integer Order value/,
  );
  assert.throws(
    () => calculateOrderValue([makeTask("RM-100", Number.MAX_SAFE_INTEGER)], "RM-101", "Planned", 1, board.config),
    /no available safe Order value/,
  );
});
