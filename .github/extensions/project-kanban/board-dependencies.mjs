function taskIdPattern(source) {
  const prefix = source.idPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${prefix}-\\d{${source.idWidth},}$`);
}

export function parseDependencyIds(value, config) {
  if (typeof value !== "string") {
    throw new TypeError("Depends On must be a comma-separated list of task IDs.");
  }
  const text = value.trim();
  if (!text) return [];

  const ids = text.split(",").map((id) => id.trim());
  if (ids.some((id) => !id)) {
    throw new TypeError("Depends On contains an empty task ID.");
  }
  const patterns = config.sources.map(taskIdPattern);
  const seen = new Set();
  for (const id of ids) {
    if (!patterns.some((pattern) => pattern.test(id))) {
      throw new TypeError(`Dependency ID "${id}" does not match a configured task ID prefix.`);
    }
    if (seen.has(id)) throw new TypeError(`Depends On contains duplicate task ID "${id}".`);
    seen.add(id);
  }
  return ids;
}

export function normalizeDependencyIds(value, config) {
  return parseDependencyIds(value, config).join(", ");
}

function findPath(start, target, adjacency) {
  const parent = new Map([[start, null]]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === target) {
      const path = [];
      for (let id = current; id !== null; id = parent.get(id)) path.push(id);
      return path.reverse();
    }
    for (const neighbor of adjacency.get(current) ?? []) {
      if (parent.has(neighbor)) continue;
      parent.set(neighbor, current);
      pending.push(neighbor);
    }
  }
  return null;
}

export function findIntroducedDependencyCycle(taskId, previousIds, nextIds, tasks, config) {
  const previous = new Set(previousIds);
  const addedIds = nextIds.filter((id) => !previous.has(id));
  if (addedIds.length === 0) return null;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const adjacency = new Map(tasks.map((task) => [task.id, new Set()]));
  for (const task of tasks) {
    for (const dependencyId of parseDependencyIds(task.dependsOn ?? "", config)) {
      if (taskById.has(dependencyId)) adjacency.get(task.id).add(dependencyId);
    }
  }

  for (const dependencyId of addedIds) {
    if (!taskById.has(dependencyId)) continue;
    adjacency.get(taskId)?.delete(dependencyId);
    const path = findPath(dependencyId, taskId, adjacency);
    adjacency.get(taskId)?.add(dependencyId);
    if (path) return [taskId, ...path];
  }
  return null;
}

function findCycleTaskIds(adjacency) {
  const state = new Map([...adjacency.keys()].map((id) => [id, 0]));
  const cycleTaskIds = new Set();

  for (const start of adjacency.keys()) {
    if (state.get(start) !== 0) continue;
    state.set(start, 1);
    const frames = [{ id: start, neighbors: [...adjacency.get(start)], index: 0 }];

    while (frames.length > 0) {
      const frame = frames.at(-1);
      if (frame.index >= frame.neighbors.length) {
        state.set(frame.id, 2);
        frames.pop();
        continue;
      }

      const neighbor = frame.neighbors[frame.index];
      frame.index += 1;
      if (!state.has(neighbor)) continue;
      if (state.get(neighbor) === 0) {
        state.set(neighbor, 1);
        frames.push({ id: neighbor, neighbors: [...adjacency.get(neighbor)], index: 0 });
      } else if (state.get(neighbor) === 1) {
        const cycleStart = frames.findIndex(({ id }) => id === neighbor);
        for (const cycleFrame of frames.slice(cycleStart)) cycleTaskIds.add(cycleFrame.id);
      }
    }
  }
  return cycleTaskIds;
}

export function analyzeDependencies(tasks, config) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const adjacency = new Map(tasks.map((task) => [task.id, new Set()]));
  const referencesByTask = new Map();
  const edges = [];
  const unresolvedIds = new Set();

  for (const task of tasks) {
    const references = parseDependencyIds(task.dependsOn ?? "", config).map((id) => {
      const dependency = taskById.get(id) ?? null;
      if (!dependency) unresolvedIds.add(id);
      else adjacency.get(task.id).add(id);
      edges.push({ source: id, target: task.id, unresolved: dependency === null });
      return { id, task: dependency };
    });
    referencesByTask.set(task.id, references);
  }

  const cycleTaskIds = findCycleTaskIds(adjacency);
  const taskViews = new Map();
  for (const task of tasks) {
    const references = referencesByTask.get(task.id) ?? [];
    const unresolved = references.filter(({ task: dependency }) => dependency === null);
    const blockedBy = references.filter(
      ({ task: dependency }) => !dependency || dependency.status !== config.completionStatus,
    );
    taskViews.set(task.id, {
      dependsOn: references.map(({ id }) => id),
      blockedBy: blockedBy.map(({ id }) => id),
      unresolved: unresolved.map(({ id }) => id),
      isBlocked: blockedBy.length > 0,
      hasUnresolved: unresolved.length > 0,
      hasCycle: cycleTaskIds.has(task.id),
    });
  }

  return {
    taskViews,
    graph: {
      nodes: tasks.map(({ id, title, status, source }) => ({
        id,
        title,
        status,
        source: source.document,
      })),
      edges,
      cyclicTaskIds: [...cycleTaskIds].sort(),
      unresolvedIds: [...unresolvedIds].sort(),
    },
  };
}
