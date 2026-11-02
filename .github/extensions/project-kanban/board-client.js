import {
  calculateOrderValue,
  compareCanonicalTaskOrder,
  filterTasks,
  getCardPresentation,
  hasActiveTaskFilters,
  isManualOrderView,
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
const priorityFilter = document.querySelector("#priority-filter");
const categoryFilter = document.querySelector("#category-filter");
const areaFilter = document.querySelector("#area-filter");
const boardStatistics = document.querySelector("#board-statistics");
const lastUpdated = document.querySelector("#last-updated");
const revisionInfo = document.querySelector("#revision-info");
const orderingHint = document.querySelector("#ordering-hint");
let boardSnapshot = null;
let draggedTaskId = null;
let dialogMode = null;
const collapsedTaskIds = new Set();
const sortByStatus = new Map();

const viewState = {
  search: "",
  source: "",
  priority: "",
  category: "",
  area: "",
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
  const visibleCount = filterTasks(boardSnapshot.tasks, boardSnapshot.config, viewState).length;
  boardStatistics.textContent = `${visibleCount} of ${boardSnapshot.tasks.length} tasks shown`;
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
  const priorities = boardSnapshot.config.priorities.map(({ name }) => ({ value: name, label: name }));
  const categories = [...new Set(boardSnapshot.tasks.map(({ category }) => category))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
  const areas = [...new Set(boardSnapshot.tasks.map(({ area }) => area))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));

  viewState.source = setSelectOptions(sourceFilter, "All sources", sources, viewState.source);
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

function renderCard(task, index, cardCount) {
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
  item.setAttribute("aria-label", `${task.title}, ${task.status}, ${task.priority} priority`);

  const article = document.createElement("article");
  article.className = "board-card";
  article.dataset.priority = task.priority;
  article.dataset.category = task.category;
  article.dataset.sourceType = sourceForTask(task)?.key ?? "";

  const topLine = document.createElement("div");
  topLine.className = "card-topline";
  const sourceConfig = sourceForTask(task);
  const priority = boardSnapshot.config.priorities.find(({ name }) => name === task.priority);
  article.dataset.priorityTone = priority?.tone ?? "low";
  appendTag(topLine, task.category, `category-tone-${sourceConfig?.categoryTone ?? "slate"}`);
  appendTag(topLine, task.priority, `priority-${priority?.tone ?? "low"}`);
  appendTag(topLine, task.area, "area-tag");
  appendTag(topLine, task.status, "status-tag");
  for (const { label, value } of presentation.lifecycleDates) {
    appendTag(topLine, `${label}: ${value}`, "lifecycle-date-tag");
  }
  article.append(topLine);

  const title = document.createElement("h3");
  title.textContent = task.title;
  article.append(title);

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

  const source = document.createElement("span");
  source.className = "card-source";
  const reference = task.source.reference ? ` · ${task.source.reference}` : "";
  source.textContent = `${presentation.showSourceId ? `${task.id} · ` : ""}${task.source.document}${reference}`;
  article.append(source);

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
}

function renderColumns(columns) {
  const fragment = document.createDocumentFragment();
  for (const column of columns) {
    if (!column || typeof column.status !== "string" || !Array.isArray(column.cards)) {
      throw new Error("The board response contains an invalid column.");
    }

    const visibleCards = sortColumnCards(filterTasks(column.cards, boardSnapshot.config, viewState), column.status);
    const section = document.createElement("section");
    section.className = "board-column";
    section.dataset.status = column.status;
    section.setAttribute("aria-label", `${column.status}, ${visibleCards.length} of ${column.cards.length} cards shown`);

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
    count.textContent = hasActiveFilters() ? `${visibleCards.length}/${column.cards.length}` : String(column.cards.length);
    count.setAttribute("aria-label", `${visibleCards.length} of ${column.cards.length} cards shown`);
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
      ["type", "Type"],
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
        list.append(renderCard(task, index, visibleCards.length));
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
  statusElement.textContent = `${visibleCount} of ${boardSnapshot.tasks.length} tasks match the current view.`;
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
      choices: boardSnapshot.config.priorities.map(({ name }) => name),
    }],
    ["status", "Status", task?.status ?? boardSnapshot.config.defaultStatus, {
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
        multiline: field.type === "textarea",
        fullWidth: field.type === "textarea",
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
  [priorityFilter, "priority"],
  [categoryFilter, "category"],
  [areaFilter, "area"],
]) {
  select.addEventListener("change", () => {
    viewState[key] = select.value;
    announceViewChange();
  });
}
document.querySelector("#clear-filters").addEventListener("click", () => {
  viewState.search = "";
  taskSearchInput.value = "";
  for (const key of ["source", "priority", "category", "area"]) viewState[key] = "";
  for (const select of [sourceFilter, priorityFilter, categoryFilter, areaFilter]) select.value = "";
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
void refreshBoard();
