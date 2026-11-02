import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "./board-config.mjs";
import { analyzeDependencies } from "./board-dependencies.mjs";
import {
  createGraphView,
  findLongestDependencyChain,
  getDownstreamTaskIds,
  graphLayoutKey,
  graphTitleLines,
  layoutGraph,
  projectGraphView,
} from "./board-graph.mjs";
import { readBoardSnapshot } from "./board-storage.mjs";
import { filterTasks } from "./board-view.mjs";
import * as dagre from "./vendor/dagre-3.1.3.mjs";

const fixtureRoot = fileURLToPath(new URL("../../../examples/synthetic-browser-project/", import.meta.url));

async function fixture() {
  return readBoardSnapshot(fixtureRoot, await readBoardConfig(fixtureRoot));
}

function assertLayout(view, result) {
  assert.equal(result.nodes.length, view.nodes.length);
  assert.equal(result.edges.length, view.edges.length);
  assert.deepEqual(new Set(result.nodes.map(({ id }) => id)), new Set(view.nodes.map(({ id }) => id)));
  for (const node of result.nodes) {
    for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(node[key]));
    assert.ok(node.x - node.width / 2 >= 0);
    assert.ok(node.y - node.height / 2 >= 0);
  }
  for (const edge of result.edges) {
    const source = result.nodes.find(({ id }) => id === edge.source);
    const target = result.nodes.find(({ id }) => id === edge.target);
    const start = edge.points[0];
    const end = edge.points.at(-1);
    assert.ok(Math.abs(start.x - source.x) <= source.width / 2 + 0.01);
    assert.ok(Math.abs(start.y - source.y) <= source.height / 2 + 0.01);
    assert.ok(Math.abs(end.x - target.x) <= target.width / 2 + 0.01);
    assert.ok(Math.abs(end.y - target.y) <= target.height / 2 + 0.01);
  }
  for (let index = 0; index < result.nodes.length; index += 1) {
    const left = result.nodes[index];
    for (const right of result.nodes.slice(index + 1)) {
      assert.ok(Math.abs(left.x - right.x) >= (left.width + right.width) / 2 ||
        Math.abs(left.y - right.y) >= (left.height + right.height) / 2);
    }
  }
}

test("projects all synthetic tasks, unresolved placeholders and cycle warnings without mutations", async () => {
  const snapshot = await fixture();
  const before = JSON.stringify(snapshot);
  const model = createGraphView(snapshot);
  assert.equal(model.taskCount, 60);
  assert.equal(model.nodes.length, 61);
  assert.equal(model.edges.length, 10);
  assert.equal(model.unresolvedCount, 1);
  assert.equal(model.cycleCount, 2);
  assert.equal(model.nodes.find(({ id }) => id === "TD-999").unresolved, true);
  assert.deepEqual(model.nodes.filter(({ hasCycle }) => hasCycle).map(({ id }) => id), ["RM-001", "RM-002"]);
  for (const edge of model.edges) {
    assert.equal(edge.blocking, snapshot.tasks.find(({ id }) => id === edge.target).dependencyView.blockedBy.includes(edge.source));
  }
  assert.ok(model.nodes.some(({ workflowState }) => workflowState === "ready"));
  assert.ok(model.nodes.some(({ workflowState }) => workflowState === "blocked"));
  assert.ok(model.workflow.longestChainIds.length >= 2);
  for (let index = 1; index < model.workflow.longestChainIds.length; index += 1) {
    assert.ok(model.edges.some(({ source, target, isCriticalPath }) =>
      source === model.workflow.longestChainIds[index - 1] &&
      target === model.workflow.longestChainIds[index] && isCriticalPath));
  }
  const result = layoutGraph(model, dagre);
  assertLayout(model, result);
  assert.deepEqual(result, layoutGraph(model, dagre));
  assert.equal(JSON.stringify(snapshot), before);
});

test("derives unique downstream impact and an unweighted chain while excluding cycles", () => {
  const graph = {
    nodes: ["A", "B", "C", "D", "E", "F"].map((id) => ({ id })),
    edges: [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
      { source: "A", target: "D" },
      { source: "D", target: "E" },
      { source: "E", target: "D" },
      { source: "E", target: "F" },
    ],
    cyclicTaskIds: ["D", "E"],
  };
  assert.deepEqual(findLongestDependencyChain(graph), {
    taskIds: ["A", "B", "C"],
    excludedCycleCount: 2,
  });
  assert.deepEqual(getDownstreamTaskIds(graph, "D"), ["E", "F"]);
  assert.deepEqual(getDownstreamTaskIds(graph, "missing"), []);
  assert.throws(() => findLongestDependencyChain({ nodes: [], edges: [] }), /cycle diagnostics/);
});

test("projects shared filters, dependency context, focus paths and temporary reveals", async () => {
  const snapshot = await fixture();
  const base = createGraphView(snapshot);
  const crossSourceEdge = base.edges.find(({ source, target }) =>
    snapshot.tasks.find(({ id }) => id === source).source.document !==
    snapshot.tasks.find(({ id }) => id === target).source.document);
  assert.ok(crossSourceEdge, "synthetic fixture includes a cross-source dependency");
  const target = snapshot.tasks.find(({ id }) => id === crossSourceEdge.target);
  const prerequisite = snapshot.tasks.find(({ id }) => id === crossSourceEdge.source);
  const targetSource = snapshot.config.sources.find(({ path }) => path === target.source.document);
  const criteria = { source: targetSource.key, search: target.id };
  const filtered = projectGraphView(base, snapshot, criteria);
  assert.equal(filtered.nodes.find(({ id }) => id === target.id).matchKind, "match");
  assert.equal(filtered.nodes.find(({ id }) => id === prerequisite.id).matchKind, "context");
  assert.ok(filtered.edges.some(({ source, target: dependent }) =>
    source === prerequisite.id && dependent === target.id));
  const expectedMatches = new Set(filterTasks(snapshot.tasks, snapshot.config, criteria).map(({ id }) => id));
  assert.equal(filtered.matchingCount, expectedMatches.size);
  const expectedVisible = new Set(expectedMatches);
  for (const { source, target: dependent } of base.edges) {
    if (expectedMatches.has(dependent)) expectedVisible.add(source);
  }
  assert.deepEqual(new Set(filtered.nodes.map(({ id }) => id)), expectedVisible);

  const focused = projectGraphView(base, snapshot, criteria, { focusId: target.id });
  assert.ok(focused.nodes.some(({ id }) => id === prerequisite.id));
  assert.equal(focused.matchingCount, expectedMatches.size);
  assert.equal(focused.focusMatchingCount,
    focused.nodes.filter(({ matchKind }) => matchKind === "match").length);
  assert.ok(focused.edges.some(({ source, target: dependent }) =>
    source === prerequisite.id && dependent === target.id));
  const expanded = projectGraphView(base, snapshot, criteria, {
    focusId: target.id,
    expandUpstream: true,
    expandDownstream: true,
  });
  assert.ok(expanded.nodes.length >= focused.nodes.length);
  assert.equal(expanded.nodes.filter(({ id }) => id === target.id).length, 1);
  assert.ok(expanded.nodes.some(({ matchKind }) => matchKind === "context"));

  const revealed = projectGraphView(base, snapshot, { category: "__no-category__" }, {
    revealedTaskId: target.id,
  });
  assert.equal(revealed.nodes.find(({ id }) => id === target.id).matchKind, "revealed");
  assert.equal(revealed.revealedCount, 1);

  const unresolvedTask = snapshot.tasks.find(({ dependencyView }) => dependencyView?.hasUnresolved);
  const unresolvedSource = snapshot.config.sources.find(({ path }) => path === unresolvedTask.source.document);
  const unresolvedView = projectGraphView(base, snapshot, {
    source: unresolvedSource.key,
    search: unresolvedTask.id,
  });
  assert.ok(unresolvedView.nodes.some(({ unresolved, matchKind }) => unresolved && matchKind === "context"));
});

test("lays out chains, diamonds, disconnected components and cycles while retaining original directions", async () => {
  const base = await fixture();
  const task = base.tasks[0];
  const dependencies = ["", "RM-001", "RM-001", "RM-002, RM-003", "RM-006", "RM-005", "RM-006", ""];
  const tasks = dependencies.map((dependsOn, index) => ({
    ...task, id: `RM-00${index + 1}`, title: `Task ${index + 1}`, dependsOn, status: "Planned",
  }));
  const analysis = analyzeDependencies(tasks, base.config);
  const snapshot = {
    config: base.config,
    tasks: tasks.map((item) => ({ ...item, dependencyView: analysis.taskViews.get(item.id) })),
    dependencyGraph: analysis.graph,
  };
  const view = createGraphView(snapshot);
  assert.equal(view.nodes.find(({ id }) => id === "RM-007").hasCycle, false);
  const result = layoutGraph(view, dagre);
  assertLayout(view, result);
  for (const [source, target] of [["RM-001", "RM-002"], ["RM-002", "RM-004"]]) {
    assert.ok(result.nodes.find(({ id }) => id === source).y < result.nodes.find(({ id }) => id === target).y);
  }
  for (const edge of view.edges) assert.ok(result.edges.some((item) => item.source === edge.source && item.target === edge.target));
});

test("supports empty graphs, independent configuration, isolated tasks and compact titles", async () => {
  const empty = { nodes: [], edges: [] };
  assert.deepEqual(layoutGraph(empty, dagre), { nodes: [], edges: [], width: 0, height: 0 });
  const root = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const snapshot = await readBoardSnapshot(root, await readBoardConfig(root));
  const view = createGraphView(snapshot);
  assert.ok(view.nodes.some(({ id }) => id.startsWith("PLAN-")));
  assertLayout(view, layoutGraph(view, dagre));
  assert.deepEqual(graphTitleLines("A compact title"), ["A compact title"]);
  const long = graphTitleLines("A very long title with enough words to fill many different lines and exceed the compact node");
  assert.equal(long.length, 2);
  assert.ok(long.every((line) => line.length <= 29));
  assert.ok(long[1].endsWith("..."));
  assert.equal(graphTitleLines("x".repeat(200))[0].length, 29);
});

test("layout cache ignores presentation changes but responds to topology changes", async () => {
  const view = createGraphView(await fixture());
  const changed = structuredClone(view);
  changed.nodes[0].status = "Changed";
  changed.nodes[0].title = "Changed title";
  assert.equal(graphLayoutKey(view), graphLayoutKey(changed));
  changed.edges.pop();
  assert.notEqual(graphLayoutKey(view), graphLayoutKey(changed));
});

test("keeps multiple cycles, long IDs and fully isolated nodes visible", () => {
  const ids = ["CUSTOM-PREFIX-000000000001", "B", "C", "D", "E", "ISOLATED"];
  const view = {
    nodes: ids.map((id) => ({ id })),
    edges: [
      { source: ids[0], target: "B" },
      { source: "B", target: "C" }, { source: "C", target: "B" },
      { source: "D", target: "E" }, { source: "E", target: "D" },
    ],
  };
  const before = JSON.stringify(view);
  const result = layoutGraph(view, dagre);
  assertLayout(view, result);
  for (const edge of result.edges) {
    assert.ok(edge.points.every(({ x, y }) => x <= result.width && y <= result.height));
  }
  assert.equal(JSON.stringify(view), before);
  assertLayout({ nodes: view.nodes, edges: [] }, layoutGraph({ nodes: view.nodes, edges: [] }, dagre));
});

test("reports invalid projections and layout coordinates rather than silently dropping data", async () => {
  assert.throws(() => createGraphView({}), /valid dependency graph/);
  const snapshot = await fixture();
  snapshot.dependencyGraph.nodes.push(snapshot.dependencyGraph.nodes[0]);
  assert.throws(() => createGraphView(snapshot), /exactly once/);
  snapshot.dependencyGraph.nodes.pop();
  snapshot.dependencyGraph.edges[0].source = "MISSING";
  assert.throws(() => createGraphView(snapshot), /Invalid dependency graph edge/);
});

test("pinned standalone vendor and licence notices retain their reviewed bytes", async () => {
  for (const [name, expected] of [
    ["dagre-3.1.3.mjs", "b0ddaf4af1417bec9bd89373a3a3987f081727d6cc6d95fc40dbf85a19bdf3b0"],
    ["dagre-LICENSE", "6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015"],
    ["graphlib-LICENSE", "6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015"],
  ]) {
    const bytes = await readFile(new URL(`./vendor/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  }
  assert.equal(dagre.version, "3.1.3");
});
