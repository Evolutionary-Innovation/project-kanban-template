import {
  calculateOrderValue,
  compareCanonicalTaskOrder,
  filterTasks,
  getCardPresentation,
  getDependencySuggestionConfidencePresentation,
  getWorkflowSummary,
  hasActiveTaskFilters,
  isManualOrderView,
  matchesTaskView,
  serializePlanningFilters,
  sortTasks,
  stripTaskIdTitle,
} from "./board-view.mjs";
import {
  claimPendingSuggestionApproval,
  closestElementFromEventTarget,
} from "./board-client-interactions.mjs";

const PLANNING_ROUTE_RELATIONSHIPS = Object.freeze({
  recorded_prerequisite: "recorded prerequisite",
  practical_enablement: "practical enablement",
  strategic_ordering: "strategic ordering",
});

const boardElement = document.querySelector("#board");
const statusElement = document.querySelector("#status");
const sourcesElement = document.querySelector("#sources");
const createActionsElement = document.querySelector(".create-actions");
const refreshButton = document.querySelector("#refresh");
const taskDialog = document.querySelector("#task-dialog");
const taskDialogTitle = document.querySelector("#task-dialog-title");
const taskForm = document.querySelector("#task-form");
const taskFormFields = document.querySelector("#task-form-fields");
const taskFormError = document.querySelector("#task-form-error");
const saveTaskButton = document.querySelector("#save-task");
const taskSearchInput = document.querySelector("#task-search");
const filterControls = [...document.querySelectorAll(".filter-field")];
const filterControlsByKey = new Map(filterControls.map((control) => [control.dataset.filter, control]));
const activeFilterChips = document.querySelector("#active-filter-chips");
const boardStatistics = document.querySelector("#board-statistics");
const lastUpdated = document.querySelector("#last-updated");
const revisionInfo = document.querySelector("#revision-info");
const orderingHint = document.querySelector("#ordering-hint");
const graphPanel = document.querySelector("#graph-panel");
const kanbanButton = document.querySelector("#show-kanban");
const graphButton = document.querySelector("#show-graph");
const viewToolbar = document.querySelector(".view-toolbar");
const dependencySuggestionsButton = document.querySelector("#review-dependency-suggestions");
const dependencySuggestionsPanel = document.querySelector("#dependency-suggestions-panel");
const dependencySuggestionsList = document.querySelector("#dependency-suggestions-list");
const dependencySuggestionsStatus = document.querySelector("#dependency-suggestions-status");
const suggestNextWorkButton = document.querySelector("#suggest-next-work");
const planningStatus = document.querySelector("#planning-status");
const planningContextDetails = document.querySelector("#planning-context-details");
const planningContextJson = document.querySelector("#planning-context-json");
const planningContextStatus = document.querySelector("#planning-context-status");
const planningResult = document.querySelector("#planning-result");
const planningRawResponse = document.querySelector("#planning-raw-response");
const planningRawResponseText = document.querySelector("#planning-raw-response-text");
let activeView = "kanban";
let graphController = null;
let graphModuleAttempt = 0;
let graphViewGeneration = 0;
let pendingGraphTaskId = null;
let boardLoadError = "";
let boardSnapshot = null;
let dismissedSuggestionScope = "";
let dismissedSuggestionIds = new Set();
let dependencySuggestionsExpanded = false;
const pendingSuggestionApprovalIds = new Set();
let draggedTaskId = null;
let dialogMode = null;
const collapsedTaskIds = new Set();
const sortByStatus = new Map();

const viewState = {
  search: "",
  source: [],
  status: [],
  priority: [],
  category: [],
  area: [],
  dependency: [],
};

function loadDismissedSuggestionIds() {
  const scope = `project-kanban:dependency-suggestions:v1:${boardSnapshot.config.projectName}`;
  if (scope === dismissedSuggestionScope) return;

  dismissedSuggestionScope = scope;
  dismissedSuggestionIds = new Set();
  dependencySuggestionsStatus.textContent = "";
  try {
    const stored = window.localStorage.getItem(scope);
    if (stored === null) return;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
      throw new Error("Saved dismissals have an invalid format.");
    }
    dismissedSuggestionIds = new Set(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown storage error.";
    dependencySuggestionsStatus.textContent = `Previously dismissed suggestions could not be loaded: ${message}`;
  }
}

function persistDismissedSuggestionIds() {
  try {
    window.localStorage.setItem(dismissedSuggestionScope, JSON.stringify([...dismissedSuggestionIds]));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown storage error.";
    dependencySuggestionsStatus.textContent = `Dismissal was kept for this page only because browser storage failed: ${message}`;
    return false;
  }
}

function renderDependencySuggestions() {
  const suggestions = boardSnapshot.dependencySuggestions;
  loadDismissedSuggestionIds();
  const availableIds = new Set(suggestions.map(({ id }) => id));
  let dismissedStateChanged = false;
  for (const id of dismissedSuggestionIds) {
    if (availableIds.has(id)) continue;
    dismissedSuggestionIds.delete(id);
    dismissedStateChanged = true;
  }
  if (dismissedStateChanged) persistDismissedSuggestionIds();

  const visibleSuggestions = suggestions.filter(({ id }) => !dismissedSuggestionIds.has(id));
  dependencySuggestionsButton.textContent = `Dependency suggestions (${visibleSuggestions.length})`;
  dependencySuggestionsButton.setAttribute("aria-expanded", String(dependencySuggestionsExpanded));
  dependencySuggestionsPanel.hidden = !dependencySuggestionsExpanded;
  dependencySuggestionsList.replaceChildren();

  if (visibleSuggestions.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.textContent = suggestions.length === 0
      ? "No dependency suggestions were detected."
      : "All detected suggestions have been reviewed or dismissed.";
    dependencySuggestionsList.append(emptyState);
    return;
  }

  for (const suggestion of visibleSuggestions) {
    const card = document.createElement("article");
    card.className = "dependency-suggestion";
    const heading = document.createElement("h3");
    heading.textContent =
      `${suggestion.dependentTaskId}: ${stripTaskIdTitle(suggestion.dependentTaskId, suggestion.dependentTaskTitle)} ` +
      `may depend on ${suggestion.prerequisiteTaskId}: ` +
      stripTaskIdTitle(suggestion.prerequisiteTaskId, suggestion.prerequisiteTaskTitle);

    const metadata = document.createElement("p");
    const confidencePresentation = getDependencySuggestionConfidencePresentation(suggestion);
    const confidence = document.createElement("span");
    confidence.className = confidencePresentation.className;
    confidence.dataset.confidence = confidencePresentation.level;
    confidence.textContent = confidencePresentation.text;
    metadata.append(
      `Found in ${suggestion.field} via “${suggestion.relationshipPhrase}” · `,
      confidence,
    );

    const evidence = document.createElement("blockquote");
    evidence.textContent = suggestion.evidence;

    const actions = document.createElement("div");
    actions.className = "dependency-suggestion-actions";
    for (const [action, label] of [
      ["approve", "Approve"],
      ["dismiss", "Not a Dependency"],
    ]) {
      const button = document.createElement("button");
      button.className = "secondary-button";
      button.type = "button";
      button.dataset.suggestionAction = action;
      button.dataset.suggestionId = suggestion.id;
      button.textContent = label;
      button.disabled = action === "approve" && pendingSuggestionApprovalIds.has(suggestion.id);
      actions.append(button);
    }

    card.append(heading, metadata, evidence, actions);
    dependencySuggestionsList.append(card);
  }
}

async function approveDependencySuggestion(suggestion) {
  const dependent = boardSnapshot?.tasks.find(({ id }) => id === suggestion.dependentTaskId);
  if (!dependent) {
    dependencySuggestionsStatus.textContent = `Task ${suggestion.dependentTaskId} is no longer available. Refresh and retry.`;
    return;
  }

  const dependencyIds = String(dependent.dependsOn ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (dependencyIds.includes(suggestion.prerequisiteTaskId)) {
    dependencySuggestionsStatus.textContent = "This dependency is already present. Refresh the board to update suggestions.";
    return;
  }

  try {
    await postTaskMutation(
      "/api/tasks/edit",
      {
        taskId: dependent.id,
        updates: { dependsOn: [...dependencyIds, suggestion.prerequisiteTaskId].join(", ") },
      },
      `Approving ${dependent.id} → ${suggestion.prerequisiteTaskId}…`,
    );
    dependencySuggestionsStatus.textContent =
      `Approved ${dependent.id} → ${suggestion.prerequisiteTaskId}; the canonical graph has been refreshed.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dependency approval error.";
    dependencySuggestionsStatus.textContent = `Could not approve this dependency: ${message}`;
    statusElement.textContent = `Could not approve this dependency: ${message}`;
  }
}

function appendTag(parent, label, className = "") {
  const tag = document.createElement("span");
  tag.className = `card-tag ${className}`.trim();
  tag.textContent = label;
  parent.append(tag);
}

function sourceForTask(task) {
  return boardSnapshot.config.sources.find(({ path }) => path === task.source.document);
}

function canonicalTaskOrder(left, right) {
  return compareCanonicalTaskOrder(left, right, boardSnapshot.config);
}

function sortColumnCards(cards, status) {
  return sortTasks(cards, boardSnapshot.config, sortByStatus.get(status) ?? "manual");
}

function hasActiveFilters() {
  return hasActiveTaskFilters(viewState);
}

function canReorderColumn(status) {
  return isManualOrderView(viewState, sortByStatus.get(status) ?? "manual");
}

function updateBoardSummary() {
  if (!boardSnapshot) return;
  if (boardLoadError) {
    boardStatistics.textContent = "Task counts unavailable.";
orderingHint.hidden = true;
    return;
  }
  const matchingTasks = filterTasks(boardSnapshot.tasks, boardSnapshot.config, viewState);
  const workflow = getWorkflowSummary(matchingTasks, boardSnapshot.config);
  const workflowSummary =
    `${workflow.readyCount} dependency-ready · ${workflow.blockedCount} blocked · ${workflow.cycleCount} cycle tasks`;
  if (activeView === "graph") {
    boardStatistics.textContent =
      `${matchingTasks.length} of ${boardSnapshot.tasks.length} tasks match the shared filters · ${workflowSummary}`;
    orderingHint.hidden = true;
    return;
  }
  const revealedTask = viewState.revealedTaskId &&
    boardSnapshot.tasks.find(({ id }) => id === viewState.revealedTaskId);
  const revealNote = revealedTask && !matchesTaskView(revealedTask, boardSnapshot.config, viewState)
    ? `; 1 temporarily shown outside filters (${revealedTask.id})`
    : "";
  boardStatistics.textContent =
    `${matchingTasks.length} of ${boardSnapshot.tasks.length} tasks match${revealNote} · ${workflowSummary}`;
  orderingHint.hidden = !hasActiveFilters() && !boardSnapshot.config.statuses.some(
    (status) => (sortByStatus.get(status) ?? "manual") !== "manual",
  );
}

function selectedFilterOptions(control) {
  return [...control.querySelectorAll(".filter-options input:checked")].map((input) => ({
    value: input.value,
    label: input.nextElementSibling.textContent,
  }));
}

function updateFilterSummary(control) {
  const selected = selectedFilterOptions(control);
  const filterLabel = control.dataset.filterLabel;
  const summary = control.querySelector("summary");
  summary.textContent = selected.length === 0
    ? control.dataset.allLabel
    : selected.length === 1
      ? `${filterLabel}: ${selected[0].label}`
      : `${filterLabel} (${selected.length} selected)`;
  summary.title = selected.map(({ label }) => label).join(", ");
  summary.setAttribute(
    "aria-label",
    selected.length ? `${filterLabel} filter. Selected: ${selected.map(({ label }) => label).join(", ")}` :
      control.dataset.allLabel,
  );
}

function renderActiveFilterChips() {
  const fragment = document.createDocumentFragment();
  for (const control of filterControls) {
    const filterLabel = control.dataset.filterLabel;
    for (const option of selectedFilterOptions(control)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.dataset.filterKey = control.dataset.filter;
      chip.dataset.filterValue = option.value;
      chip.textContent = `${filterLabel}: ${option.label} ×`;
      chip.setAttribute("aria-label", `Remove ${filterLabel} filter ${option.label}`);
      fragment.append(chip);
    }
  }
  activeFilterChips.replaceChildren(fragment);
  activeFilterChips.hidden = activeFilterChips.childElementCount === 0;
}

function setFilterOptions(control, options) {
  const key = control.dataset.filter;
  const availableValues = new Set(options.map(({ value }) => value));
  viewState[key] = viewState[key].filter((value) => availableValues.has(value));
  const fieldset = control.querySelector(".filter-options");
  const fragment = document.createDocumentFragment();
  for (const { value, label: optionLabel } of options) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.checked = viewState[key].includes(value);
    text.textContent = optionLabel;
    label.append(checkbox, text);
    fragment.append(label);
  }
  fieldset.replaceChildren(fragment);
  updateFilterSummary(control);
}

function refreshFilterOptions() {
  const sources = boardSnapshot.config.sources.map(({ key, label }) => ({ value: key, label }));
  const statuses = boardSnapshot.config.statuses.map((value) => ({ value, label: value }));
  const priorities = boardSnapshot.config.priorities.map(({ name }) => ({ value: name, label: name }));
  const categories = [...new Set(boardSnapshot.tasks.map(({ category }) => category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
  const areas = [...new Set(boardSnapshot.tasks.map(({ area }) => area).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
  const dependencyStates = [
    { value: "blocked", label: "Blocked" },
    { value: "unblocked", label: "Unblocked" },
    { value: "unresolved", label: "Unresolved references" },
    { value: "cycle", label: "Dependency cycles" },
  ];
  const optionsByKey = {
    source: sources,
    status: statuses,
    priority: priorities,
    category: categories,
    area: areas,
    dependency: dependencyStates,
  };
  for (const control of filterControls) setFilterOptions(control, optionsByKey[control.dataset.filter] ?? []);
  renderActiveFilterChips();
  taskSearchInput.value = viewState.search;
}

function createMoveButton(task, direction, index, cardCount) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reorder-button";
  button.textContent = direction === "up" ? "↑" : "↓";
  button.setAttribute(
    "aria-label",
    `Move ${task.title} ${direction === "up" ? "earlier" : "later"} in ${task.status}`,
  );
  button.disabled =
    !canReorderColumn(task.status) || (direction === "up" ? index === 0 : index === cardCount - 1);
  button.addEventListener("click", () => {
    void moveTaskToIndex(task.id, task.status, index + (direction === "up" ? -1 : 1));
  });
  return button;
}

function createStatusSelect(task) {
  const label = document.createElement("label");
  label.className = "visually-hidden";
  label.textContent = `Move ${task.title} to a column`;

  const select = document.createElement("select");
  select.className = "status-select";
  select.setAttribute("aria-label", label.textContent);
  for (const status of boardSnapshot.config.statuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === task.status;
    select.append(option);
  }
  select.addEventListener("change", () => {
    void moveTaskToStatus(task.id, select.value);
  });
  label.append(select);
  return label;
}

function createCardAction(label, className, handler, action = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card-action-button ${className}`.trim();
  button.textContent = label;
  if (action) button.dataset.cardAction = action;
  button.addEventListener("click", handler);
  return button;
}

function renderCard(task, index, cardCount, temporarilyRevealed = false) {
  const presentation = getCardPresentation(
    task,
    boardSnapshot.config,
    collapsedTaskIds.has(task.id),
  );
  const item = document.createElement("li");
  item.className = "board-card-item";
  item.draggable = canReorderColumn(task.status);
  item.dataset.taskId = task.id;
  item.dataset.status = task.status;
  if (temporarilyRevealed) item.classList.add("is-filter-revealed");
  item.setAttribute("aria-label", `${presentation.title}, ${task.category}`);

  const article = document.createElement("article");
  article.className = "board-card";
  article.dataset.priority = task.priority;
  article.dataset.category = task.category;
  article.dataset.sourceType = sourceForTask(task)?.key ?? "";

  const sourceConfig = sourceForTask(task);
  const priority = boardSnapshot.config.priorities.find(({ name }) => name === task.priority);
  article.dataset.priorityTone = priority?.tone ?? "low";

  const title = document.createElement("h3");
  title.textContent = presentation.title;
  article.append(title);

  const classification = document.createElement("div");
  classification.className = "card-classification";
  appendTag(classification, task.category, `category-tone-${sourceConfig?.categoryTone ?? "slate"}`);
  appendTag(classification, task.area, "area-tag");
  article.append(classification);
  if (temporarilyRevealed) {
    const note = document.createElement("p");
    note.className = "filter-reveal-note";
    note.textContent = "Temporarily shown outside the active filters.";
    article.append(note);
  }

  if (presentation.detailSections.length > 0) {
    const details = document.createElement("div");
    details.className = "card-details";
    details.hidden = presentation.detailsHidden;
    for (const sectionData of presentation.detailSections) {
      const section = document.createElement("section");
      section.className = "card-detail-section";
      const heading = document.createElement("h4");
      heading.textContent = sectionData.label;
      const content = document.createElement("p");
      content.textContent = sectionData.value;
      section.append(heading, content);
      details.append(section);
    }
    article.append(details);
  }

  if (presentation.relationshipSections.length > 0) {
    const relationships = document.createElement("section");
    relationships.className = "card-relationships";
    relationships.setAttribute("aria-label", "Dependencies");
    for (const relationship of presentation.relationshipSections) {
      const row = document.createElement("div");
      row.className = relationship.label === "Dependency warning"
        ? "card-relationship-row dependency-warning"
        : relationship.label === "Blocked By"
          ? "card-relationship-row dependency-blocker"
          : "card-relationship-row";
      const label = document.createElement("span");
      label.className = "card-relationship-label";
      label.textContent = relationship.label;
      const value = document.createElement("span");
      value.className = "card-relationship-value";
      value.textContent = relationship.value;
      row.append(label, value);
      relationships.append(row);
    }
    article.append(relationships);
  }

  if (presentation.lifecycleDates.length > 0) {
    const lifecycle = document.createElement("footer");
    lifecycle.className = "card-lifecycle";
    for (const { label, value } of presentation.lifecycleDates) {
      const date = document.createElement("time");
      date.className = "card-lifecycle-date";
      date.dateTime = value;
      const dateLabel = document.createElement("span");
      dateLabel.className = "card-lifecycle-label";
      dateLabel.textContent = `${label}:`;
      date.append(dateLabel, document.createTextNode(` ${value}`));
      lifecycle.append(date);
    }
    article.append(lifecycle);
  }

  const controls = document.createElement("div");
  controls.className = "card-controls";
  controls.append(
    createCardAction(
      collapsedTaskIds.has(task.id) ? "Expand" : "Collapse",
      "collapse-button",
      () => toggleCardCollapsed(task.id),
      "collapse",
    ),
    createMoveButton(task, "up", index, cardCount),
    createMoveButton(task, "down", index, cardCount),
    createStatusSelect(task),
    createCardAction("Edit", "", () => openEditDialog(task)),
    createCardAction("Show in graph", "", () => void showTaskInGraph(task.id), "graph"),
    createCardAction("Delete", "delete-button", () => void deleteTask(task)),
  );
  const collapseButton = controls.querySelector('[data-card-action="collapse"]');
  collapseButton.setAttribute("aria-expanded", String(!collapsedTaskIds.has(task.id)));
  collapseButton.setAttribute(
    "aria-label",
    `${collapsedTaskIds.has(task.id) ? "Expand" : "Collapse"} details for ${task.title}`,
  );
  article.append(controls);
  item.append(article);
  return item;
}

function renderBoard(payload) {
  if (
    !payload ||
    !Array.isArray(payload.columns) ||
    !Array.isArray(payload.tasks) ||
    !Array.isArray(payload.dependencySuggestions) ||
    !Array.isArray(payload.sources) ||
    !payload.config ||
    !Array.isArray(payload.config.statuses) ||
    !Array.isArray(payload.config.priorities) ||
    !Array.isArray(payload.config.sources) ||
    !payload.revisions ||
    typeof payload.revisions !== "object"
  ) {
    throw new Error("The board response has an invalid shape.");
  }

  boardSnapshot = payload;
  boardLoadError = "";
  const taskIds = new Set(payload.tasks.map(({ id }) => id));
  for (const taskId of collapsedTaskIds) {
    if (!taskIds.has(taskId)) collapsedTaskIds.delete(taskId);
  }
  for (const status of sortByStatus.keys()) {
    if (!payload.config.statuses.includes(status)) sortByStatus.delete(status);
  }
  document.title = payload.config.boardTitle;
  boardElement.style.setProperty("--board-column-count", String(payload.config.statuses.length));
  const projectName = document.querySelector("#project-name");
  if (projectName) projectName.textContent = payload.config.projectName;
  renderDependencySuggestions();
  createActionsElement.replaceChildren();
  for (const source of payload.config.sources) {
    const button = document.createElement("button");
    button.className = "create-button";
    button.type = "button";
    button.dataset.create = source.key;
    button.textContent = `+ ${source.label}`;
    createActionsElement.append(button);
  }

  refreshFilterOptions();
  if (!payload.tasks.some(({ id }) => id === viewState.revealedTaskId)) viewState.revealedTaskId = null;
  renderColumns(payload.columns);
  sourcesElement.textContent = payload.sources.join(" · ");
  revisionInfo.textContent = Object.entries(payload.revisions)
    .map(([path, revision]) => `${path}: ${revision.slice(0, 8)}`)
    .join(" · ");
  lastUpdated.textContent = `Last refreshed: ${
    payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "time unavailable"
  }`;
  updateBoardSummary();
  statusElement.textContent = `${payload.tasks.length} tasks loaded.`;
  if (activeView === "graph") void renderGraph();
}

async function renderGraph() {
  const request = ++graphViewGeneration;
  try {
    if (!graphController) {
      const module = await import(`./board-graph-client.js?attempt=${++graphModuleAttempt}`);
      if (request !== graphViewGeneration || activeView !== "graph") return;
        graphController = module.createGraphController(graphPanel, {
          onEditTask: openEditDialog,
          onShowOnBoard: showTaskOnBoard,
        });
    }
    if (boardLoadError) {
      graphController.fail(boardLoadError);
      return;
    }
    if (!boardSnapshot) {
      graphPanel.querySelector("#graph-message").textContent = "Load the Markdown board before viewing dependencies.";
      return;
    }
    const pendingTaskId = pendingGraphTaskId;
    pendingGraphTaskId = null;
    await graphController.render(boardSnapshot, viewState);
    if (pendingTaskId && request === graphViewGeneration && activeView === "graph") {
      await graphController.showTask(pendingTaskId);
    }
  } catch (error) {
    if (request !== graphViewGeneration || activeView !== "graph") return;
    graphPanel.querySelector("#graph-error-message").textContent =
      error instanceof Error ? error.message : "The graph module could not be loaded.";
    graphPanel.querySelector("#graph-error").hidden = false;
    graphPanel.querySelector("#graph-viewport").hidden = true;
    graphPanel.querySelector("#graph-message").textContent = "Dependency graph unavailable.";
  }
}

function setProjectView(view) {
  activeView = view;
  const graphVisible = view === "graph";
  boardElement.hidden = graphVisible;
  viewToolbar.hidden = false;
  viewToolbar.classList.toggle("graph-active", graphVisible);
  graphPanel.hidden = !graphVisible;
  kanbanButton.setAttribute("aria-pressed", String(!graphVisible));
  graphButton.setAttribute("aria-pressed", String(graphVisible));
  updateBoardSummary();
  if (graphVisible) void renderGraph();
  else {
    graphViewGeneration += 1;
    graphController?.suspend();
  }
}

function renderColumns(columns) {
  const fragment = document.createDocumentFragment();
  for (const column of columns) {
    if (!column || typeof column.status !== "string" || !Array.isArray(column.cards)) {
      throw new Error("The board response contains an invalid column.");
    }

    const matchingCards = filterTasks(column.cards, boardSnapshot.config, viewState);
    const revealedTask = viewState.revealedTaskId
      ? column.cards.find(({ id }) => id === viewState.revealedTaskId)
      : null;
    const hasTemporaryReveal = Boolean(revealedTask && !matchingCards.some(({ id }) => id === revealedTask.id));
    const visibleCards = sortColumnCards(
      hasTemporaryReveal ? [...matchingCards, revealedTask] : matchingCards,
      column.status,
    );
    const section = document.createElement("section");
    section.className = "board-column";
    section.dataset.status = column.status;
    section.setAttribute("aria-label",
      `${column.status}, ${matchingCards.length} matching cards` +
      `${hasTemporaryReveal ? ", 1 task temporarily shown outside filters" : ""}`);

    const heading = document.createElement("div");
    heading.className = "column-heading";
    const headingCopy = document.createElement("div");
    headingCopy.className = "column-heading-copy";
    const headingLine = document.createElement("div");
    headingLine.className = "column-heading-line";
    const title = document.createElement("h2");
    title.textContent = column.status;
    const count = document.createElement("span");
    count.className = "column-count";
    count.textContent = hasActiveFilters()
      ? `${matchingCards.length}/${column.cards.length}${hasTemporaryReveal ? " +1 shown" : ""}`
      : String(column.cards.length);
    count.setAttribute("aria-label",
      `${matchingCards.length} of ${column.cards.length} cards match` +
      `${hasTemporaryReveal ? "; 1 temporarily shown outside filters" : ""}`);
    headingLine.append(title, count);
    headingCopy.append(headingLine);

    const sortLabel = document.createElement("label");
    sortLabel.className = "column-sort-field";
    sortLabel.append(document.createTextNode("Sort "));
    const sortSelect = document.createElement("select");
    sortSelect.className = "column-sort";
    sortSelect.dataset.columnStatus = column.status;
    sortSelect.setAttribute("aria-label", sortLabel.textContent);
    const sortOptions = [
      ["manual", "Manual order"],
      ["priority", "Priority"],
      ["category", "Category"],
      ["area", "Area"],
    ];
    if (boardSnapshot.config.sources.some(({ extraFields }) => extraFields.some(({ key }) => key === "completionDate"))) {
      sortOptions.push(["completionDate", "Completion date (oldest first)"]);
      sortOptions.push(["completionDateDescending", "Completion date (newest first)"]);
    }
    if (boardSnapshot.config.sources.some(({ extraFields }) => extraFields.some(({ key }) => key === "createdDate"))) {
      sortOptions.push(["createdDate", "Created date (oldest first)"]);
      sortOptions.push(["createdDateDescending", "Created date (newest first)"]);
    }
    const selectedSort = sortByStatus.get(column.status) ?? "manual";
    for (const [value, label] of sortOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === selectedSort;
      sortSelect.append(option);
    }
    sortSelect.addEventListener("change", () => {
      sortByStatus.set(column.status, sortSelect.value);
      renderColumns(boardSnapshot.columns);
      updateBoardSummary();
      [...document.querySelectorAll(".column-sort")]
        .find((select) => select.dataset.columnStatus === column.status)
        ?.focus();
      statusElement.textContent = `${column.status} sorted by ${sortSelect.selectedOptions[0].textContent}.`;
    });
    sortLabel.append(sortSelect);
    headingCopy.append(sortLabel);
    heading.append(headingCopy);
    section.append(heading);

    const list = document.createElement("ul");
    list.className = "cards";
    if (visibleCards.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-column";
      empty.textContent = column.cards.length === 0
        ? "Drop a task here to update its Status."
        : "No tasks match the current search and filters.";
      list.append(empty);
    } else {
      visibleCards.forEach((task, index) => {
        if (
          !task ||
          typeof task.id !== "string" ||
          typeof task.title !== "string" ||
          typeof task.details !== "string" ||
          typeof task.acceptanceCriteria !== "string" ||
          typeof task.category !== "string" ||
          typeof task.priority !== "string" ||
          typeof task.area !== "string" ||
          typeof task.order !== "number" ||
          !task.source
        ) {
          throw new Error("The board response contains an invalid task.");
        }
        list.append(renderCard(task, index, visibleCards.length,
          hasTemporaryReveal && task.id === revealedTask.id));
      });
    }
    section.append(list);
    fragment.append(section);
  }

  boardElement.replaceChildren(fragment);
}

function announceViewChange() {
  if (!boardSnapshot) return;
  renderColumns(boardSnapshot.columns);
  updateBoardSummary();
  const visibleCount = filterTasks(boardSnapshot.tasks, boardSnapshot.config, viewState).length;
  const reveal = viewState.revealedTaskId &&
    boardSnapshot.tasks.some(({ id }) => id === viewState.revealedTaskId) &&
    !matchesTaskView(boardSnapshot.tasks.find(({ id }) => id === viewState.revealedTaskId), boardSnapshot.config, viewState)
    ? ` One task (${viewState.revealedTaskId}) is temporarily shown outside filters.`
    : "";
  statusElement.textContent = `${visibleCount} of ${boardSnapshot.tasks.length} tasks match the current filters.${reveal}`;
  if (activeView === "graph") void renderGraph();
}

function showTaskOnBoard(taskId) {
  const task = boardSnapshot?.tasks.find(({ id }) => id === taskId);
  if (!task) {
    statusElement.textContent = `Task ${taskId} is no longer available on the board. Refresh and retry.`;
    return;
  }
  viewState.revealedTaskId = matchesTaskView(task, boardSnapshot.config, viewState) ? null : taskId;
  setProjectView("kanban");
  announceViewChange();
  requestAnimationFrame(() => {
    const item = [...boardElement.querySelectorAll("[data-task-id]")]
      .find((candidate) => candidate.dataset.taskId === taskId);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    item?.querySelector("h3")?.setAttribute("tabindex", "-1");
    item?.querySelector("h3")?.focus({ preventScroll: true });
  });
}

function showTaskInGraph(taskId) {
  if (!boardSnapshot?.tasks.some(({ id }) => id === taskId)) {
    statusElement.textContent = `Task ${taskId} is no longer available on the board. Refresh and retry.`;
    return;
  }
  pendingGraphTaskId = taskId;
  if (activeView !== "graph") setProjectView("graph");
  else void renderGraph();
}

function calculateOrder(taskId, status, requestedIndex) {
  return calculateOrderValue(boardSnapshot.tasks, taskId, status, requestedIndex, boardSnapshot.config);
}

async function postTaskMutation(endpoint, payload, progressMessage) {
  if (!boardSnapshot) throw new Error("The board is not loaded.");
  refreshButton.disabled = true;
  statusElement.textContent = progressMessage;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, revisions: boardSnapshot.revisions }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error(`${result.error ?? "The source documents changed."} Refresh the board and retry.`);
      }
      throw new Error(typeof result.error === "string" ? result.error : "The task could not be saved.");
    }
    renderBoard(result);
    return result;
  } finally {
    refreshButton.disabled = false;
  }
}

async function moveTaskToIndex(taskId, status, index) {
  try {
    const task = boardSnapshot?.tasks.find((candidate) => candidate.id === taskId);
    if (!task || !boardSnapshot.config.statuses.includes(status)) {
      throw new Error("The selected task or Status is unavailable.");
    }
    if (!canReorderColumn(task.status) || !canReorderColumn(status)) {
      throw new Error("Reordering is disabled while search, filters, or a non-manual column sort is active.");
    }
    const destinationLength = boardSnapshot.tasks.filter(
      (candidate) => candidate.status === status && candidate.id !== taskId,
    ).length;
    const boundedIndex = Number.isFinite(index) ? index : destinationLength;
    const order = calculateOrder(taskId, status, boundedIndex);
    if (task.status === status && task.order === order) return;
    await postTaskMutation(
      "/api/tasks/move",
      { taskId, status, order },
      `Saving ${task.title} to ${status}…`,
    );
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? `Unable to save move: ${error.message}` : "Unable to save task move.";
  }
}

async function moveTaskToStatus(taskId, status) {
  try {
    const task = boardSnapshot?.tasks.find((candidate) => candidate.id === taskId);
    if (!task || !boardSnapshot.config.statuses.includes(status)) {
      throw new Error("The selected task or Status is unavailable.");
    }
    if (task.status === status) return;
    const destinationLength = boardSnapshot.tasks.filter((candidate) => candidate.status === status).length;
    const order = calculateOrder(taskId, status, destinationLength);
    await postTaskMutation(
      "/api/tasks/move",
      { taskId, status, order },
      `Saving ${task.title} to ${status}…`,
    );
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? `Unable to save move: ${error.message}` : "Unable to save task move.";
  }
}

function createField(name, labelText, value = "", options = {}) {
  const field = document.createElement("div");
  field.className = `task-field${options.fullWidth ? " full-width" : ""}`;
  const label = document.createElement("label");
  label.htmlFor = `task-field-${name}`;
  label.textContent = labelText;
  let control;
  if (options.choices) {
    control = document.createElement("select");
    if (!options.required) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Not specified";
      emptyOption.selected = value === "";
      control.append(emptyOption);
    }
    for (const choice of options.choices) {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      option.selected = choice === value;
      control.append(option);
    }
  } else if (options.multiline) {
    control = document.createElement("textarea");
    control.value = value;
  } else {
    control = document.createElement("input");
    control.type = options.inputType ?? "text";
    control.value = value;
  }
  control.name = name;
  control.id = label.htmlFor;
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.required) control.required = true;
  if (options.maxLength) control.maxLength = options.maxLength;
  field.append(label, control);

  if (options.suggestions?.length) {
    const datalist = document.createElement("datalist");
    datalist.id = `${control.id}-suggestions`;
    control.setAttribute("list", datalist.id);
    for (const suggestion of options.suggestions) {
      const option = document.createElement("option");
      option.value = suggestion;
      datalist.append(option);
    }
    field.append(datalist);
  }
  if (options.dependencyTasks) field.append(createDependencyPicker(control, options.dependencyTasks));
  return field;
}

function createDependencyPicker(control, tasks) {
  const picker = document.createElement("div");
  picker.className = "task-dependency-picker";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "task-dependency-search";
  search.autocomplete = "off";
  search.placeholder = "Search tasks by ID or title";
  search.setAttribute("aria-label", "Search tasks to add as dependencies");
  const options = document.createElement("div");
  options.className = "task-dependency-options";
  options.setAttribute("role", "group");
  options.setAttribute("aria-label", "Available dependency tasks");
  const entries = [];

  function syncSelectedTasks() {
    const selected = new Set(control.value.split(",").map((id) => id.trim()).filter(Boolean));
    for (const entry of entries) entry.checkbox.checked = selected.has(entry.task.id);
  }

  for (const task of tasks) {
    const label = document.createElement("label");
    label.className = "task-dependency-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = task.id;
    const description = document.createElement("span");
    description.textContent = `${task.id}: ${task.title}`;
    label.append(checkbox, description);
    options.append(label);
    entries.push({ label, checkbox, task });
    checkbox.addEventListener("change", () => {
      const ids = control.value.split(",").map((id) => id.trim()).filter(Boolean);
      const selected = new Set(ids);
      if (checkbox.checked) selected.add(task.id);
      else selected.delete(task.id);
      control.value = [...selected].join(", ");
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  control.addEventListener("input", syncSelectedTasks);
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const entry of entries) {
      const searchable = `${entry.task.id} ${entry.task.title}`.toLocaleLowerCase();
      entry.label.hidden = query !== "" && !searchable.includes(query);
    }
  });
  syncSelectedTasks();
  picker.append(search, options);
  return picker;
}

function localDateOnly() {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createTaskFormSection(title, fields) {
  if (fields.length === 0) return null;
  const section = document.createElement("fieldset");
  section.className = "task-form-section";
  const legend = document.createElement("legend");
  legend.textContent = title;
  const grid = document.createElement("div");
  grid.className = "task-form-section-fields";
  for (const [name, label, value, options] of fields) {
    grid.append(createField(name, label, value, options));
  }
  section.append(legend, grid);
  return section;
}

function openTaskDialog(mode, taskType, task = null) {
  const source = mode === "create"
    ? boardSnapshot.config.sources.find(({ key }) => key === taskType)
    : boardSnapshot.config.sources.find(({ path }) => path === task?.source.document);
  if (!source) throw new Error("The selected task source is unavailable.");
  dialogMode = { mode, taskType: source.key, taskId: task?.id ?? null };
  taskForm.reset();
  taskFormFields.replaceChildren();
  taskFormError.textContent = "";
  taskDialogTitle.textContent = mode === "create" ? `Create ${source.label}` : `Edit ${task.title}`;
  saveTaskButton.textContent = mode === "create" ? "Create task" : "Save changes";

  const areas = [...new Set(boardSnapshot.tasks.map(({ area }) => area).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categories = [...new Set([
    source.category,
    ...boardSnapshot.tasks.map(({ category }) => category).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));
  const taskFields = [
    ["title", "Title", task?.title ?? "", { required: true, maxLength: 200 }],
    ["area", "Area", task?.area ?? "", {
      required: true, maxLength: 100, suggestions: areas,
    }],
    ["category", "Category", task?.category ?? source.category, {
      required: true, maxLength: 100, suggestions: categories,
    }],
    ["details", "Details", task?.details ?? "", {
      multiline: true, maxLength: 5000, fullWidth: true,
    }],
    ["acceptanceCriteria", "Acceptance Criteria", task?.acceptanceCriteria ?? "", {
      multiline: true, maxLength: 5000, fullWidth: true,
    }],
  ];
  const workflowFields = [
    ["priority", "Priority", task?.priority ?? boardSnapshot.config.priorities[0].name, {
      required: true,
      choices: boardSnapshot.config.priorities.map(({ name }) => name),
    }],
    ["status", "Status", task?.status ?? boardSnapshot.config.defaultStatus, {
      required: true,
      choices: boardSnapshot.config.statuses,
    }],
  ];

  const dependencyFields = [];
  const additionalFields = [];
  for (const field of source.extraFields) {
    let value = task?.[field.key] ?? "";
    if (mode === "create" && field.key === "createdDate" && field.type === "date" && !value) {
      value = localDateOnly();
    }
    const options = {
      required: field.required,
      maxLength: field.type === "date" ? undefined : field.maxLength,
      inputType: field.type === "date" ? "date" : undefined,
      choices: field.choices,
      placeholder: field.type === "task-ids" ? "RM-019, TD-03" : undefined,
      multiline: field.type === "textarea",
      fullWidth: field.type === "textarea" || field.type === "task-ids",
      ...(field.type === "task-ids"
        ? { dependencyTasks: boardSnapshot.tasks.filter(({ id }) => id !== task?.id) }
        : {}),
    };
    const descriptor = [field.key, field.label, value, options];
    if (field.type === "task-ids") dependencyFields.push(descriptor);
    else if (["createdDate", "completionDate", "executionType"].includes(field.key)) workflowFields.push(descriptor);
    else additionalFields.push(descriptor);
  }

  for (const [title, fields] of [
    ["Task details", taskFields],
    ["Workflow", workflowFields],
    ["Dependencies", dependencyFields],
    ["Additional fields", additionalFields],
  ]) {
    const section = createTaskFormSection(title, fields);
    if (section) taskFormFields.append(section);
  }
  taskDialog.showModal();
  taskFormFields.querySelector("input, select, textarea")?.focus();
}

function openEditDialog(task) {
  openTaskDialog("edit", null, task);
}

function closeTaskDialog() {
  if (taskDialog.open) taskDialog.close();
  dialogMode = null;
}

async function submitTaskForm(event) {
  event.preventDefault();
  if (!dialogMode || !taskForm.reportValidity()) return;

  const values = Object.fromEntries(new FormData(taskForm).entries());
  saveTaskButton.disabled = true;
  taskFormError.textContent = "";
  try {
    if (dialogMode.mode === "create") {
      await postTaskMutation(
        "/api/tasks/create",
        { sourceType: dialogMode.taskType, task: values },
        "Creating task…",
      );
    } else {
      const task = boardSnapshot.tasks.find(({ id }) => id === dialogMode.taskId);
      if (!task) throw new Error("The selected task is no longer available.");
      const updates = Object.fromEntries(
        Object.entries(values).filter(([field, value]) => String(task[field] ?? "") !== value),
      );
      if (Object.keys(updates).length === 0) {
        closeTaskDialog();
        return;
      }
      await postTaskMutation(
        "/api/tasks/edit",
        { taskId: dialogMode.taskId, updates },
        "Saving task changes…",
      );
    }
    closeTaskDialog();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The task could not be saved.";
    taskFormError.textContent = message;
    statusElement.textContent = message;
  } finally {
    saveTaskButton.disabled = false;
  }
}

async function deleteTask(task) {
  if (!window.confirm(`Permanently remove ${task.id} · ${task.title} from its active Markdown task table? The narrative text and Git history will remain.`)) {
    return;
  }
  try {
    await postTaskMutation(
      "/api/tasks/delete",
      { taskId: task.id, confirmed: true },
      `Deleting ${task.title}…`,
    );
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? `Unable to delete task: ${error.message}` : "Unable to delete task.";
  }
}

function updateCardCollapseState(taskId, collapsed) {
  const item = [...boardElement.querySelectorAll("[data-task-id]")]
    .find((candidate) => candidate.dataset.taskId === taskId);
  if (!item) return;
  const task = boardSnapshot.tasks.find((candidate) => candidate.id === taskId);
  applyCollapseState(item, task, collapsed);
}

function applyCollapseState(item, task, collapsed) {
  const details = item.querySelector(".card-details");
  if (details) details.hidden = collapsed;
  const button = item.querySelector('[data-card-action="collapse"]');
  if (!button) return;
  button.textContent = collapsed ? "Expand" : "Collapse";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} details for ${task?.title ?? item.dataset.taskId}`);
}

function toggleCardCollapsed(taskId) {
  const collapsed = !collapsedTaskIds.has(taskId);
  if (collapsed) collapsedTaskIds.add(taskId);
  else collapsedTaskIds.delete(taskId);
  updateCardCollapseState(taskId, collapsed);
  statusElement.textContent = `Details ${collapsed ? "collapsed" : "expanded"} for ${taskId}.`;
}

function setAllCardsCollapsed(collapsed) {
  if (!boardSnapshot) return;
  const taskById = new Map(boardSnapshot.tasks.map((task) => [task.id, task]));
  for (const task of boardSnapshot.tasks) {
    if (collapsed) collapsedTaskIds.add(task.id);
    else collapsedTaskIds.delete(task.id);
  }
  for (const item of boardElement.querySelectorAll("[data-task-id]")) {
    applyCollapseState(item, taskById.get(item.dataset.taskId), collapsed);
  }
  statusElement.textContent = `All ${boardSnapshot.tasks.length} cards ${collapsed ? "collapsed" : "expanded"}.`;
}

boardElement.addEventListener("dragstart", (event) => {
  const item = closestElementFromEventTarget(event.target, "[data-task-id]");
  if (!item || !event.dataTransfer || !item.draggable || !canReorderColumn(item.dataset.status)) {
    event.preventDefault();
    return;
  }
  draggedTaskId = item.dataset.taskId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedTaskId);
  item.classList.add("is-dragging");
});

boardElement.addEventListener("dragend", () => {
  draggedTaskId = null;
  boardElement.querySelectorAll(".is-dragging, .drop-before, .drop-after, .is-drop-target").forEach((item) => {
    item.classList.remove("is-dragging", "drop-before", "drop-after", "is-drop-target");
  });
});

boardElement.addEventListener("dragover", (event) => {
  const column = closestElementFromEventTarget(event.target, ".board-column");
  if (!column || !draggedTaskId || !canReorderColumn(column.dataset.status)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

boardElement.addEventListener("drop", (event) => {
  const column = closestElementFromEventTarget(event.target, ".board-column");
  const draggedTask = boardSnapshot?.tasks.find((task) => task.id === draggedTaskId);
  if (
    !column ||
    !draggedTaskId ||
    !draggedTask ||
    !canReorderColumn(draggedTask.status) ||
    !canReorderColumn(column.dataset.status)
  ) return;
  event.preventDefault();

  const target = closestElementFromEventTarget(event.target, "[data-task-id]");
  const taskId = event.dataTransfer?.getData("text/plain") || draggedTaskId;
  if (target?.dataset.taskId === taskId) return;
  let insertionIndex = Number.POSITIVE_INFINITY;
  if (target) {
    const targetTask = boardSnapshot?.tasks.find((task) => task.id === target.dataset.taskId);
    if (targetTask) {
      const cards = boardSnapshot.tasks
        .filter((task) => task.status === column.dataset.status && task.id !== taskId)
        .sort(canonicalTaskOrder);
      const targetIndex = cards.findIndex((task) => task.id === targetTask.id);
      const rect = target.getBoundingClientRect();
      insertionIndex = targetIndex + (event.clientY < rect.top + rect.height / 2 ? 0 : 1);
    }
  }
  void moveTaskToIndex(taskId, column.dataset.status, insertionIndex);
});

boardElement.addEventListener("dragenter", (event) => {
  const column = closestElementFromEventTarget(event.target, ".board-column");
  if (column && canReorderColumn(column.dataset.status)) column.classList.add("is-drop-target");
});

boardElement.addEventListener("dragleave", (event) => {
  const column = closestElementFromEventTarget(event.target, ".board-column");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drop-target");
});

async function refreshBoard() {
  refreshButton.disabled = true;
  statusElement.textContent = "Reading task documents…";

  try {
    const response = await fetch("/api/board", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "The board could not be loaded.");
    }
    renderBoard(payload);
  } catch (error) {
    boardLoadError = error instanceof Error ? error.message : "The board could not be loaded.";
    graphViewGeneration += 1;
    graphController?.fail(`Refresh from Markdown failed: ${boardLoadError}`);
    boardElement.replaceChildren();
    sourcesElement.textContent = "unavailable";
    boardStatistics.textContent = "Task counts unavailable.";
    revisionInfo.textContent = "";
    lastUpdated.textContent = "Last refreshed: unavailable";
    statusElement.textContent =
      error instanceof Error ? `Unable to load board: ${error.message}` : "Unable to load board.";
  } finally {
    refreshButton.disabled = false;
  }
}

function currentPlanningView() {
  const filters = serializePlanningFilters(Object.fromEntries(
    [...filterControlsByKey].map(([key, control]) => [
      key,
      selectedFilterOptions(control).map(({ value }) => value),
    ]),
  ));
  return {
    activeView,
    searchActive: Boolean(viewState.search),
    filters,
    revealedTaskId: viewState.revealedTaskId ?? null,
  };
}

async function loadPlanningContext() {
  planningContextJson.value = "";
  planningContextStatus.textContent = "Reading current board and project context…";
  try {
    const response = await fetch("/api/planning-context", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Planning context could not be loaded.");
    }
    const context = { ...payload, currentView: currentPlanningView() };
    planningContextJson.value = JSON.stringify(context, null, 2);
    planningContextStatus.textContent =
      `Context refreshed ${new Date(context.generatedAt).toLocaleString()}. It includes all tasks; current filters are metadata only.`;
    return context;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown planning context error.";
    planningContextStatus.textContent = `Unable to load planning context: ${message}`;
    return null;
  }
}

function renderPlanningList(element, items, emptyMessage) {
  element.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = emptyMessage;
    element.append(empty);
    return;
  }
  for (const item of items) {
    const entry = document.createElement("li");
    entry.textContent = item;
    element.append(entry);
  }
}

function appendRouteList(card, headingText, items, emptyText) {
  const heading = document.createElement("h5");
  heading.textContent = headingText;
  const list = document.createElement("ul");
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    for (const text of items) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
  }
  card.append(heading, list);
}

function renderPlanningRoutes(plan) {
  const list = document.querySelector("#planning-route-list");
  list.replaceChildren();
  const assessment = document.querySelector("#planning-route-assessment");
  assessment.textContent = plan.routeAssessment.explanation;
  if (plan.deliveryRoutes.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No multi-task delivery route is supported by the available evidence.";
    list.append(empty);
    return;
  }

  for (const route of plan.deliveryRoutes) {
    const card = document.createElement("article");
    card.className = "planning-route";
    card.dataset.recommended = String(route.recommended);

    const heading = document.createElement("h4");
    heading.textContent = route.recommended ? `${route.name} — Recommended route` : route.name;
    const outcome = document.createElement("p");
    outcome.textContent = `Intended outcome: ${route.intendedOutcome}`;
    const alignment = document.createElement("p");
    alignment.textContent = `Goal alignment: ${route.goalAlignment}`;
    const rationale = document.createElement("p");
    rationale.textContent = `Strategy: ${route.strategyRationale}`;
    const confidenceLabel = document.createElement("p");
    confidenceLabel.textContent =
      `Route confidence: ${route.confidence.level} — ${route.confidence.rationale}`;
    const stoppingPoint = document.createElement("p");
    stoppingPoint.textContent = `Stopping point: ${route.stoppingPoint}`;
    card.append(heading, outcome, alignment, rationale, confidenceLabel, stoppingPoint);

    appendRouteList(card, "Trade-offs", route.tradeoffs, "No material trade-offs reported.");
    appendRouteList(card, "Assumptions", route.assumptions, "No material assumptions reported.");
    appendRouteList(card, "Risks", route.risks, "No route-specific risks reported.");
    appendRouteList(card, "Evidence", route.evidence, "No route evidence supplied.");
    appendRouteList(card, "Goal evidence", route.goalEvidence, "No explicit goal evidence supplied.");
    appendRouteList(
      card,
      "Unfinished recorded prerequisites outside this route",
      route.externalPrerequisites.map(({ taskId, title, rationale: reason, condition }) =>
        `${taskId}: ${title}. ${reason} Condition: ${condition}`,
      ),
      "None reported.",
    );
    appendRouteList(
      card,
      "Unresolved recorded prerequisites",
      route.unresolvedPrerequisites.map(({ taskId, rationale: reason }) => `${taskId}: ${reason}`),
      "None reported.",
    );

    const stepsHeading = document.createElement("h5");
    stepsHeading.className = "planning-route-steps-heading";
    stepsHeading.textContent = "Route steps — advisory ordering, not dependencies";
    const steps = document.createElement("ol");
    steps.className = "planning-route-steps";
    steps.setAttribute("aria-label", `${route.name} route steps`);
    for (const step of route.steps) {
      const item = document.createElement("li");
      const task = document.createElement("p");
      task.className = "planning-route-step-title";
      task.textContent = `${step.taskId}: ${step.title}`;

      const relationship = document.createElement("p");
      relationship.textContent = step.relationshipKinds.length === 0
        ? `Route starting point. ${step.relationshipRationale}`
        : `Relationship to prior route work: ${step.relationshipKinds
          .map((kind) => PLANNING_ROUTE_RELATIONSHIPS[kind] ?? kind)
          .join(", ")}. ${step.relationshipRationale}`;
      const details = document.createElement("p");
      details.textContent =
        `Contribution: ${step.contribution} Rationale: ${step.rationale} ` +
        `Expected benefit: ${step.benefit} Unlocks: ${step.unlocks}`;
      const recordedPrerequisites = document.createElement("p");
      recordedPrerequisites.textContent = step.recordedPrerequisiteIds.length === 0
        ? "Recorded prerequisites: none."
        : `Recorded prerequisites: ${step.recordedPrerequisiteIds.join(", ")}.`;
      const confidenceLabel = document.createElement("p");
      confidenceLabel.textContent =
        `Step confidence: ${step.confidence.level} — ${step.confidence.rationale}`;
      item.append(task, relationship, details, recordedPrerequisites, confidenceLabel);
      steps.append(item);
    }
    card.append(stepsHeading, steps);
    list.append(card);
  }
}

function renderPlanningCoverage(payload, plan) {
  const coverage = payload.coverage;
  const summary = document.querySelector("#planning-coverage-summary");
  summary.replaceChildren();
  const entries = [
    ["Planning confidence", `${plan.planningConfidence.level} — ${plan.planningConfidence.rationale}`],
    [
      "Dependency coverage",
      `${coverage.canonicalDependencyCount} recorded edges across ${coverage.tasksWithRecordedDependencies} of ` +
        `${coverage.totalTaskCount} tasks; this is a record count, not a completeness measure.`,
    ],
  ];
  for (const [label, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    summary.append(term, description);
  }

  const recordedDependencies = coverage.recordedDependencies.map(({ prerequisiteId, prerequisiteTitle, dependentId }) =>
    `${dependentId} depends on ${prerequisiteId}${prerequisiteTitle ? ` (${prerequisiteTitle})` : " (unresolved)"}`,
  );
  renderPlanningList(
    document.querySelector("#planning-recorded-dependencies"),
    recordedDependencies,
    "No Depends On edges are recorded. This does not establish that no prerequisite exists.",
  );

  const suggestedDependencies = plan.reasoning.suggestedDependencies.map((suggestion) =>
    `${suggestion.dependentTaskId}: ${suggestion.dependentTaskTitle} may depend on ` +
      `${suggestion.prerequisiteTaskId}: ${suggestion.prerequisiteTaskTitle} ` +
      `(agent confidence: ${suggestion.confidence}). Evidence: ${suggestion.evidence} ` +
      `Rationale: ${suggestion.rationale}`,
  );
  renderPlanningList(
    document.querySelector("#planning-suggested-dependencies"),
    suggestedDependencies,
    "No suggested dependency relationships were reported.",
  );

  const goalSources = coverage.explicitGoals.map(({ source, line, text }) => `${source}:${line} — ${text}`);
  renderPlanningList(
    document.querySelector("#planning-goal-sources"),
    goalSources,
    "No explicit project goal was extracted from the included project documents. A goal supplied in the conversation is separate evidence.",
  );
}

function renderPlanningResult(payload) {
  const { plan } = payload;
  planningResult.hidden = false;
  planningRawResponse.hidden = true;
  if (plan.recommendation) {
    document.querySelector("#planning-recommendation-title").textContent =
      `${plan.recommendation.taskId}: ${plan.recommendation.title}`;
    document.querySelector("#planning-why-now").textContent = `Why now: ${plan.recommendation.whyNow}`;
    document.querySelector("#planning-unlocks").textContent = `What it unlocks: ${plan.recommendation.unlocks}`;
  } else {
    document.querySelector("#planning-recommendation-title").textContent = "No recommendation";
    document.querySelector("#planning-why-now").textContent = plan.noRecommendationReason;
    document.querySelector("#planning-unlocks").textContent = "";
  }
  document.querySelector("#planning-summary").textContent = plan.summary;
  document.querySelector("#planning-confidence").textContent =
    `Planning confidence: ${plan.planningConfidence.level} — ${plan.planningConfidence.rationale}`;

  renderPlanningRoutes(plan);
  renderPlanningCoverage(payload, plan);

  const riskList = document.querySelector("#planning-risks");
  renderPlanningList(
    riskList,
    plan.risks.map(({ risk, mitigation }) => `${risk} Mitigation: ${mitigation}`),
    "No specific risks were identified; verify the recommendation against current project context.",
  );

  document.querySelector("#planning-expanded-why").textContent =
    plan.reasoning.whyRecommendation || "Expanded recommendation reasoning was not supplied.";
  document.querySelector("#planning-expanded-unlocks").textContent =
    plan.reasoning.whatItUnlocks || "Expanded unlock analysis was not supplied.";
  document.querySelector("#planning-first-step").textContent =
    plan.reasoning.suggestedFirstStep || "No first step was supplied.";
  renderPlanningList(
    document.querySelector("#planning-prerequisites"),
    plan.reasoning.prerequisites,
    "No prerequisites identified.",
  );
  renderPlanningList(
    document.querySelector("#planning-alternatives-not-selected"),
    plan.reasoning.alternativesNotSelected,
    "No alternatives were discussed.",
  );
  renderPlanningList(
    document.querySelector("#planning-missing-dependencies"),
    plan.reasoning.missingDependencyObservations,
    "No narrative dependency observations were reported.",
  );
  renderPlanningList(
    document.querySelector("#planning-assumptions"),
    plan.reasoning.assumptions,
    "No material assumptions were reported.",
  );
  renderPlanningList(
    document.querySelector("#planning-uncertainty"),
    plan.reasoning.uncertainty,
    "No uncertainty was reported.",
  );
  renderPlanningList(
    document.querySelector("#planning-evidence"),
    plan.reasoning.evidence,
    "No evidence was supplied.",
  );

  const formatTime = (value) => value ? new Date(value).toLocaleString() : "unavailable";
  document.querySelector("#planning-freshness").textContent =
    `Context generated ${formatTime(payload.contextGeneratedAt)} from board snapshot ` +
    `${formatTime(payload.boardSnapshotAt)}. This advice is not persisted and does not change board state.`;
}

async function suggestNextWork() {
  suggestNextWorkButton.disabled = true;
  suggestNextWorkButton.setAttribute("aria-busy", "true");
  planningStatus.textContent = "Asking the current agent for read-only planning advice…";
  planningResult.hidden = true;
  planningRawResponse.hidden = true;
  try {
    const response = await fetch("/api/planning/suggest", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentView: currentPlanningView() }),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (typeof payload.rawAnswer === "string") {
        planningRawResponseText.textContent = payload.rawAnswer;
        planningRawResponse.hidden = false;
      }
      throw new Error(typeof payload.error === "string" ? payload.error : "Planning request failed.");
    }
    renderPlanningResult(payload);
    planningStatus.textContent = "Planning advice received. Review the evidence and verify it against current project state.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown planning request error.";
    planningStatus.textContent = `Unable to obtain planning advice: ${message}`;
  } finally {
    suggestNextWorkButton.disabled = false;
    suggestNextWorkButton.removeAttribute("aria-busy");
  }
}

async function copyPlanningContext() {
  try {
    const context = await loadPlanningContext();
    if (!context) return;
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
    await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    planningContextStatus.textContent = "Fresh planning context copied as JSON.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown clipboard error.";
    planningContextStatus.textContent = `Unable to copy planning context: ${message}`;
  }
}

async function downloadPlanningContext() {
  try {
    const context = await loadPlanningContext();
    if (!context) return;
    const file = new Blob([JSON.stringify(context, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    const projectName = boardSnapshot?.config.projectName ?? "project";
    link.href = url;
    link.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-planning-context.json`;
    link.click();
    URL.revokeObjectURL(url);
    planningContextStatus.textContent = "Fresh planning context downloaded as JSON.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown download error.";
    planningContextStatus.textContent = `Unable to download planning context: ${message}`;
  }
}

document.querySelector("#refresh-planning-context").addEventListener("click", () => void loadPlanningContext());
document.querySelector("#copy-planning-context").addEventListener("click", () => void copyPlanningContext());
document.querySelector("#download-planning-context").addEventListener("click", () => void downloadPlanningContext());
planningContextDetails.addEventListener("toggle", () => {
  if (planningContextDetails.open) void loadPlanningContext();
});
suggestNextWorkButton.addEventListener("click", () => void suggestNextWork());

taskSearchInput.addEventListener("input", () => {
  viewState.search = taskSearchInput.value.trim();
  announceViewChange();
});
for (const control of filterControls) {
  control.addEventListener("toggle", () => {
    if (!control.open) return;
    for (const otherControl of filterControls) {
      if (otherControl !== control) otherControl.open = false;
    }
  });
  control.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !control.open) return;
    event.preventDefault();
    control.open = false;
    control.querySelector("summary").focus();
  });
  control.querySelector(".filter-options").addEventListener("change", (event) => {
    if (!closestElementFromEventTarget(event.target, 'input[type="checkbox"]')) return;
    const key = control.dataset.filter;
    viewState[key] = selectedFilterOptions(control).map(({ value }) => value);
    updateFilterSummary(control);
    renderActiveFilterChips();
    announceViewChange();
  });
}
activeFilterChips.addEventListener("click", (event) => {
  const chip = closestElementFromEventTarget(event.target, ".filter-chip");
  if (!chip) return;
  const control = filterControlsByKey.get(chip.dataset.filterKey);
  if (!control) return;
  const key = chip.dataset.filterKey;
  viewState[key] = viewState[key].filter((value) => value !== chip.dataset.filterValue);
  for (const input of control.querySelectorAll(".filter-options input")) {
    input.checked = viewState[key].includes(input.value);
  }
  updateFilterSummary(control);
  renderActiveFilterChips();
  announceViewChange();
  control.querySelector("summary").focus();
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  viewState.search = "";
  taskSearchInput.value = "";
  viewState.revealedTaskId = null;
  for (const control of filterControls) {
    const key = control.dataset.filter;
    viewState[key] = [];
    for (const input of control.querySelectorAll(".filter-options input")) input.checked = false;
    updateFilterSummary(control);
  }
  renderActiveFilterChips();
  graphController?.clearReveal();
  announceViewChange();
});
document.querySelector("#collapse-all").addEventListener("click", () => setAllCardsCollapsed(true));
document.querySelector("#expand-all").addEventListener("click", () => setAllCardsCollapsed(false));
dependencySuggestionsButton.addEventListener("click", () => {
  dependencySuggestionsExpanded = !dependencySuggestionsExpanded;
  renderDependencySuggestions();
});
dependencySuggestionsList.addEventListener("click", (event) => {
  const button = closestElementFromEventTarget(event.target, "button[data-suggestion-action]");
  if (!button) return;

  const suggestion = boardSnapshot?.dependencySuggestions.find(({ id }) => id === button.dataset.suggestionId);
  if (!suggestion) {
    dependencySuggestionsStatus.textContent = "This suggestion is no longer available. Refresh the board.";
    return;
  }
  if (button.dataset.suggestionAction === "dismiss") {
    dismissedSuggestionIds.add(suggestion.id);
    const persisted = persistDismissedSuggestionIds();
    renderDependencySuggestions();
    if (persisted) dependencySuggestionsStatus.textContent = "Suggestion dismissed in this browser.";
    return;
  }
  if (button.dataset.suggestionAction === "approve") {
    if (!claimPendingSuggestionApproval(pendingSuggestionApprovalIds, suggestion.id)) return;
    button.disabled = true;
    void approveDependencySuggestion(suggestion).finally(() => {
      pendingSuggestionApprovalIds.delete(suggestion.id);
      renderDependencySuggestions();
    });
  }
});
orderingHint.hidden = true;
createActionsElement.addEventListener("click", (event) => {
  const button = closestElementFromEventTarget(event.target, "[data-create]");
  if (button) openTaskDialog("create", button.dataset.create);
});
taskForm.addEventListener("submit", (event) => void submitTaskForm(event));
document.querySelector("#close-task-dialog").addEventListener("click", closeTaskDialog);
document.querySelector("#cancel-task").addEventListener("click", closeTaskDialog);
taskDialog.addEventListener("close", () => {
  dialogMode = null;
});
refreshButton.addEventListener("click", refreshBoard);
kanbanButton.addEventListener("click", () => setProjectView("kanban"));
graphButton.addEventListener("click", () => setProjectView("graph"));
document.querySelector("#graph-return").addEventListener("click", () => {
  setProjectView("kanban");
  kanbanButton.focus();
});
document.querySelector("#graph-retry").addEventListener("click", () => void renderGraph());
document.querySelector("#graph-whole-project").addEventListener("click", () => {
  void graphController?.resetScope();
});
void refreshBoard();
