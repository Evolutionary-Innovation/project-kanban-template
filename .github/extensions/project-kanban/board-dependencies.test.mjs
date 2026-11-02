import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "./board-config.mjs";
import {
  analyzeDependencies,
  findIntroducedDependencyCycle,
  parseDependencyIds,
} from "./board-dependencies.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("validates configured dependency ID formats and normalizes comma-separated IDs", async () => {
  const config = await readBoardConfig(workspaceRoot);

  assert.deepEqual(parseDependencyIds(" TD-03, RM-019 ", config), ["TD-03", "RM-019"]);
  assert.deepEqual(parseDependencyIds("", config), []);
  assert.throws(() => parseDependencyIds("XX-001", config), /configured task ID prefix/);
  assert.throws(() => parseDependencyIds("RM-019, RM-019", config), /duplicate task ID/);
  assert.throws(() => parseDependencyIds("RM-019,,TD-03", config), /empty task ID/);
});

test("derives blockers and graph edges from stored Depends On relationships", async () => {
  const config = await readBoardConfig(workspaceRoot);
  const tasks = [
    { id: "TD-03", title: "Prerequisite", status: "In Progress", dependsOn: "", source: { document: "docs/technical-debt.md" } },
    { id: "RM-019", title: "Dependent", status: "Planned", dependsOn: "TD-03, RA-005", source: { document: "docs/roadmap.md" } },
    { id: "RA-005", title: "Completed prerequisite", status: "Complete", dependsOn: "", source: { document: "docs/repository-audit.md" } },
    { id: "RM-020", title: "Unresolved dependency", status: "Planned", dependsOn: "TD-99", source: { document: "docs/roadmap.md" } },
    { id: "RM-021", title: "Cycle A", status: "Planned", dependsOn: "RM-022", source: { document: "docs/roadmap.md" } },
    { id: "RM-022", title: "Cycle B", status: "Planned", dependsOn: "RM-021", source: { document: "docs/roadmap.md" } },
  ];
  const { taskViews, graph } = analyzeDependencies(tasks, config);

  assert.deepEqual(taskViews.get("RM-019").blockedBy, ["TD-03"]);
  assert.deepEqual(taskViews.get("RM-019").dependsOn, ["TD-03", "RA-005"]);
  assert.equal(taskViews.get("RM-020").hasUnresolved, true);
  assert.deepEqual(taskViews.get("RM-020").blockedBy, ["TD-99"]);
  assert.deepEqual(graph.edges[0], { source: "TD-03", target: "RM-019", unresolved: false });
  assert.deepEqual(graph.unresolvedIds, ["TD-99"]);
  assert.deepEqual(graph.cyclicTaskIds, ["RM-021", "RM-022"]);
});

test("rejects newly introduced cycles while permitting acyclic cross-source references", async () => {
  const config = await readBoardConfig(workspaceRoot);
  const tasks = [
    { id: "RM-019", dependsOn: "", source: { document: "docs/roadmap.md" } },
    { id: "TD-03", dependsOn: "RM-019", source: { document: "docs/technical-debt.md" } },
  ];

  assert.deepEqual(findIntroducedDependencyCycle("RM-019", [], ["TD-03"], tasks, config), [
    "RM-019",
    "TD-03",
    "RM-019",
  ]);
  assert.equal(findIntroducedDependencyCycle("RM-019", [], ["RA-005"], tasks, config), null);
});

test("dependency ID validation follows independent project prefixes", async () => {
  const independentRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const config = await readBoardConfig(independentRoot);

  assert.deepEqual(parseDependencyIds("PLAN-001, EXP-001", config), ["PLAN-001", "EXP-001"]);
  assert.throws(() => parseDependencyIds("RM-001", config), /configured task ID prefix/);
});
