function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sourceForTask(task, config) {
  return config.sources.find(({ path }) => path === task.source.document);
}

export function matchesTaskView(task, config, criteria) {
  const source = sourceForTask(task, config);
  if (criteria.source && source?.key !== criteria.source) return false;
  if (criteria.priority && task.priority !== criteria.priority) return false;
  if (criteria.category && task.category !== criteria.category) return false;
  if (criteria.area && task.area !== criteria.area) return false;
  const dependencies = task.dependencyView;
  if (criteria.dependency === "blocked" && !dependencies?.isBlocked) return false;
  if (criteria.dependency === "unblocked" && dependencies?.isBlocked) return false;
  if (criteria.dependency === "unresolved" && !dependencies?.hasUnresolved) return false;
  if (criteria.dependency === "cycle" && !dependencies?.hasCycle) return false;
  if (!criteria.search) return true;

  const searchableText = [
    task.id,
    task.title,
    task.details,
    ...(source?.extraFields ?? []).map(({ key }) => task[key]),
    ...(dependencies?.dependsOn ?? []),
    ...(dependencies?.blockedBy ?? []),
    ...(dependencies?.unresolved ?? []),
  ].join(" ");
  return normalizedText(searchableText).includes(normalizedText(criteria.search));
}

export function filterTasks(tasks, config, criteria) {
  return tasks.filter((task) => matchesTaskView(task, config, criteria));
}

export function formatCardTitle(task, source) {
  let title = task.title.trim();
  const taskTitlePrefix = `${task.id}:`;
  if (title.startsWith(taskTitlePrefix)) title = title.slice(taskTitlePrefix.length).trim();

  const sourcePrefixes = [task.category, source?.label, source?.category]
    .filter((prefix, index, prefixes) => prefix && prefixes.indexOf(prefix) === index)
    .sort((left, right) => right.length - left.length);
  for (const prefix of sourcePrefixes) {
    const categoryPrefix = `${prefix}:`;
    if (title.startsWith(categoryPrefix)) {
      title = title.slice(categoryPrefix.length).trim();
      break;
    }
  }

  const duplicateIdSuffix = `(${task.id})`;
  if (title.endsWith(duplicateIdSuffix)) {
    title = title.slice(0, -duplicateIdSuffix.length).trimEnd();
  }
  return `${task.id}: ${title}`;
}

export function getCardPresentation(task, config, detailsCollapsed = false) {
  const source = sourceForTask(task, config);
  const detailSections = [];
  if (task.details.trim()) detailSections.push({ label: "Details", value: task.details });
  for (const field of source?.extraFields ?? []) {
    if (["createdDate", "completionDate", "dependsOn", "executionType"].includes(field.key)) continue;
    const value = task[field.key];
    if (typeof value === "string" && value.trim()) {
      detailSections.push({ label: field.label, value });
    }
  }

  const dependencyView = task.dependencyView ?? {};
  const relationshipSections = [];
  const dependsOn = dependencyView.dependsOn ?? [];
  if (dependsOn.length > 0) {
    relationshipSections.push({ label: "Depends On", value: dependsOn.join(", ") });
  }
  const unresolved = new Set(dependencyView.unresolved ?? []);
  const blockedBy = (dependencyView.blockedBy ?? [])
    .map((id) => unresolved.has(id) ? `${id} (unresolved)` : id);
  if (blockedBy.length > 0) {
    relationshipSections.push({ label: "Blocked By", value: blockedBy.join(", ") });
  }
  if (dependencyView.hasCycle) {
    relationshipSections.push({ label: "Dependency warning", value: "Cycle detected" });
  }

  const isComplete = config.completionStatus !== undefined && task.status === config.completionStatus;
  const lifecycleDates = isComplete
    ? (task.completionDate ? [{ label: "Completed", value: task.completionDate }] : [])
    : [
        ...(task.createdDate ? [{ label: "Added", value: task.createdDate }] : []),
        ...(task.completionDate ? [{ label: "Last completed", value: task.completionDate }] : []),
      ];
  return {
    detailSections,
    detailSections,
    detailsHidden: detailsCollapsed,
    lifecycleDates,
    relationshipSections,
    title: formatCardTitle(task, source),
  };
}

export function hasActiveTaskFilters(criteria) {
  return Boolean(
    normalizedText(criteria.search) ||
      criteria.source ||
      criteria.priority ||
      criteria.category ||
      criteria.area ||
      criteria.dependency,
  );
}

export function isManualOrderView(criteria, sortBy = "manual") {
  return !hasActiveTaskFilters(criteria) && sortBy === "manual";
}

export function compareCanonicalTaskOrder(left, right, config) {
  const sourceOrder = new Map(config.sources.map((source, index) => [source.path, index]));
  return (
    left.order - right.order ||
    (sourceOrder.get(left.source.document) ?? 0) - (sourceOrder.get(right.source.document) ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

export function calculateOrderValue(tasks, taskId, status, requestedIndex, config) {
  const destination = sortTasks(
    tasks.filter((task) => task.status === status && task.id !== taskId),
    config,
    "manual",
  );
  const position = Number.isFinite(requestedIndex) ? Math.trunc(requestedIndex) : destination.length;
  const index = Math.max(0, Math.min(destination.length, position));
  const previous = destination[index - 1];
  const next = destination[index];

  if (!previous && !next) return 100;
  if (!previous) {
    if (next.order === 0) {
      throw new Error("This column has no non-negative Order value before its first card.");
    }
    return next.order >= 100 ? next.order - 100 : next.order - 1;
  }
  if (!next) {
    if (previous.order <= Number.MAX_SAFE_INTEGER - 100) return previous.order + 100;
    if (previous.order < Number.MAX_SAFE_INTEGER) return previous.order + 1;
    throw new Error("This column has no available safe Order value after its last card.");
  }

  const gap = next.order - previous.order;
  if (gap <= 1) {
    throw new Error("There is no unused integer Order value between these cards. Choose another position.");
  }
  const order = previous.order + Math.floor(gap / 2);
  if (!Number.isSafeInteger(order) || order < 0 || order === previous.order || order === next.order) {
    throw new Error("There is no safe Order value between these cards. Choose another position.");
  }
  return order;
}

function compareOptionalText(left, right, key) {
  const leftValue = String(left[key] ?? "");
  const rightValue = String(right[key] ?? "");
  if (!leftValue && rightValue) return 1;
  if (leftValue && !rightValue) return -1;
  return leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
}

export function sortTasks(tasks, config, sortBy = "manual") {
  const priorityOrder = new Map(config.priorities.map(({ name }, index) => [name, index]));
  const sourceOrder = new Map(config.sources.map((source, index) => [source.path, index]));
  const canonical = (left, right) => compareCanonicalTaskOrder(left, right, config);
  const comparators = {
    manual: canonical,
    priority: (left, right) =>
      (priorityOrder.get(left.priority) ?? Number.MAX_SAFE_INTEGER) -
        (priorityOrder.get(right.priority) ?? Number.MAX_SAFE_INTEGER) ||
      canonical(left, right),
    category: (left, right) =>
      left.category.localeCompare(right.category, undefined, { sensitivity: "base" }) ||
      canonical(left, right),
    area: (left, right) =>
      left.area.localeCompare(right.area, undefined, { sensitivity: "base" }) ||
      canonical(left, right),
    type: (left, right) =>
      (sourceOrder.get(left.source.document) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(right.source.document) ?? Number.MAX_SAFE_INTEGER) ||
      canonical(left, right),
    completionDate: (left, right) =>
      compareOptionalText(left, right, "completionDate") || canonical(left, right),
    createdDate: (left, right) => compareOptionalText(left, right, "createdDate") || canonical(left, right),
  };
  return [...tasks].sort(comparators[sortBy] ?? canonical);
}
