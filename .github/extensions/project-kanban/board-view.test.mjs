import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "./board-config.mjs";
import { parseBoardDocuments } from "./board-data.mjs";
import {
  calculateOrderValue,
  filterTasks,
  getCardPresentation,
  hasActiveTaskFilters,
  isManualOrderView,
  sortTasks,
} from "./board-view.mjs";

const fixtureRoot = fileURLToPath(new URL("../../../examples/synthetic-browser-project/", import.meta.url));

async function loadFixture() {
  const config = await readBoardConfig(fixtureRoot);
  const documents = Object.fromEntries(
    await Promise.all(
      config.sources.map(async (source) => [
        source.path,
        await readFile(`${fixtureRoot}/${source.path}`, "utf8"),
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

test("combines source, priority, category, area, and search filters with AND", async () => {
  const board = await loadFixture();
  const sample = board.tasks.find(({ id }) => id.startsWith("TD-"));
  const criteria = {
    source: "technicalDebt",
    priority: sample.priority,
    category: sample.category,
    area: sample.area,
    search: sample.id.toLowerCase(),
  };

  assert.deepEqual(filterTasks(board.tasks, board.config, criteria).map(({ id }) => id), [sample.id]);
  assert.equal(hasActiveTaskFilters(criteria), true);
  assert.equal(isManualOrderView(criteria), false);
  assert.equal(isManualOrderView({}, "priority"), false);
  assert.equal(isManualOrderView({}, "manual"), true);
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
  assert.equal(completedView.showSourceId, false);
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
