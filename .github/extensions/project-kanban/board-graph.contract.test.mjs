import assert from "node:assert/strict";
import test from "node:test";
import { validateBoardConfig } from "./board-config.mjs";
import { analyzeDependencies } from "./board-dependencies.mjs";
import { parseBoardDocuments } from "./board-data.mjs";
import { createGraphView, layoutGraph } from "./board-graph.mjs";
import * as dagre from "./vendor/dagre-3.1.3.mjs";
import { testConfig, testDocuments } from "./test-fixtures.mjs";

const rawConfig = testConfig();
const config = validateBoardConfig(rawConfig);
const sourceBoard = parseBoardDocuments(testDocuments(rawConfig), config);
const tasks = [
  sourceBoard.tasks.find(({ id }) => id === "RM-001"),
  sourceBoard.tasks.find(({ id }) => id === "TD-01"),
  sourceBoard.tasks.find(({ id }) => id === "RM-002"),
].map((task) => ({ ...task }));
tasks[2].dependsOn = "TD-01";

test("projects configured task relationships and lays out a generic graph", () => {
  const before = JSON.stringify(tasks);
  const analysis = analyzeDependencies(tasks, config);
  const snapshot = {
    config,
    tasks: tasks.map((task) => ({
      ...task,
      dependencyView: analysis.taskViews.get(task.id),
    })),
    dependencyGraph: analysis.graph,
  };
  const view = createGraphView(snapshot);
  const layout = layoutGraph(view, dagre);

  assert.deepEqual(view.edges.map(({ source, target }) => [source, target]), [["TD-01", "RM-002"]]);
  assert.equal(view.nodes.length, tasks.length);
  assert.equal(layout.nodes.length, tasks.length);
  assert.ok(layout.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(JSON.stringify(tasks), before);
});
