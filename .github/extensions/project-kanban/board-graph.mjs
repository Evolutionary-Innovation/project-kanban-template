import {
  filterTasks,
  getCardPresentation,
  getDependencyReadiness,
  getWorkflowSummary,
} from "./board-view.mjs";

export const GRAPH_NODE_WIDTH = 236;
export const GRAPH_NODE_HEIGHT = 116;

export function getDownstreamTaskIds(graph, taskId) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError("A dependency graph is required.");
  }
  const taskIds = new Set(graph.nodes.map(({ id }) => id));
  if (!taskIds.has(taskId)) return [];
  const adjacency = new Map([...taskIds].map((id) => [id, new Set()]));
  for (const { source, target, unresolved } of graph.edges) {
    if (!unresolved && taskIds.has(source) && taskIds.has(target)) {
      adjacency.get(source).add(target);
    }
  }
  const visited = new Set([taskId]);
  const pending = [taskId];
  for (let index = 0; index < pending.length; index += 1) {
    for (const dependent of adjacency.get(pending[index])) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      pending.push(dependent);
    }
  }
  return [...visited].filter((id) => id !== taskId).sort((left, right) => left.localeCompare(right));
}

export function findLongestDependencyChain(graph) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph.edges) ||
      !Array.isArray(graph.cyclicTaskIds)) {
    throw new TypeError("A dependency graph with cycle diagnostics is required.");
  }
  const cyclicIds = new Set(graph.cyclicTaskIds);
  const taskIds = new Set(graph.nodes.map(({ id }) => id).filter((id) => !cyclicIds.has(id)));
  const adjacency = new Map([...taskIds].map((id) => [id, new Set()]));
  const indegree = new Map([...taskIds].map((id) => [id, 0]));
  for (const { source, target, unresolved } of graph.edges) {
    if (unresolved || !taskIds.has(source) || !taskIds.has(target)) continue;
    if (adjacency.get(source).has(target)) continue;
    adjacency.get(source).add(target);
    indegree.set(target, indegree.get(target) + 1);
  }
  const pending = [...taskIds].filter((id) => indegree.get(id) === 0)
    .sort((left, right) => left.localeCompare(right));
  const distances = new Map([...taskIds].map((id) => [id, 1]));
  const predecessors = new Map();
  const topologicalOrder = [];
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    topologicalOrder.push(id);
    const dependents = [...adjacency.get(id)].sort((left, right) => left.localeCompare(right));
    for (const dependent of dependents) {
      const candidateDistance = distances.get(id) + 1;
      if (candidateDistance > distances.get(dependent)) {
        distances.set(dependent, candidateDistance);
        predecessors.set(dependent, id);
      }
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) pending.push(dependent);
    }
  }
  const longestEnd = topologicalOrder.reduce((best, id) =>
    distances.get(id) > distances.get(best) ? id : best, topologicalOrder[0]);
  if (!longestEnd || distances.get(longestEnd) < 2) {
    return { taskIds: [], excludedCycleCount: cyclicIds.size };
  }
  const taskPath = [];
  for (let id = longestEnd; id; id = predecessors.get(id)) taskPath.push(id);
  taskPath.reverse();
  return { taskIds: taskPath, excludedCycleCount: cyclicIds.size };
}

export function createGraphView(snapshot) {
  const graph = snapshot?.dependencyGraph;
  if (
    !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
    !Array.isArray(graph.cyclicTaskIds) || !Array.isArray(graph.unresolvedIds) ||
    !Array.isArray(snapshot.tasks) || !snapshot.config
  ) {
    throw new TypeError("The board response has no valid dependency graph.");
  }
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const cyclicIds = new Set(graph.cyclicTaskIds);
  const workflow = getWorkflowSummary(snapshot.tasks, snapshot.config);
  const longestChain = findLongestDependencyChain(graph);
  const readyIds = new Set(workflow.readyTaskIds);
  const blockedIds = new Set(workflow.blockedTaskIds);
  const reviewIds = new Set(workflow.reviewTaskIds);
  const criticalPathIds = new Set(longestChain.taskIds);
  const criticalPathEdges = new Set(longestChain.taskIds.slice(1)
    .map((id, index) => JSON.stringify([longestChain.taskIds[index], id])));
  const nodes = graph.nodes.map(({ id }) => {
    const task = tasks.get(id);
    if (!task) throw new TypeError(`Graph task "${id}" is missing from the board.`);
    const presentation = getCardPresentation(task, snapshot.config);
    return {
      id,
      title: presentation.title,
      summary: presentation.title.slice(id.length + 2),
      status: task.status,
      priority: task.priority,
      priorityTone: snapshot.config.priorities.find(({ name }) => name === task.priority)?.tone ?? "low",
      category: task.category,
      area: task.area,
      executionType: task.executionType ?? "",
      details: presentation.detailSections,
      dates: presentation.lifecycleDates,
      blockedBy: [...(task.dependencyView?.blockedBy ?? [])],
      hasCycle: cyclicIds.has(id),
      workflowState: getDependencyReadiness(task, snapshot.config),
      isCriticalPath: criticalPathIds.has(id),
      unresolved: false,
    };
  });
  const nodeIds = new Set(nodes.map(({ id }) => id));
  if (nodeIds.size !== nodes.length || nodeIds.size !== tasks.size) {
    throw new TypeError("The dependency graph does not contain each task exactly once.");
  }
  for (const id of graph.unresolvedIds) {
    if (nodeIds.has(id)) throw new TypeError(`Unresolved graph ID "${id}" already exists.`);
    nodeIds.add(id);
    nodes.push({
      id, title: `${id}: Unresolved reference`, summary: "Unresolved reference",
      status: "Unresolved", priority: "", priorityTone: "", category: "", area: "",
      executionType: "", details: [], dates: [], blockedBy: [], hasCycle: false, unresolved: true,
      workflowState: "unresolved", isCriticalPath: false,
    });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.map(({ source, target, unresolved }) => {
    if (!byId.has(source) || !tasks.has(target) || Boolean(unresolved) !== byId.get(source).unresolved) {
      throw new TypeError(`Invalid dependency graph edge "${source}" -> "${target}".`);
    }
    return {
      source,
      target,
      unresolved: Boolean(unresolved),
      blocking: byId.get(target).blockedBy.includes(source),
      isCriticalPath: criticalPathEdges.has(JSON.stringify([source, target])),
    };
  }).sort((left, right) =>
    left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges,
    taskCount: tasks.size,
    unresolvedCount: graph.unresolvedIds.length,
    cycleCount: graph.cyclicTaskIds.length,
    workflow: {
      ...workflow,
      longestChainIds: longestChain.taskIds,
      excludedCycleCount: longestChain.excludedCycleCount,
    },
  };
}

function dependencyNeighbourhood(rootId, edges, direction, includeAll) {
  const adjacency = new Map();
  for (const { source, target } of edges) {
    const from = direction === "upstream" ? target : source;
    const to = direction === "upstream" ? source : target;
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push(to);
    adjacency.set(from, neighbors);
  }
  const visited = new Set([rootId]);
  let frontier = [rootId];
  for (let depth = 0; frontier.length > 0 && (includeAll || depth === 0); depth += 1) {
    const next = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return visited;
}

export function projectGraphView(view, snapshot, criteria = {}, scope = {}) {
  if (!Array.isArray(view?.nodes) || !Array.isArray(view.edges)) {
    throw new TypeError("A projected dependency graph is required.");
  }
  const matchingIds = new Set(filterTasks(snapshot.tasks, snapshot.config, criteria).map(({ id }) => id));
  const focusId = scope.focusId && view.nodes.some(({ id }) => id === scope.focusId)
    ? scope.focusId
    : null;
  const selectedIds = focusId
    ? new Set([
        ...dependencyNeighbourhood(focusId, view.edges, "upstream", scope.expandUpstream),
        ...dependencyNeighbourhood(focusId, view.edges, "downstream", scope.expandDownstream),
      ])
    : new Set(view.nodes.map(({ id }) => id));
  const visibleMatches = new Set([...matchingIds].filter((id) => selectedIds.has(id)));
  const revealId = scope.revealedTaskId && view.nodes.some(({ id, unresolved }) =>
    id === scope.revealedTaskId && !unresolved && selectedIds.has(id))
    ? scope.revealedTaskId
    : null;
  const primaryIds = new Set(visibleMatches);
  if (revealId) primaryIds.add(revealId);
  const visibleIds = new Set(focusId ? selectedIds : primaryIds);
  if (!focusId) {
    for (const { source, target } of view.edges) {
      if (primaryIds.has(target)) visibleIds.add(source);
    }
  }
  const nodes = view.nodes
    .filter(({ id }) => visibleIds.has(id))
    .map((node) => ({
      ...node,
      matchKind: visibleMatches.has(node.id) ? "match" : node.id === revealId ? "revealed" : "context",
    }));
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edges = view.edges.filter(({ source, target }) =>
    nodeIds.has(source) && nodeIds.has(target) &&
    (focusId || primaryIds.has(target)));
  const contextCount = nodes.filter(({ matchKind, unresolved }) =>
    matchKind === "context" && !unresolved).length;
  return {
    ...view,
    nodes,
    edges,
    taskCount: view.taskCount,
    matchingCount: matchingIds.size,
    focusMatchingCount: focusId ? visibleMatches.size : null,
    contextCount,
    unresolvedCount: nodes.filter(({ unresolved }) => unresolved).length,
    revealedCount: nodes.filter(({ matchKind }) => matchKind === "revealed").length,
    scope: { focusId, expandUpstream: Boolean(scope.expandUpstream), expandDownstream: Boolean(scope.expandDownstream) },
  };
}

export function graphLayoutKey(view) {
  return JSON.stringify([
    view.nodes.map(({ id }) => id),
    view.edges.map(({ source, target }) => [source, target]),
  ]);
}

export function layoutGraph(view, dagre) {
  if (view.nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };
  const connected = new Set(view.edges.flatMap(({ source, target }) => [source, target]));
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 64, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { id } of view.nodes) {
    if (connected.has(id)) graph.setNode(id, { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT });
  }
  for (const { source, target } of view.edges) graph.setEdge(source, target);
  if (connected.size > 0) dagre.layout(graph);

  const nodes = [...connected].map((id) => {
    const { x, y, width, height } = graph.node(id);
    return { id, x, y, width, height };
  });
  const edges = view.edges.map(({ source, target }) => ({
    source,
    target,
    points: graph.edge(source, target).points.map(({ x, y }) => ({ x, y })),
  }));
  const isolated = view.nodes.filter(({ id }) => !connected.has(id));
  const columns = Math.min(5, isolated.length);
  const isolatedTop = connected.size > 0 ? graph.graph().height + 32 : 24;
  for (const [index, { id }] of isolated.entries()) {
    nodes.push({
      id,
      x: 24 + (index % columns) * (GRAPH_NODE_WIDTH + 32) + GRAPH_NODE_WIDTH / 2,
      y: isolatedTop + Math.floor(index / columns) * (GRAPH_NODE_HEIGHT + 32) + GRAPH_NODE_HEIGHT / 2,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    });
  }
  const width = Math.max(graph.graph().width ?? 0, ...nodes.map((node) => node.x + node.width / 2 + 24));
  const height = Math.max(graph.graph().height ?? 0, ...nodes.map((node) => node.y + node.height / 2 + 24));
  if (
    nodes.some((node) => ![node.x, node.y, node.width, node.height].every(Number.isFinite)) ||
    edges.some((edge) => edge.points.length < 2 ||
      edge.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
  ) {
    throw new Error("The dependency layout returned invalid coordinates.");
  }
  return { nodes, edges, width, height };
}

export function graphTitleLines(text, limit = 29) {
  const words = text.trim().split(/\s+/);
  const lines = [""];
  for (const word of words) {
    const index = lines.length - 1;
    const candidate = lines[index] ? `${lines[index]} ${word}` : word;
    if (candidate.length <= limit) lines[index] = candidate;
    else if (index === 0 && lines[index]) lines.push(word);
    else {
      lines[index] = `${candidate.slice(0, limit - 3)}...`;
      return lines;
    }
  }
  return lines.map((line) => line.length > limit ? `${line.slice(0, limit - 3)}...` : line);
}
