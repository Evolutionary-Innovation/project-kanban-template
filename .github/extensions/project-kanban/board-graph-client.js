import {
  createGraphView,
  getDownstreamTaskIds,
  graphLayoutKey,
  graphTitleLines,
  projectGraphView,
} from "./board-graph.mjs";

const svgNamespace = "http://www.w3.org/2000/svg";

export function invokeGraphTaskEdit(snapshot, taskId, onEditTask) {
  const task = snapshot?.tasks?.find(({ id }) => id === taskId);
  if (!task || typeof onEditTask !== "function") return false;
  onEditTask(task);
  return true;
}

function svgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

export function createGraphController(root, { onEditTask, onShowOnBoard } = {}) {
  const viewport = root.querySelector("#graph-viewport");
  const diagram = root.querySelector("#graph-diagram");
  const inspector = root.querySelector("#graph-inspector");
  const taskList = root.querySelector("#graph-task-list");
  const warnings = root.querySelector("#graph-warnings");
  const message = root.querySelector("#graph-message");
  const workflowSummary = root.querySelector("#graph-workflow-summary");
  const criticalChain = root.querySelector("#graph-critical-chain");
  const wholeProjectButton = root.querySelector("#graph-whole-project");
  const focusNeighborhoodButton = root.querySelector("#graph-focus-neighbourhood");
  const expandUpstreamButton = root.querySelector("#graph-expand-upstream");
  const expandDownstreamButton = root.querySelector("#graph-expand-downstream");
  const showOnBoardButton = root.querySelector("#graph-show-on-board");
  const editTaskButton = root.querySelector("#graph-edit-task");
  const completedToggle = root.querySelector("#graph-completed-toggle");
  const groupBySelect = root.querySelector("#graph-group-by");
  const contextMenu = root.querySelector("#graph-context-menu");
  const errorPanel = root.querySelector("#graph-error");
  const errorMessage = root.querySelector("#graph-error-message");
  const zoomLabel = root.querySelector("#graph-zoom");
  const zoomInput = root.querySelector("#graph-zoom-input");
  const viewportControls = [...root.querySelectorAll("[data-graph-zoom]")];
  let generation = 0;
  let model = null;
  let positions = null;
  let layoutKey = "";
  let selectedId = null;
  let focusedId = null;
  let zoom = 1;
  let showCompletedWork = true;
  let groupBy = "none";
  let diagramAvailable = false;
  let layoutWorker = null;
  let rejectLayout = null;
  const nodeElements = new Map();
  let latestSnapshot = null;
  let latestCriteria = {};
  let pointerGesture = null;
  let zoomSelectionBox = null;
  let suppressNextNodeClick = false;
  let suppressNodeClickTimer = 0;
  let contextMenuTaskId = null;
  let contextMenuInvoker = null;
  const scope = {
    focusId: null,
    expandUpstream: false,
    expandDownstream: false,
    revealedTaskId: null,
  };

  function stopLayout() {
    layoutWorker?.terminate();
    layoutWorker = null;
    rejectLayout?.(new Error("Dependency layout cancelled."));
    rejectLayout = null;
  }

  function calculateLayout(view, grouping) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./board-graph-worker.mjs", import.meta.url), { type: "module" });
      layoutWorker = worker;
      rejectLayout = reject;
      function finish(error, result) {
        worker.terminate();
        if (layoutWorker === worker) {
          layoutWorker = null;
          rejectLayout = null;
        }
        if (error) reject(error);
        else resolve(result);
      }
      worker.addEventListener("message", ({ data }) => {
        if (typeof data.error === "string") finish(new Error(data.error));
        else if (!Array.isArray(data.layout?.nodes) || !Array.isArray(data.layout?.edges)) {
          finish(new Error("The dependency layout worker returned an invalid result."));
        } else finish(null, data.layout);
      });
      worker.addEventListener("error", (event) => {
        finish(new Error(event.message || "The dependency layout worker could not be loaded."));
      });
      worker.postMessage({
        nodes: view.nodes.map(({ id, area, category }) => ({ id, area, category })),
        edges: view.edges.map(({ source, target }) => ({ source, target })),
        groupBy: grouping,
      });
    });
  }

  function updateToolbar() {
    const graphAvailable = diagramAvailable && Boolean(model?.nodes.length);
    const viewAvailable = diagramAvailable && Boolean(latestSnapshot);
    for (const control of viewportControls) control.disabled = !graphAvailable;
    zoomInput.disabled = !graphAvailable;
    groupBySelect.disabled = !viewAvailable;
    completedToggle.disabled = !viewAvailable;
    completedToggle.textContent = showCompletedWork ? "Hide completed work" : "Show completed work";
    groupBySelect.value = groupBy;

    const node = model?.nodes.find(({ id }) => id === selectedId);
    const sourceTask = node && !node.unresolved
      ? latestSnapshot?.tasks.find(({ id }) => id === node.id)
      : null;
    const hasSelectedTask = graphAvailable && Boolean(sourceTask);
    focusNeighborhoodButton.disabled = !hasSelectedTask;
    showOnBoardButton.disabled = !hasSelectedTask;
    editTaskButton.disabled = !hasSelectedTask;
    wholeProjectButton.disabled = !graphAvailable || !scope.focusId;

    const expandTaskId = scope.focusId ?? (hasSelectedTask ? node.id : null);
    expandUpstreamButton.disabled = !expandTaskId || !graphAvailable || Boolean(scope.expandUpstream);
    expandDownstreamButton.disabled = !expandTaskId || !graphAvailable || Boolean(scope.expandDownstream);
    expandUpstreamButton.textContent = scope.expandUpstream
      ? "Upstream path expanded"
      : "Expand upstream path";
    expandDownstreamButton.textContent = scope.expandDownstream
      ? "Downstream impact expanded"
      : "Expand downstream impact";
  }

  function nodeLabel(node) {
    const workflowLabel = {
      ready: "Dependency-ready, advisory",
      blocked: "Blocked by dependencies",
      review: "Cycle needs review",
      complete: "Complete",
      unresolved: "Unresolved dependency reference",
    }[node.workflowState];
    return [
      node.title, node.status, node.priority, node.category, node.area,
      workflowLabel,
      ...(node.isCriticalPath ? ["On the longest unweighted dependency chain"] : []),
      ...(node.matchKind === "context" ? ["Dependency context outside active filters"] : []),
      ...(node.matchKind === "revealed" ? ["Temporarily revealed outside active filters"] : []),
      ...(node.blockedBy.length ? [`Blocked by ${node.blockedBy.join(", ")}`] : []),
      ...(node.hasCycle ? ["Dependency cycle"] : []),
    ].filter(Boolean).join(". ");
  }

  function relationButton(id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-link";
    button.textContent = model.nodes.find((node) => node.id === id)?.title ?? id;
    button.addEventListener("click", () => selectNode(id, true));
    return button;
  }

  function relationshipList(title, ids) {
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading);
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.textContent = "None";
      section.append(empty);
    } else {
      const list = document.createElement("ul");
      for (const id of ids) {
        const item = document.createElement("li");
        item.append(relationButton(id));
        list.append(item);
      }
      section.append(list);
    }
    return section;
  }

  function closeContextMenu(restoreFocus = false) {
    if (contextMenu.hidden) return;
    const invoker = contextMenuInvoker;
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
    contextMenuTaskId = null;
    contextMenuInvoker = null;
    if (restoreFocus && invoker?.isConnected) invoker.focus({ preventScroll: true });
  }

  function addContextMenuSeparator() {
    const separator = document.createElement("div");
    separator.setAttribute("role", "separator");
    contextMenu.append(separator);
  }

  function addContextMenuAction(label, handler, { disabled = false, restoreFocus = true } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-context-menu-item";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", () => {
      const taskId = contextMenuTaskId;
      closeContextMenu(false);
      if (restoreFocus && taskId) nodeElements.get(taskId)?.focus({ preventScroll: true });
      handler(taskId);
    });
    contextMenu.append(button);
  }

  function focusInspectorSection(taskId, selector) {
    selectNode(taskId, true);
    const section = inspector.querySelector(selector) ??
      inspector.querySelector(".graph-inspector-relationships") ??
      inspector.querySelector("h3");
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function openContextMenu(taskId, clientX, clientY, invoker = nodeElements.get(taskId)) {
    const node = model?.nodes.find((candidate) => candidate.id === taskId);
    if (!node) return;
    if (selectedId !== taskId) selectNode(taskId);

    contextMenu.replaceChildren();
    contextMenuTaskId = taskId;
    contextMenuInvoker = invoker?.isConnected ? invoker : nodeElements.get(taskId);
    const sourceTask = latestSnapshot?.tasks.find((task) => task.id === taskId);
    addContextMenuAction("Edit Task", () => {
      invokeGraphTaskEdit(latestSnapshot, taskId, onEditTask);
    }, { disabled: !sourceTask, restoreFocus: false });
    addContextMenuAction("Show On Board", () => {
      if (sourceTask) onShowOnBoard?.(taskId);
    }, { disabled: !sourceTask, restoreFocus: false });

    addContextMenuSeparator();
    addContextMenuAction("Focus Neighbourhood", () => focusNeighborhood(taskId), { disabled: !sourceTask });
    addContextMenuAction("Expand Upstream Path", () => expandFocus(taskId, "upstream"), { disabled: !sourceTask });
    addContextMenuAction("Expand Downstream Impact", () => expandFocus(taskId, "downstream"), { disabled: !sourceTask });

    addContextMenuSeparator();
    addContextMenuAction("Reset Zoom", () => setZoom(1, true));
    addContextMenuAction("Fit View", fit);
    addContextMenuAction("Whole Project", () => void resetScope(), { disabled: !scope.focusId });

    addContextMenuSeparator();
    addContextMenuAction("View Relationships", () =>
      focusInspectorSection(taskId, ".graph-inspector-relationships"));
    addContextMenuAction("View Dependency Details", () =>
      focusInspectorSection(taskId, ".graph-inspector-dependency-details"));

    contextMenu.hidden = false;
    const nodeRect = contextMenuInvoker?.getBoundingClientRect();
    const left = Number.isFinite(clientX) ? clientX : nodeRect?.left ?? 8;
    const top = Number.isFinite(clientY) ? clientY : nodeRect?.bottom ?? 8;
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - contextMenu.offsetWidth - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - contextMenu.offsetHeight - 8))}px`;
    contextMenu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  }

  contextMenu.addEventListener("keydown", (event) => {
    const items = [...contextMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = (index + 1 + items.length) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      closeContextMenu(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeContextMenu(true);
    }
    if (nextIndex !== null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu(false);
  });

  function renderInspector() {
    inspector.replaceChildren();
    const heading = document.createElement("h3");
    const node = model?.nodes.find(({ id }) => id === selectedId);
    heading.textContent = node?.title ?? "Inspect a task";
    inspector.append(heading);
    if (!node) {
      const hint = document.createElement("p");
      hint.textContent = "Select a node or a task in the relationship list to inspect it. Editing remains on the Kanban board.";
      inspector.append(hint);
      return;
    }

    const downstreamIds = node.unresolved
      ? []
      : getDownstreamTaskIds(latestSnapshot.dependencyGraph, node.id);
    const metadata = document.createElement("dl");
    metadata.className = "graph-inspector-metadata";
    const workflowLabels = {
      ready: "Dependency-ready (advisory)",
      blocked: "Blocked by dependencies",
      review: "Cycle needs review",
      complete: "Complete",
      unresolved: "Unresolved reference",
    };
    for (const [label, value] of [
      ["Status", node.status], ["Priority", node.priority], ["Category", node.category],
      ["Area", node.area], ["Execution Type", node.executionType],
      ["Dependency readiness", workflowLabels[node.workflowState]],
      ...(!node.unresolved
        ? [["Downstream impact", downstreamIds.length
          ? `${downstreamIds.length} unique dependent task${downstreamIds.length === 1 ? "" : "s"}`
          : "No dependent tasks"]]
        : []),
      ...node.dates.map(({ label, value }) => [label, value]),
    ]) {
      if (!value) continue;
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      metadata.append(term, detail);
    }
    inspector.append(metadata);

    const contentGrid = document.createElement("div");
    contentGrid.className = "graph-inspector-content-grid";

    const taskDetails = document.createElement("section");
    taskDetails.className = "graph-inspector-task-details";
    const taskDetailsHeading = document.createElement("h4");
    taskDetailsHeading.textContent = "Task details";
    taskDetails.append(taskDetailsHeading);
    if (node.details.length) {
      for (const { label, value } of node.details) {
        const detailSection = document.createElement("section");
        const title = document.createElement("h5");
        const content = document.createElement("p");
        title.textContent = label;
        content.textContent = value;
        detailSection.append(title, content);
        taskDetails.append(detailSection);
      }
    } else {
      const emptyDetails = document.createElement("p");
      emptyDetails.textContent = "No additional task details.";
      taskDetails.append(emptyDetails);
    }

    const dependencyDetails = document.createElement("section");
    dependencyDetails.className = "graph-inspector-dependency-details";
    dependencyDetails.tabIndex = -1;
    const dependencyHeading = document.createElement("h4");
    dependencyHeading.textContent = "Dependencies";
    dependencyDetails.append(dependencyHeading);

    if (node.hasCycle || node.unresolved) {
      const warning = document.createElement("p");
      warning.className = "graph-warning-text";
      warning.textContent = node.unresolved
        ? "This ID is referenced but no task exists. It cannot be edited."
        : "Dependency cycle detected. Review this task's prerequisite links on the board.";
      dependencyDetails.append(warning);
    }
    const prerequisites = model.edges.filter(({ target }) => target === node.id).map(({ source }) => source);
    const dependents = model.edges.filter(({ source }) => source === node.id).map(({ target }) => target);
    const relationships = document.createElement("div");
    relationships.className = "graph-inspector-relationships";
    relationships.tabIndex = -1;
    relationships.append(
      relationshipList("Depends On", prerequisites),
      relationshipList("Blocked By", node.blockedBy),
      relationshipList(node.unresolved ? "Referenced by" : "Direct dependents", dependents),
    );
    dependencyDetails.append(relationships);
    if (!showCompletedWork && !node.unresolved) {
      const completionStatus = latestSnapshot.config.completionStatus;
      const hiddenRelationships = latestSnapshot.dependencyGraph.edges.flatMap(({ source, target }) => {
        const sourceTask = latestSnapshot.tasks.find(({ id }) => id === source);
        const targetTask = latestSnapshot.tasks.find(({ id }) => id === target);
        if (source === node.id && targetTask?.status === completionStatus) return [target];
        if (target === node.id && sourceTask?.status === completionStatus) return [source];
        return [];
      });
      if (hiddenRelationships.length) {
        const hiddenContext = document.createElement("section");
        hiddenContext.className = "graph-inspector-hidden-context";
        hiddenContext.tabIndex = -1;
        const title = document.createElement("h4");
        const content = document.createElement("p");
        title.textContent = "Completed relationships hidden from diagram";
        content.textContent = `${[...new Set(hiddenRelationships)].join(", ")}. Show completed work to see the full dependency paths.`;
        hiddenContext.append(title, content);
        dependencyDetails.append(hiddenContext);
      }
    }

    if (node.isCriticalPath) {
      const pathNote = document.createElement("p");
      pathNote.textContent = "Part of the longest unweighted dependency chain; this is not a duration-based critical path.";
      dependencyDetails.append(pathNote);
    }

    contentGrid.append(taskDetails, dependencyDetails);
    inspector.append(contentGrid);
  }

  function selectNode(id, focus = false) {
    const node = model?.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    selectedId = id;
    focusedId = id;
    for (const [nodeId, element] of nodeElements) {
      element.setAttribute("aria-pressed", String(nodeId === id));
      element.setAttribute("tabindex", nodeId === id ? "0" : "-1");
    }
    renderInspector();
    updateToolbar();
    message.textContent = `Selected ${nodeLabel(node)}`;
    if (focus) {
      nodeElements.get(id)?.focus({ preventScroll: true });
      nodeElements.get(id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }

  function setZoom(value, resetScroll = false) {
    if (!positions?.nodes.length) return;
    zoom = Math.max(0.01, Math.min(2, value));
    diagram.setAttribute("width", String(Math.ceil(positions.width * zoom)));
    diagram.setAttribute("height", String(Math.ceil(positions.height * zoom)));
    zoomLabel.textContent = `${(zoom * 100).toFixed(zoom < 0.01 ? 1 : 0)}%`;
    zoomInput.value = String(Math.round(zoom * 100));
    if (resetScroll) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }

  function fit() {
    if (positions?.nodes.length) {
      setZoom(Math.min(
        (viewport.clientWidth - 16) / positions.width,
        (viewport.clientHeight - 16) / positions.height,
        1,
      ), true);
    }
  }

  function focusNeighborhood(taskId) {
    const node = model?.nodes.find((candidate) => candidate.id === taskId);
    if (!node || node.unresolved) return;
    scope.focusId = taskId;
    scope.expandUpstream = false;
    scope.expandDownstream = false;
    scope.revealedTaskId = null;
    selectNode(taskId, true);
    void render(latestSnapshot, latestCriteria);
  }

  function expandFocus(taskId, direction) {
    const node = model?.nodes.find((candidate) => candidate.id === taskId);
    if (!node || node.unresolved) return;
    if (scope.focusId !== taskId) {
      scope.focusId = taskId;
      scope.expandUpstream = false;
      scope.expandDownstream = false;
      scope.revealedTaskId = null;
    }
    if (direction === "upstream") scope.expandUpstream = true;
    else scope.expandDownstream = true;
    selectNode(taskId, true);
    void render(latestSnapshot, latestCriteria);
  }

  async function resetScope() {
    scope.focusId = null;
    scope.expandUpstream = false;
    scope.expandDownstream = false;
    scope.revealedTaskId = null;
    await render(latestSnapshot, latestCriteria);
  }

  function graphBounds() {
    const viewportRect = viewport.getBoundingClientRect();
    const diagramRect = diagram.getBoundingClientRect();
    const bounds = {
      left: Math.max(viewportRect.left + viewport.clientLeft, diagramRect.left),
      top: Math.max(viewportRect.top + viewport.clientTop, diagramRect.top),
      right: Math.min(viewportRect.left + viewport.clientLeft + viewport.clientWidth, diagramRect.right),
      bottom: Math.min(viewportRect.top + viewport.clientTop + viewport.clientHeight, diagramRect.bottom),
    };
    return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : null;
  }

  function pointWithinGraph(event) {
    const bounds = graphBounds();
    if (!bounds) return null;
    return {
      x: Math.max(bounds.left, Math.min(event.clientX, bounds.right)),
      y: Math.max(bounds.top, Math.min(event.clientY, bounds.bottom)),
    };
  }

  function updateZoomSelection(event) {
    if (!pointerGesture?.startPoint || !zoomSelectionBox) return;
    const endPoint = pointWithinGraph(event);
    if (!endPoint) return;
    const viewportRect = viewport.getBoundingClientRect();
    const left = Math.min(pointerGesture.startPoint.x, endPoint.x);
    const top = Math.min(pointerGesture.startPoint.y, endPoint.y);
    const width = Math.abs(pointerGesture.startPoint.x - endPoint.x);
    const height = Math.abs(pointerGesture.startPoint.y - endPoint.y);
    zoomSelectionBox.style.left = `${viewport.scrollLeft + left - viewportRect.left - viewport.clientLeft}px`;
    zoomSelectionBox.style.top = `${viewport.scrollTop + top - viewportRect.top - viewport.clientTop}px`;
    zoomSelectionBox.style.width = `${width}px`;
    zoomSelectionBox.style.height = `${height}px`;
  }

  function zoomToSelection() {
    if (!zoomSelectionBox) return;
    const bounds = zoomSelectionBox.getBoundingClientRect();
    const diagramRect = diagram.getBoundingClientRect();
    const width = bounds.width / zoom;
    const height = bounds.height / zoom;
    if (width < 12 || height < 12) return;
    const nextZoom = Math.min(
      2,
      (viewport.clientWidth - 40) / width,
      (viewport.clientHeight - 40) / height,
    );
    if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const worldX = (centerX - diagramRect.left) / zoom;
    const worldY = (centerY - diagramRect.top) / zoom;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, worldX * zoom - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, worldY * zoom - viewport.clientHeight / 2);
    });
  }

  function suppressDraggedNodeClick() {
    suppressNextNodeClick = true;
    window.clearTimeout(suppressNodeClickTimer);
    suppressNodeClickTimer = window.setTimeout(() => {
      suppressNextNodeClick = false;
    }, 0);
  }

  function finishPointerGesture(event, cancelled = false) {
    const gesture = pointerGesture;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    if (gesture.mode === "zoom" && !cancelled) zoomToSelection();
    if (gesture.moved && gesture.nodeId) suppressDraggedNodeClick();
    pointerGesture = null;
    zoomSelectionBox?.remove();
    zoomSelectionBox = null;
    viewport.classList.remove("is-panning", "is-zoom-selecting");
    if (viewport.hasPointerCapture?.(gesture.pointerId)) viewport.releasePointerCapture(gesture.pointerId);
  }

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType !== "mouse" || pointerGesture) return;
    const target = event.target instanceof Element ? event.target.closest(".graph-node") : null;
    const startPoint = event.shiftKey ? pointWithinGraph(event) : null;
    if (event.shiftKey && !startPoint) return;
    pointerGesture = {
      pointerId: event.pointerId,
      nodeId: target?.dataset.taskId ?? null,
      startX: event.clientX,
      startY: event.clientY,
      startPoint,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      mode: event.shiftKey ? "pending-zoom" : "pending-pan",
      moved: false,
    };
  });

  window.addEventListener("pointermove", (event) => {
    const gesture = pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) < 5) return;
    gesture.moved = true;
    if (gesture.mode === "pending-zoom") {
      gesture.mode = "zoom";
      zoomSelectionBox = document.createElement("div");
      zoomSelectionBox.className = "graph-zoom-selection";
      viewport.append(zoomSelectionBox);
      viewport.classList.add("is-zoom-selecting");
    } else if (gesture.mode === "pending-pan") {
      gesture.mode = "pan";
      viewport.classList.add("is-panning");
    }
    if (viewport.setPointerCapture && !viewport.hasPointerCapture(gesture.pointerId)) {
      viewport.setPointerCapture(gesture.pointerId);
    }
    event.preventDefault();
    if (gesture.mode === "pan") {
      viewport.scrollLeft = gesture.startScrollLeft - deltaX;
      viewport.scrollTop = gesture.startScrollTop - deltaY;
    } else updateZoomSelection(event);
  }, { passive: false });

  window.addEventListener("pointerup", (event) => finishPointerGesture(event));
  window.addEventListener("pointercancel", (event) => finishPointerGesture(event, true));

  viewport.addEventListener("wheel", (event) => {
    if (!event.shiftKey || !positions?.nodes.length) return;
    event.preventDefault();
    const diagramRect = diagram.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const worldX = Math.max(0, Math.min(positions.width, (event.clientX - diagramRect.left) / zoom));
    const worldY = Math.max(0, Math.min(positions.height, (event.clientY - diagramRect.top) / zoom));
    const delta = event.deltaY || event.deltaX;
    const factor = Math.exp(Math.max(-0.5, Math.min(0.5, -delta * 0.002)));
    setZoom(zoom * factor);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, worldX * zoom - (event.clientX - viewportRect.left - viewport.clientLeft));
      viewport.scrollTop = Math.max(0, worldY * zoom - (event.clientY - viewportRect.top - viewport.clientTop));
    });
  }, { passive: false });

  viewport.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest(".graph-node") : null;
    if (target) openContextMenu(target.dataset.taskId, event.clientX, event.clientY, target);
  });

  function drawDiagram() {
    diagram.replaceChildren();
    nodeElements.clear();
    diagram.setAttribute("viewBox", `0 0 ${positions.width || 1} ${positions.height || 1}`);
    const defs = svgElement("defs");
    const marker = svgElement("marker", {
      id: "dependency-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse",
    });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "context-stroke" }));
    defs.append(marker);
    diagram.append(defs);
    for (const group of positions.groups ?? []) {
      const groupElement = svgElement("g", { class: "graph-group" });
      groupElement.append(svgElement("rect", {
        x: group.x, y: group.y, width: group.width, height: group.height, rx: 12,
      }));
      const title = `${groupBy === "area" ? "Area" : "Category"}: ${group.label}`;
      const label = svgElement("text", { x: group.x + 12, y: group.y + 22, class: "graph-group-label" }, title);
      groupElement.append(label);
      diagram.append(groupElement);
    }
    const edgePositions = new Map(positions.edges.map((edge) => [JSON.stringify([edge.source, edge.target]), edge]));
    for (const edge of model.edges) {
      const layoutEdge = edgePositions.get(JSON.stringify([edge.source, edge.target]));
      const path = svgElement("path", {
        d: layoutEdge.points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "),
        class: `graph-edge${layoutEdge.crossGroup ? " is-cross-group" : ""}` +
          `${edge.blocking ? " is-blocking" : ""}${edge.unresolved ? " is-unresolved" : ""}` +
          `${edge.isCriticalPath ? " is-critical-path" : ""}`,
        "marker-end": "url(#dependency-arrow)",
        "data-source": edge.source,
        "data-target": edge.target,
      });
      path.append(svgElement("title", {}, `${edge.target} depends on ${edge.source}${edge.unresolved ? " (unresolved)" : edge.blocking ? " (blocking)" : ""}`));
      diagram.append(path);
    }
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    for (const position of positions.nodes) {
      const node = byId.get(position.id);
      const group = svgElement("g", {
        transform: `translate(${position.x - position.width / 2} ${position.y - position.height / 2})`,
        class: `graph-node${node.unresolved ? " is-unresolved" : ""}${node.hasCycle ? " has-cycle" : ""}` +
          `${node.matchKind === "context" ? " is-context" : ""}` +
          `${node.matchKind === "revealed" ? " is-revealed" : ""}` +
          `${node.isCriticalPath ? " is-critical-path" : ""}` +
          `${node.workflowState === "blocked" ? " is-blocked" : ""}`,
        "data-task-id": node.id,
        "data-priority-tone": node.priorityTone,
        "data-status-order": node.statusOrder,
        "data-workflow-state": node.workflowState,
        role: "button", tabindex: node.id === focusedId ? 0 : -1,
        "aria-label": nodeLabel(node), "aria-pressed": node.id === selectedId,
        "aria-keyshortcuts": "Enter Space ContextMenu Shift+F10",
      });
      group.append(svgElement("rect", { width: position.width, height: position.height, rx: 10 }));
      group.append(svgElement("text", { x: 14, y: 23, class: "graph-node-id" }, node.id.length > 29 ? `${node.id.slice(0, 26)}...` : node.id));
      for (const [index, line] of graphTitleLines(node.summary).entries()) {
        group.append(svgElement("text", { x: 14, y: 44 + index * 17, class: "graph-node-title" }, line));
      }
      const status = node.status.length > 30 ? `${node.status.slice(0, 27)}...` : node.status;
      group.append(svgElement("text", { x: 14, y: 82, class: "graph-node-status" }, status));
      const warning = [
        ...(node.blockedBy.length ? [`BLOCKED: ${node.blockedBy.length}`] : []),
        ...(node.hasCycle ? ["Cycle"] : []),
      ].join(" / ");
      if (warning) group.append(svgElement("text", { x: 14, y: 102, class: "graph-node-warning" }, warning));
      group.addEventListener("click", (event) => {
        if (suppressNextNodeClick) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextNodeClick = false;
          window.clearTimeout(suppressNodeClickTimer);
          return;
        }
        selectNode(node.id);
      });
      group.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (event.shiftKey) {
          focusNeighborhood(node.id);
          return;
        }
        invokeGraphTaskEdit(latestSnapshot, node.id, onEditTask);
      });
      group.addEventListener("focus", () => {
        focusedId = node.id;
        for (const [id, element] of nodeElements) element.setAttribute("tabindex", id === focusedId ? "0" : "-1");
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node.id);
        } else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const ids = model.nodes.map(({ id }) => id);
          const step = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
          const index = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1
            : (ids.indexOf(node.id) + step + ids.length) % ids.length;
          selectNode(ids[index], true);
        } else if (event.key === "ContextMenu" || event.key === "Menu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const bounds = group.getBoundingClientRect();
          openContextMenu(node.id, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, group);
        } else if (event.key === "Escape") {
          event.preventDefault();
          root.querySelector('[data-graph-zoom="fit"]').focus();
        }
      });
      nodeElements.set(node.id, group);
      diagram.append(group);
    }
  }

  function renderLists() {
    warnings.replaceChildren();
    const diagnostics = model.nodes.filter((node) => node.hasCycle || node.unresolved);
    if (diagnostics.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Dependency warnings";
      const list = document.createElement("ul");
      for (const node of diagnostics) {
        const item = document.createElement("li");
        item.append(relationButton(node.id), document.createTextNode(node.unresolved ? " - unresolved reference" : " - cycle detected"));
        list.append(item);
      }
      warnings.append(heading, list);
    }
    taskList.replaceChildren();
    for (const node of model.nodes) {
      const item = document.createElement("li");
      item.append(relationButton(node.id));
      const description = document.createElement("p");
      const prerequisites = model.edges.filter(({ target }) => target === node.id).map(({ source }) => source);
      const dependents = model.edges.filter(({ source }) => source === node.id).map(({ target }) => target);
      description.textContent = [
        ...(node.matchKind === "context" ? ["Dependency context, outside the active filters"] : []),
        ...(node.matchKind === "revealed" ? ["Temporarily revealed outside the active filters"] : []),
        node.status,
        `Depends On: ${prerequisites.join(", ") || "none"}`,
        `Blocked By: ${node.blockedBy.join(", ") || "none"}`,
        `Direct dependents: ${dependents.join(", ") || "none"}`,
        ...(node.hasCycle ? ["Cycle detected"] : []),
      ].join(". ");
      item.append(description);
      taskList.append(item);
    }
  }

  function renderWorkflowSummary() {
    workflowSummary.replaceChildren();
    const labels = [
      ["Dependency-ready", model.workflow.readyCount],
      ["Blocked work", model.workflow.blockedCount],
      ["Cycle tasks", model.workflow.cycleCount],
      ["Tasks with unresolved blockers", model.workflow.unresolvedCount],
    ];
    for (const [label, value] of labels) {
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = String(value);
      workflowSummary.append(term, detail);
    }
    criticalChain.textContent = model.workflow.longestChainIds.length
      ? model.workflow.longestChainIds.join(" -> ")
      : "No resolved multi-task dependency chain is available.";
    if (model.workflow.excludedCycleCount > 0) {
      criticalChain.textContent += ` (${model.workflow.excludedCycleCount} cycle tasks excluded)`;
    }
  }

  function fail(text, view = null) {
    generation += 1;
    finishPointerGesture(null, true);
    stopLayout();
    closeContextMenu(false);
    model = view;
    diagramAvailable = false;
    selectedId = null;
    nodeElements.clear();
    diagram.replaceChildren();
    taskList.replaceChildren();
    warnings.replaceChildren();
    if (model) {
      renderLists();
      renderWorkflowSummary();
    }
    renderInspector();
    errorMessage.textContent = text;
    errorPanel.hidden = false;
    viewport.hidden = true;
    zoomLabel.textContent = "";
    updateToolbar();
    message.textContent = model
      ? `Dependency diagram unavailable. ${model.taskCount} tasks remain available in the relationship list.`
      : "Dependency graph unavailable.";
  }

  async function render(snapshot, criteria = latestCriteria) {
    const request = ++generation;
    finishPointerGesture(null, true);
    closeContextMenu(false);
    stopLayout();
    const restoreId = document.activeElement?.closest(".graph-node")?.dataset.taskId;
    const restoreRetryFocus = document.activeElement === root.querySelector("#graph-retry");
    message.textContent = "Laying out the dependency graph...";
    let nextModel = null;
    try {
      latestSnapshot = snapshot;
      latestCriteria = { ...criteria };
      if (scope.focusId && !snapshot.tasks.some(({ id }) => id === scope.focusId)) {
        scope.focusId = null;
        scope.expandUpstream = false;
        scope.expandDownstream = false;
      }
      if (scope.revealedTaskId && !latestCriteria.search && !latestCriteria.source &&
        !latestCriteria.status && !latestCriteria.priority && !latestCriteria.category &&
        !latestCriteria.area && !latestCriteria.dependency) {
        scope.revealedTaskId = null;
      }
      nextModel = projectGraphView(createGraphView(snapshot), snapshot, latestCriteria, scope, {
        showCompletedWork,
        groupBy,
      });
      if (selectedId && snapshot.tasks.some(({ id }) => id === selectedId) &&
        !nextModel.nodes.some(({ id }) => id === selectedId) &&
        !nextModel.scope.focusId) {
        scope.revealedTaskId = selectedId;
        nextModel = projectGraphView(createGraphView(snapshot), snapshot, latestCriteria, scope, {
          showCompletedWork,
          groupBy,
        });
      }
      const key = graphLayoutKey(nextModel, groupBy);
      const needsLayout = key !== layoutKey || !positions;
      const nextPositions = needsLayout ? await calculateLayout(nextModel, groupBy) : positions;
      if (request !== generation) return;
      positions = nextPositions;
      layoutKey = key;
      model = nextModel;
      diagramAvailable = true;
      const removed = selectedId && !model.nodes.some(({ id }) => id === selectedId);
      if (removed) selectedId = null;
      if (!model.nodes.some(({ id }) => id === focusedId)) focusedId = model.nodes[0]?.id ?? null;
      errorPanel.hidden = true;
      viewport.hidden = model.nodes.length === 0;
      updateToolbar();
      drawDiagram();
      renderLists();
      renderWorkflowSummary();
      renderInspector();
      if (needsLayout) fit();
      else setZoom(zoom);
      const focusDescription = model.scope.focusId
        ? `Focused on ${model.scope.focusId}: ${model.focusMatchingCount} matches in this focus of ${model.matchingCount} matching tasks project-wide.`
        : `${model.matchingCount} matching tasks.`;
      const hiddenCompletedDescription = model.hiddenCompletedCount
        ? ` ${model.hiddenCompletedCount} completed tasks are hidden and ${model.hiddenCompletedEdgeCount} connected dependency links are omitted. The project-wide longest dependency chain above still includes completed tasks; show completed work to inspect full paths.`
        : "";
      message.textContent = model.nodes.length
        ? `${focusDescription} ${model.contextCount} dependency context tasks, ${model.revealedCount} temporarily revealed tasks, ${model.unresolvedCount} unresolved placeholders and ${model.cycleCount} cycle tasks.${hiddenCompletedDescription}`
        : model.taskCount === 0 ? "No tasks in this project."
          : `No tasks match the current filters in this graph scope.${hiddenCompletedDescription}`;
      if (restoreId && nodeElements.has(restoreId)) nodeElements.get(restoreId).focus({ preventScroll: true });
      else if (restoreId || restoreRetryFocus) {
        root.querySelector(model.nodes.length ? '[data-graph-zoom="fit"]' : "#graph-heading").focus();
      }
    } catch (error) {
      if (request !== generation) return;
      fail(error instanceof Error ? error.message : "The dependency graph could not be displayed.", nextModel);
    }
  }

  for (const control of viewportControls) {
    control.addEventListener("click", () => {
      const action = control.dataset.graphZoom;
      if (action === "fit") fit();
      else if (action === "reset") setZoom(1, true);
      else setZoom(zoom * (action === "in" ? 1.25 : 0.8));
    });
  }
  zoomInput.addEventListener("change", () => {
    const requestedZoom = Number(zoomInput.value);
    if (!Number.isFinite(requestedZoom) || requestedZoom < 1 || requestedZoom > 200) {
      zoomInput.value = String(Math.round(zoom * 100));
      message.textContent = "Enter a graph zoom between 1% and 200%.";
      return;
    }
    setZoom(requestedZoom / 100);
  });
  focusNeighborhoodButton.addEventListener("click", () => {
    if (selectedId) focusNeighborhood(selectedId);
  });
  expandUpstreamButton.addEventListener("click", () => {
    const taskId = scope.focusId ?? selectedId;
    if (taskId) expandFocus(taskId, "upstream");
  });
  expandDownstreamButton.addEventListener("click", () => {
    const taskId = scope.focusId ?? selectedId;
    if (taskId) expandFocus(taskId, "downstream");
  });
  wholeProjectButton.addEventListener("click", () => void resetScope());
  showOnBoardButton.addEventListener("click", () => {
    if (selectedId && latestSnapshot?.tasks.some(({ id }) => id === selectedId)) {
      onShowOnBoard?.(selectedId);
    }
  });
  editTaskButton.addEventListener("click", () => {
    if (selectedId) invokeGraphTaskEdit(latestSnapshot, selectedId, onEditTask);
  });
  completedToggle.addEventListener("click", () => {
    showCompletedWork = !showCompletedWork;
    const focusedTask = latestSnapshot?.tasks.find(({ id }) => id === scope.focusId);
    if (!showCompletedWork && focusedTask?.status === latestSnapshot.config.completionStatus) {
      scope.focusId = null;
      scope.expandUpstream = false;
      scope.expandDownstream = false;
    }
    void render(latestSnapshot, latestCriteria);
  });
  groupBySelect.addEventListener("change", () => {
    groupBy = groupBySelect.value;
    void render(latestSnapshot, latestCriteria);
  });
  return {
    render,
    fail,
    suspend: () => {
      generation += 1;
      finishPointerGesture(null, true);
      stopLayout();
      closeContextMenu(false);
    },
    resetScope,
    selectTask: (id, focus = false) => selectNode(id, focus),
    async showTask(id) {
      const task = latestSnapshot?.tasks.find((candidate) => candidate.id === id);
      if (!task) {
        message.textContent = `Task ${id} is not available in the current snapshot. Refresh the board and retry.`;
        return;
      }
      if (task.status === latestSnapshot.config.completionStatus) showCompletedWork = true;
      scope.focusId = null;
      scope.expandUpstream = false;
      scope.expandDownstream = false;
      scope.revealedTaskId = id;
      await render(latestSnapshot, latestCriteria);
      selectNode(id, true);
    },
    clearReveal: () => { scope.revealedTaskId = null; },
  };
}
