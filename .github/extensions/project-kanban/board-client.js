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
let boardSnapshot = null;
let draggedTaskId = null;
let dialogMode = null;

function appendTag(parent, label, className = "") {
  const tag = document.createElement("span");
  tag.className = `card-tag ${className}`.trim();
  tag.textContent = label;
  parent.append(tag);
}

function displayDetails(task) {
  const source = boardSnapshot.config.sources.find(({ path }) => path === task.source.document);
  const details = [task.details];
  for (const field of source?.extraFields ?? []) {
    if (task[field.key]) details.push(`${field.label}: ${task[field.key]}`);
  }
  return details.filter(Boolean).join(" ");
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
  button.disabled = direction === "up" ? index === 0 : index === cardCount - 1;
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
    void moveTaskToIndex(task.id, select.value, Number.POSITIVE_INFINITY);
  });
  label.append(select);
  return label;
}

function createCardAction(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card-action-button ${className}`.trim();
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderCard(task, index, cardCount) {
  const item = document.createElement("li");
  item.className = "board-card-item";
  item.draggable = true;
  item.dataset.taskId = task.id;
  item.dataset.status = task.status;
  item.setAttribute("aria-label", `${task.title}, ${task.status}, ${task.priority} priority`);

  const article = document.createElement("article");
  article.className = "board-card";
  article.dataset.priority = task.priority;
  article.dataset.category = task.category;

  const topLine = document.createElement("div");
  topLine.className = "card-topline";
  const sourceConfig = boardSnapshot.config.sources.find(({ path }) => path === task.source.document);
  const priority = boardSnapshot.config.priorities.find(({ name }) => name === task.priority);
  appendTag(topLine, task.category, `category-tone-${sourceConfig?.categoryTone ?? "slate"}`);
  appendTag(topLine, task.priority, `priority-${priority?.tone ?? "low"}`);
  appendTag(topLine, task.area, "area-tag");
  article.append(topLine);

  const title = document.createElement("h3");
  title.textContent = task.title;
  article.append(title);

  const descriptionText = displayDetails(task);
  if (descriptionText) {
    const description = document.createElement("p");
    description.className = "card-details";
    description.textContent = descriptionText;
    article.append(description);
  }

  const source = document.createElement("span");
  source.className = "card-source";
  const reference = task.source.reference ? ` · ${task.source.reference}` : "";
  source.textContent = `${task.id} · ${task.source.document}${reference}`;
  article.append(source);

  const controls = document.createElement("div");
  controls.className = "card-controls";
  controls.append(
    createMoveButton(task, "up", index, cardCount),
    createMoveButton(task, "down", index, cardCount),
    createStatusSelect(task),
    createCardAction("Edit", "", () => openEditDialog(task)),
    createCardAction("Delete", "delete-button", () => void deleteTask(task)),
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
  document.title = payload.config.boardTitle;
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

  const fragment = document.createDocumentFragment();
  for (const column of payload.columns) {
    if (!column || typeof column.status !== "string" || !Array.isArray(column.cards)) {
      throw new Error("The board response contains an invalid column.");
    }

    const section = document.createElement("section");
    section.className = "board-column";
    section.dataset.status = column.status;
    section.setAttribute("aria-label", `${column.status}, ${column.cards.length} cards`);

    const heading = document.createElement("div");
    heading.className = "column-heading";
    const title = document.createElement("h2");
    title.textContent = column.status;
    const count = document.createElement("span");
    count.className = "column-count";
    count.textContent = String(column.cards.length);
    count.setAttribute("aria-label", `${column.cards.length} cards`);
    heading.append(title, count);
    section.append(heading);

    const list = document.createElement("ul");
    list.className = "cards";
    if (column.cards.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-column";
      empty.textContent = "Drop a task here to update its Status.";
      list.append(empty);
    } else {
      column.cards.forEach((task, index) => {
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
        list.append(renderCard(task, index, column.cards.length));
      });
    }
    section.append(list);
    fragment.append(section);
  }

  boardElement.replaceChildren(fragment);
  sourcesElement.textContent = payload.sources.join(" · ");
  statusElement.textContent = `${payload.tasks.length} tasks loaded. Drag to move; use card actions to edit, delete, or reorder.`;
}

function calculateOrder(taskId, status, requestedIndex) {
  const destination = boardSnapshot.tasks
    .filter((task) => task.status === status && task.id !== taskId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const index = Math.max(0, Math.min(destination.length, requestedIndex));
  const previous = destination[index - 1];
  const next = destination[index];

  if (!previous && !next) return 100;
  if (!previous) return next.order - 100;
  if (!next) return previous.order + 100;

  const order = previous.order + (next.order - previous.order) / 2;
  if (!Number.isFinite(order) || order === previous.order || order === next.order) {
    throw new Error("There is no Order value between these cards. Refresh and try a different position.");
  }
  return order;
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
    control.type = "text";
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
        maxLength: field.maxLength,
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
      await postTaskMutation(
        "/api/tasks/edit",
        { taskId: dialogMode.taskId, updates: values },
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

boardElement.addEventListener("dragstart", (event) => {
  const item = event.target.closest("[data-task-id]");
  if (!item || !event.dataTransfer) return;
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
  if (!column || !draggedTaskId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

boardElement.addEventListener("drop", (event) => {
  const column = event.target.closest(".board-column");
  if (!column || !draggedTaskId) return;
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
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      const targetIndex = cards.findIndex((task) => task.id === targetTask.id);
      const rect = target.getBoundingClientRect();
      insertionIndex = targetIndex + (event.clientY < rect.top + rect.height / 2 ? 0 : 1);
    }
  }
  void moveTaskToIndex(taskId, column.dataset.status, insertionIndex);
});

boardElement.addEventListener("dragenter", (event) => {
  const column = event.target.closest(".board-column");
  if (column) column.classList.add("is-drop-target");
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
    statusElement.textContent =
      error instanceof Error ? `Unable to load board: ${error.message}` : "Unable to load board.";
  } finally {
    refreshButton.disabled = false;
  }
}

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
