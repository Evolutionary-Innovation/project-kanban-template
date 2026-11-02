import { getCardPresentation } from "./board-view.mjs";

export const GRAPH_NODE_WIDTH = 236;
export const GRAPH_NODE_HEIGHT = 116;

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
    };
  }).sort((left, right) =>
    left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges,
    taskCount: tasks.size,
    unresolvedCount: graph.unresolvedIds.length,
    cycleCount: graph.cyclicTaskIds.length,
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
