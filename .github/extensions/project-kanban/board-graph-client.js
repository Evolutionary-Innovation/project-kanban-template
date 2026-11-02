import { createGraphView, graphLayoutKey, graphTitleLines } from "./board-graph.mjs";

const svgNamespace = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

export function createGraphController(root) {
  const viewport = root.querySelector("#graph-viewport");
  const diagram = root.querySelector("#graph-diagram");
  const inspector = root.querySelector("#graph-inspector");
  const taskList = root.querySelector("#graph-task-list");
  const warnings = root.querySelector("#graph-warnings");
  const message = root.querySelector("#graph-message");
  const errorPanel = root.querySelector("#graph-error");
  const errorMessage = root.querySelector("#graph-error-message");
  const zoomLabel = root.querySelector("#graph-zoom");
  const viewportControls = [...root.querySelectorAll("[data-graph-zoom]")];
  let generation = 0;
  let model = null;
  let positions = null;
  let layoutKey = "";
  let selectedId = null;
  let focusedId = null;
  let zoom = 1;
  let layoutWorker = null;
  let rejectLayout = null;
  const nodeElements = new Map();

  function stopLayout() {
    layoutWorker?.terminate();
    layoutWorker = null;
    rejectLayout?.(new Error("Dependency layout cancelled."));
    rejectLayout = null;
  }

  function calculateLayout(view) {
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
        nodes: view.nodes.map(({ id }) => ({ id })),
        edges: view.edges.map(({ source, target }) => ({ source, target })),
      });
    });
  }

  function nodeLabel(node) {
    return [
      node.title, node.status, node.priority, node.category, node.area,
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
    const metadata = document.createElement("dl");
    for (const [label, value] of [
      ["Status", node.status], ["Priority", node.priority], ["Category", node.category],
      ["Area", node.area], ["Execution Type", node.executionType],
      ...node.dates.map(({ label, value }) => [label, value]),
      ...(!node.unresolved ? [["Dependencies", node.blockedBy.length ? "Blocked" : "Dependency-unblocked"]] : []),
    ]) {
      if (!value) continue;
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      metadata.append(term, detail);
    }
    inspector.append(metadata);
    if (node.hasCycle || node.unresolved) {
      const warning = document.createElement("p");
      warning.className = "graph-warning-text";
      warning.textContent = node.unresolved
        ? "This ID is referenced but no task exists. It cannot be edited."
        : "Dependency cycle detected. Review this task's prerequisite links on the board.";
      inspector.append(warning);
    }
    const prerequisites = model.edges.filter(({ target }) => target === node.id).map(({ source }) => source);
    const dependents = model.edges.filter(({ source }) => source === node.id).map(({ target }) => target);
    inspector.append(
      relationshipList("Depends On", prerequisites),
      relationshipList("Blocked By", node.blockedBy),
      relationshipList(node.unresolved ? "Referenced by" : "Direct dependents", dependents),
    );
    for (const { label, value } of node.details) {
      const section = document.createElement("section");
      const title = document.createElement("h4");
      const content = document.createElement("p");
      title.textContent = label;
      content.textContent = value;
      section.append(title, content);
      inspector.append(section);
    }
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
    message.textContent = `Selected ${nodeLabel(node)}`;
    if (focus) {
      nodeElements.get(id)?.focus({ preventScroll: true });
      nodeElements.get(id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }

  function setZoom(value, resetScroll = false) {
    if (!positions?.nodes.length) return;
    zoom = Math.max(0.001, Math.min(2, value));
    diagram.setAttribute("width", String(Math.ceil(positions.width * zoom)));
    diagram.setAttribute("height", String(Math.ceil(positions.height * zoom)));
    zoomLabel.textContent = `${(zoom * 100).toFixed(zoom < 0.01 ? 1 : 0)}%`;
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
    const edgePositions = new Map(positions.edges.map((edge) => [JSON.stringify([edge.source, edge.target]), edge]));
    for (const edge of model.edges) {
      const layoutEdge = edgePositions.get(JSON.stringify([edge.source, edge.target]));
      const path = svgElement("path", {
        d: layoutEdge.points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "),
        class: `graph-edge${edge.blocking ? " is-blocking" : ""}${edge.unresolved ? " is-unresolved" : ""}`,
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
        class: `graph-node${node.unresolved ? " is-unresolved" : ""}${node.hasCycle ? " has-cycle" : ""}`,
        "data-task-id": node.id,
        "data-priority-tone": node.priorityTone,
        role: "button", tabindex: node.id === focusedId ? 0 : -1,
        "aria-label": nodeLabel(node), "aria-pressed": node.id === selectedId,
      });
      group.append(svgElement("rect", { width: position.width, height: position.height, rx: 10 }));
      group.append(svgElement("text", { x: 14, y: 23, class: "graph-node-id" }, node.id.length > 29 ? `${node.id.slice(0, 26)}...` : node.id));
      for (const [index, line] of graphTitleLines(node.summary).entries()) {
        group.append(svgElement("text", { x: 14, y: 44 + index * 17, class: "graph-node-title" }, line));
      }
      const status = node.status.length > 30 ? `${node.status.slice(0, 27)}...` : node.status;
      group.append(svgElement("text", { x: 14, y: 82, class: "graph-node-status" }, status));
      const warning = [
        ...(node.blockedBy.length ? [`Blocked: ${node.blockedBy.length}`] : []),
        ...(node.hasCycle ? ["Cycle"] : []),
      ].join(" / ");
      if (warning) group.append(svgElement("text", { x: 14, y: 102, class: "graph-node-warning" }, warning));
      group.addEventListener("click", () => selectNode(node.id));
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

  function fail(text, view = null) {
    generation += 1;
    stopLayout();
    model = view;
    selectedId = null;
    nodeElements.clear();
    diagram.replaceChildren();
    taskList.replaceChildren();
    warnings.replaceChildren();
    if (model) renderLists();
    renderInspector();
    errorMessage.textContent = text;
    errorPanel.hidden = false;
    viewport.hidden = true;
    for (const control of viewportControls) control.disabled = true;
    zoomLabel.textContent = "";
    message.textContent = model
      ? `Dependency diagram unavailable. ${model.taskCount} tasks remain available in the relationship list.`
      : "Dependency graph unavailable.";
  }

  async function render(snapshot) {
    const request = ++generation;
    stopLayout();
    const restoreId = document.activeElement?.closest(".graph-node")?.dataset.taskId;
    const restoreRetryFocus = document.activeElement === root.querySelector("#graph-retry");
    message.textContent = "Laying out the dependency graph...";
    let nextModel = null;
    try {
      nextModel = createGraphView(snapshot);
      const key = graphLayoutKey(nextModel);
      const needsLayout = key !== layoutKey || !positions;
      const nextPositions = needsLayout ? await calculateLayout(nextModel) : positions;
      if (request !== generation) return;
      positions = nextPositions;
      layoutKey = key;
      model = nextModel;
      const removed = selectedId && !model.nodes.some(({ id }) => id === selectedId);
      if (removed) selectedId = null;
      if (!model.nodes.some(({ id }) => id === focusedId)) focusedId = model.nodes[0]?.id ?? null;
      errorPanel.hidden = true;
      viewport.hidden = model.nodes.length === 0;
      for (const control of viewportControls) control.disabled = model.nodes.length === 0;
      drawDiagram();
      renderLists();
      renderInspector();
      if (needsLayout) fit();
      else setZoom(zoom);
      message.textContent = model.nodes.length
        ? `${model.taskCount} tasks, ${model.edges.length} dependencies, ${model.unresolvedCount} unresolved references, ${model.cycleCount} tasks in cycles.${removed ? " The selected task is no longer available." : ""}`
        : "No tasks in this project.";
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
  return {
    render,
    fail,
    suspend: () => { generation += 1; stopLayout(); },
  };
}
