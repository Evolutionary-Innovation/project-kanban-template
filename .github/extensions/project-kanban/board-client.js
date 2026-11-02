import {
  calculateOrderValue,
  compareCanonicalTaskOrder,
  filterTasks,
  getCardPresentation,
  hasActiveTaskFilters,
  isManualOrderView,
  matchesTaskView,
  sortTasks,
} from "./board-view.mjs";

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
const sourceFilter = document.querySelector("#source-filter");
const statusFilter = document.querySelector("#status-filter");
const priorityFilter = document.querySelector("#priority-filter");
const categoryFilter = document.querySelector("#category-filter");
const areaFilter = document.querySelector("#area-filter");
const dependencyFilter = document.querySelector("#dependency-filter");
const boardStatistics = document.querySelector("#board-statistics");
const lastUpdated = document.querySelector("#last-updated");
const revisionInfo = document.querySelector("#revision-info");
const orderingHint = document.querySelector("#ordering-hint");
const graphPanel = document.querySelector("#graph-panel");
const kanbanButton = document.querySelector("#show-kanban");
const graphButton = document.querySelector("#show-graph");
const viewToolbar = document.querySelector(".view-toolbar");
let activeView = "kanban";
let graphController = null;
let graphModuleAttempt = 0;
let graphViewGeneration = 0;
let pendingGraphTaskId = null;
let boardLoadError = "";
let boardSnapshot = null;
let draggedTaskId = null;
let dialogMode = null;
const collapsedTaskIds = new Set();
const sortByStatus = new Map();

const viewState = {
  search: "",
  source: "",
  status: "",
  priority: "",
  category: "",
  area: "",
  dependency: "",
};

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
  if (activeView === "graph") {
    const matchingCount = filterTasks(boardSnapshot.tasks, boardSnapshot.config, viewState).length;
    boardStatistics.textContent = `${matchingCount} of ${boardSnapshot.tasks.length} tasks match the shared filters`;
    orderingHint.hidden = true;
    return;
  }
  const visibleCount = filterTasks(boardSnapshot.tasks, boardSnapshot.config, viewState).length;
  const revealedTask = viewState.revealedTaskId &&
    boardSnapshot.tasks.find(({ id }) => id === viewState.revealedTaskId);
  const revealNote = revealedTask && !matchesTaskView(revealedTask, boardSnapshot.config, viewState)
    ? `; 1 temporarily shown outside filters (${revealedTask.id})`
    : "";
  boardStatistics.textContent = `${visibleCount} of ${boardSnapshot.tasks.length} tasks match${revealNote}`;
  orderingHint.hidden = !hasActiveFilters() && !boardSnapshot.config.statuses.some(
    (status) => (sortByStatus.get(status) ?? "manual") !== "manual",
  );
}

function setSelectOptions(select, placeholder, values, selectedValue) {
  const options = values.map(({ value, label }) => ({ value, label }));
  const validSelection = options.some(({ value }) => value === selectedValue) ? selectedValue : "";
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = placeholder;
  fragment.append(allOption);
  for (const { value, label } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = validSelection;
  return validSelection;
}

function refreshFilterOptions() {
  const sources = boardSnapshot.config.sources.map(({ key, label }) => ({ value: key, label }));
  const statuses = boardSnapshot.config.statuses.map((value) => ({ value, label: value }));
  const priorities = boardSnapshot.config.priorities.map(({ name }) => ({ value: name, label: name }));
  const categories = [...new Set(boardSnapshot.tasks.map(({ category }) => category))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
  const areas = [...new Set(boardSnapshot.tasks.map(({ area }) => area))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));

  viewState.source = setSelectOptions(sourceFilter, "All sources", sources, viewState.source);
  viewState.status = setSelectOptions(statusFilter, "All statuses", statuses, viewState.status);
  viewState.priority = setSelectOptions(priorityFilter, "All priorities", priorities, viewState.priority);
  viewState.category = setSelectOptions(categoryFilter, "All categories", categories, viewState.category);
  viewState.area = setSelectOptions(areaFilter, "All areas", areas, viewState.area);
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
      sortOptions.push(["completionDate", "Completion date"]);
    }
    if (boardSnapshot.config.sources.some(({ extraFields }) => extraFields.some(({ key }) => key === "createdDate"))) {
      sortOptions.push(["createdDate", "Created date"]);
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
  const label = document.createElement("label");
  label.className = `task-field${options.fullWidth ? " full-width" : ""}`;
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
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.required) control.required = true;
  if (options.maxLength) control.maxLength = options.maxLength;
  label.append(control);
  return label;
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

  const fields = [
    ["title", "Title", task?.title ?? "", { required: true, maxLength: 200 }],
    ["area", "Area", task?.area ?? "", { required: true, maxLength: 100 }],
    ...(mode === "edit" ? [["category", "Category", task.category, { required: true, maxLength: 100 }]] : []),
    ["priority", "Priority", task?.priority ?? boardSnapshot.config.priorities[0].name, {
      required: true,
      choices: boardSnapshot.config.priorities.map(({ name }) => name),
    }],
    ["status", "Status", task?.status ?? boardSnapshot.config.defaultStatus, {
      required: true,
      choices: boardSnapshot.config.statuses,
    }],
    ["details", "Details", task?.details ?? "", { multiline: true, maxLength: 5000, fullWidth: true }],
    ...source.extraFields.map((field) => [
      field.key,
      field.label,
      task?.[field.key] ?? "",
      {
        required: field.required,
        maxLength: field.type === "date" ? undefined : field.maxLength,
        inputType: field.type === "date" ? "date" : undefined,
        choices: field.choices,
        placeholder: field.type === "task-ids" ? "RM-019, TD-03" : undefined,
        multiline: field.type === "textarea",
        fullWidth: field.type === "textarea" || field.type === "task-ids",
      },
    ]),
  ];

  for (const [name, label, value, options] of fields) {
    taskFormFields.append(createField(name, label, value, options));
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
  const item = event.target.closest("[data-task-id]");
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
  const column = event.target.closest(".board-column");
  if (!column || !draggedTaskId || !canReorderColumn(column.dataset.status)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

boardElement.addEventListener("drop", (event) => {
  const column = event.target.closest(".board-column");
  const draggedTask = boardSnapshot?.tasks.find((task) => task.id === draggedTaskId);
  if (
    !column ||
    !draggedTaskId ||
    !draggedTask ||
    !canReorderColumn(draggedTask.status) ||
    !canReorderColumn(column.dataset.status)
  ) return;
  event.preventDefault();

  const target = event.target.closest("[data-task-id]");
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
  const column = event.target.closest(".board-column");
  if (column && canReorderColumn(column.dataset.status)) column.classList.add("is-drop-target");
});

boardElement.addEventListener("dragleave", (event) => {
  const column = event.target.closest(".board-column");
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

taskSearchInput.addEventListener("input", () => {
  viewState.search = taskSearchInput.value.trim();
  announceViewChange();
});
for (const [select, key] of [
  [sourceFilter, "source"],
  [statusFilter, "status"],
  [priorityFilter, "priority"],
  [categoryFilter, "category"],
  [areaFilter, "area"],
  [dependencyFilter, "dependency"],
]) {
  select.addEventListener("change", () => {
    viewState[key] = select.value;
    announceViewChange();
  });
}
document.querySelector("#clear-filters").addEventListener("click", () => {
  viewState.search = "";
  taskSearchInput.value = "";
  viewState.revealedTaskId = null;
  for (const key of ["source", "status", "priority", "category", "area", "dependency"]) viewState[key] = "";
  for (const select of [sourceFilter, statusFilter, priorityFilter, categoryFilter, areaFilter, dependencyFilter]) {
    select.value = "";
  }
  graphController?.clearReveal();
  announceViewChange();
});
document.querySelector("#collapse-all").addEventListener("click", () => setAllCardsCollapsed(true));
document.querySelector("#expand-all").addEventListener("click", () => setAllCardsCollapsed(false));
orderingHint.hidden = true;
createActionsElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-create]");
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
