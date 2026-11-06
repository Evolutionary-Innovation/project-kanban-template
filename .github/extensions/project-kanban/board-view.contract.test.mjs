import assert from "node:assert/strict";
import test from "node:test";
import { validateBoardConfig } from "./board-config.mjs";
import { parseBoardDocuments } from "./board-data.mjs";
import {
  filterTasks,
  getCardPresentation,
  hasActiveTaskFilters,
  isManualOrderView,
  sortTasks,
} from "./board-view.mjs";
import { testConfig, testDocuments } from "./test-fixtures.mjs";

const rawConfig = testConfig();
const config = validateBoardConfig(rawConfig);
const board = parseBoardDocuments(testDocuments(rawConfig), config);

test("searches configured text fields and combines search with multi-select filters", () => {
  const tasks = board.tasks.map((task) => task.id === "TD-01"
    ? { ...task, limitation: "Distinctive contract limitation." }
    : task);
  assert.deepEqual(filterTasks(tasks, config, { search: "distinctive contract" }).map(({ id }) => id), ["TD-01"]);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const candidates = [
    { ...taskById.get("RM-001"), category: "Reliability", priority: "High", area: "Core" },
    { ...taskById.get("RM-002"), category: "Architecture", priority: "Medium", area: "Core" },
    { ...taskById.get("RM-003"), category: "Reliability", priority: "Low", area: "Core" },
    { ...taskById.get("TD-01"), category: "Documentation", priority: "High", area: "Other" },
  ];
  assert.deepEqual(
    filterTasks(candidates, config, {
      category: ["Reliability", "Architecture"],
      priority: ["High", "Medium"],
      area: ["Core"],
    }).map(({ id }) => id),
    ["RM-001", "RM-002"],
  );
  assert.equal(hasActiveTaskFilters({ category: [], priority: [] }), false);
  assert.equal(isManualOrderView({}, "manual"), true);
  assert.equal(isManualOrderView({ category: ["Reliability"] }, "manual"), false);
});

test("sorts a view without mutating canonical order and retains lifecycle labels when collapsed", () => {
  const tasks = board.tasks.slice(0, 3).map((task, index) => ({
    ...task,
    status: "Complete",
    completionDate: `2026-01-0${3 - index}`,
  }));
  const originalIds = tasks.map(({ id }) => id);
  const sorted = sortTasks(tasks, config, "completionDate");

  assert.deepEqual(sorted.map(({ completionDate }) => completionDate), [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
  ]);
  assert.deepEqual(tasks.map(({ id }) => id), originalIds);

  const collapsed = getCardPresentation({
    ...tasks[0],
    status: "Planned",
    createdDate: "2026-01-01",
    details: "A detail section.",
    rationale: "A rationale section.",
  }, config, true);
  assert.equal(collapsed.detailsHidden, true);
  assert.deepEqual(collapsed.lifecycleDates, [
    { label: "Added", value: "2026-01-01" },
    { label: "Last completed", value: "2026-01-03" },
  ]);
  assert.ok(collapsed.detailSections.length > 0);
});
