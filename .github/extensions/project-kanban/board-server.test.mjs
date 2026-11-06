import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  BoardStorageError,
  createTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
} from "./board-storage.mjs";
import { createBoardRequestHandler } from "./board-server.mjs";
import { createTestWorkspace } from "./test-fixtures.mjs";

async function createWorkspace(t) {
  return createTestWorkspace(t);
}

async function startTestServer(context, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("serves mutation results and maps stale revisions to HTTP 409", async (context) => {
  const handler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: async () => {
      throw new BoardStorageError("board_revision_conflict", "Refresh before retrying.");
    },
    createTask: async (input) => ({ created: input.task.title }),
    editTask: async () => {
      throw new BoardStorageError("board_dependency_cycle", "The dependency would create a cycle.");
    },
    deleteTask: async (input) => ({ deleted: input.taskId, confirmed: input.confirmed }),
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const created = await fetch(`${origin}/api/tasks/create`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ task: { title: "Returns tab" } }),
  });
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { created: "Returns tab" });

  const viewModule = await fetch(`${origin}/board-view.mjs`);
  assert.equal(viewModule.status, 200);
  assert.match(await viewModule.text(), /export function filterTasks/);

  const stale = await fetch(`${origin}/api/tasks/move`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    error: "Refresh before retrying.",
    code: "board_revision_conflict",
  });

  const cycle = await fetch(`${origin}/api/tasks/edit`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(cycle.status, 400);
  assert.deepEqual(await cycle.json(), {
    error: "The dependency would create a cycle.",
    code: "board_dependency_cycle",
  });
});

test("serves read-only planning routes without invoking task mutations", async (context) => {
  let taskMutationCalls = 0;
  let planningContextCalls = 0;
  let requestedView;
  const handler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: async () => { taskMutationCalls += 1; },
    createTask: async () => { taskMutationCalls += 1; },
    editTask: async () => { taskMutationCalls += 1; },
    deleteTask: async () => { taskMutationCalls += 1; },
    getPlanningContext: async () => {
      planningContextCalls += 1;
      return { schemaVersion: 1, board: { totalTaskCount: 0 } };
    },
    requestNextWork: async (currentView) => {
      requestedView = currentView;
      return {
        contextGeneratedAt: "2026-11-03T12:00:00.000Z",
        boardSnapshotAt: "2026-11-03T11:59:00.000Z",
        coverage: { canonicalDependencyCount: 0 },
        plan: { summary: "Review the data-quality work first." },
      };
    },
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const contextResponse = await fetch(`${origin}/api/planning-context`);
  assert.equal(contextResponse.status, 200);
  assert.deepEqual(await contextResponse.json(), {
    schemaVersion: 1,
    board: { totalTaskCount: 0 },
  });

  const unsupportedContextMethod = await fetch(`${origin}/api/planning-context`, { method: "POST" });
  assert.equal(unsupportedContextMethod.status, 405);
  assert.equal(unsupportedContextMethod.headers.get("allow"), "GET");
  assert.equal(planningContextCalls, 1);

  const currentView = {
    activeView: "kanban",
    searchActive: false,
    filters: {},
    revealedTaskId: null,
  };
  const suggestionResponse = await fetch(`${origin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentView }),
  });
  assert.equal(suggestionResponse.status, 200);
  assert.deepEqual(await suggestionResponse.json(), {
    contextGeneratedAt: "2026-11-03T12:00:00.000Z",
    boardSnapshotAt: "2026-11-03T11:59:00.000Z",
    coverage: { canonicalDependencyCount: 0 },
    plan: { summary: "Review the data-quality work first." },
  });
  assert.deepEqual(requestedView, currentView);

  const unsupportedSuggestionMethod = await fetch(`${origin}/api/planning/suggest`);
  assert.equal(unsupportedSuggestionMethod.status, 405);
  assert.equal(unsupportedSuggestionMethod.headers.get("allow"), "POST");

  const nonJson = await fetch(`${origin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: JSON.stringify({ currentView }),
  });
  assert.equal(nonJson.status, 415);

  const extraInput = await fetch(`${origin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentView, tasks: [] }),
  });
  assert.equal(extraInput.status, 400);
  assert.equal((await extraInput.json()).code, "planning_context_invalid");

  const crossOrigin = await fetch(`${origin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ currentView }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(taskMutationCalls, 0);
});

test("reports unavailable and malformed current-session planning integrations", async (context) => {
  const unavailableHandler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: async () => ({}),
    createTask: async () => ({}),
    editTask: async () => ({}),
    deleteTask: async () => ({}),
    getPlanningContext: async () => ({}),
  });
  const unavailableOrigin = await startTestServer(context, unavailableHandler);
  const unavailable = await fetch(`${unavailableOrigin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: unavailableOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentView: null }),
  });
  assert.equal(unavailable.status, 503);

  const malformedHandler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: async () => ({}),
    createTask: async () => ({}),
    editTask: async () => ({}),
    deleteTask: async () => ({}),
    requestNextWork: async () => {
      throw Object.assign(new Error("Agent returned malformed JSON."), {
        code: "planning_response_invalid",
        rawAnswer: "not json",
      });
    },
  });
  const malformedOrigin = await startTestServer(context, malformedHandler);
  const malformed = await fetch(`${malformedOrigin}/api/planning/suggest`, {
    method: "POST",
    headers: { Origin: malformedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentView: null }),
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Agent returned malformed JSON.",
    code: "planning_response_invalid",
    rawAnswer: "not json",
  });
});

test("applies completion lifecycle through edit and move API routes", async (context) => {
  const { root, config } = await createWorkspace(context);
  let board = await readBoardSnapshot(root, config);
  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Exercise lifecycle API routes",
      area: "Testing",
      priority: "Medium",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  let task = board.tasks.find(({ title }) => title === "Exercise lifecycle API routes");
  const handler = await createBoardRequestHandler({
    loadBoard: () => readBoardSnapshot(root, config),
    moveTask: (input) => moveTaskInDocuments(root, config, input),
    createTask: (input) => createTaskInDocuments(root, config, input),
    editTask: (input) => editTaskInDocuments(root, config, input),
    deleteTask: async () => ({ deleted: true }),
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  async function mutate(path, input) {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result;
  }

  board = await mutate("/api/tasks/edit", {
    taskId: task.id,
    updates: { status: "Complete", completionDate: "" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.match(task.completionDate, /^\d{4}-\d{2}-\d{2}$/);

  board = await mutate("/api/tasks/edit", {
    taskId: task.id,
    updates: { status: "In Progress", completionDate: "" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.notEqual(task.completionDate, "");

  board = await mutate("/api/tasks/edit", {
    taskId: task.id,
    updates: { completionDate: "2020-01-01" },
    revisions: board.revisions,
  });
  board = await mutate("/api/tasks/move", {
    taskId: task.id,
    status: "Complete",
    order: 100,
    revisions: board.revisions,
  });
  assert.notEqual(board.tasks.find(({ id }) => id === task.id).completionDate, "2020-01-01");
});

test("approves a dependency suggestion through the canonical edit route and rejects cycles", async (context) => {
  const { root, config } = await createWorkspace(context);
  let board = await readBoardSnapshot(root, config);
  board = await editTaskInDocuments(root, config, {
    taskId: "RM-001",
    updates: { details: "This task depends on TD-01." },
    revisions: board.revisions,
  });
  const handler = await createBoardRequestHandler({
    loadBoard: () => readBoardSnapshot(root, config),
    moveTask: (input) => moveTaskInDocuments(root, config, input),
    createTask: (input) => createTaskInDocuments(root, config, input),
    editTask: (input) => editTaskInDocuments(root, config, input),
    deleteTask: async () => ({ deleted: true }),
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const initial = await fetch(`${origin}/api/board`);
  assert.equal(initial.status, 200);
  board = await initial.json();
  const suggestion = board.dependencySuggestions.find(
    ({ dependentTaskId, prerequisiteTaskId }) => dependentTaskId === "RM-001" && prerequisiteTaskId === "TD-01",
  );
  assert.ok(suggestion);
  assert.deepEqual(board.dependencyGraph.edges, []);
  assert.deepEqual(board.tasks.find(({ id }) => id === "RM-001").dependencyView.dependsOn, []);
  assert.equal(board.tasks.find(({ id }) => id === "RM-001").dependencyView.isBlocked, false);

  const approved = await fetch(`${origin}/api/tasks/edit`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: suggestion.dependentTaskId,
      updates: { dependsOn: suggestion.prerequisiteTaskId },
      revisions: board.revisions,
    }),
  });
  assert.equal(approved.status, 200);
  board = await approved.json();
  assert.deepEqual(board.dependencyGraph.edges, [
    { source: "TD-01", target: "RM-001", unresolved: false },
  ]);
  assert.deepEqual(board.tasks.find(({ id }) => id === "RM-001").dependencyView.dependsOn, ["TD-01"]);
  assert.equal(board.tasks.find(({ id }) => id === "RM-001").dependencyView.isBlocked, true);
  assert.deepEqual(board.dependencySuggestions, []);

  const cycle = await fetch(`${origin}/api/tasks/edit`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: "TD-01",
      updates: { dependsOn: "RM-001" },
      revisions: board.revisions,
    }),
  });
  assert.equal(cycle.status, 400);
  assert.equal((await cycle.json()).code, "board_dependency_cycle");
});

test("rejects cross-origin and non-JSON mutations before calling handlers", async (context) => {
  let called = false;
  const handler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: async () => ({ ok: true }),
    createTask: async () => {
      called = true;
      return { ok: true };
    },
    editTask: async () => ({ ok: true }),
    deleteTask: async () => ({ ok: true }),
  });

  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const crossOrigin = await fetch(`${origin}/api/tasks/create`, {
    method: "POST",
    headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);

  const wrongContentType = await fetch(`${origin}/api/tasks/create`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);

  const oversized = await fetch(`${origin}/api/tasks/create`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ details: "x".repeat(33000) }),
  });
  assert.equal(oversized.status, 400);
  assert.equal(called, false);
});

test("serves only allowlisted graph modules locally without mutations or relaxed script policy", async (context) => {
  let mutations = 0;
  const mutate = async () => { mutations += 1; return {}; };
  const handler = await createBoardRequestHandler({
    loadBoard: async () => ({ tasks: [] }),
    moveTask: mutate, createTask: mutate, editTask: mutate, deleteTask: mutate,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const asset of [
    "board-graph.mjs", "board-graph-client.js", "board-graph-worker.mjs",
    "vendor/dagre-3.1.3.mjs",
  ]) {
    const response = await fetch(`${origin}/${asset}?attempt=2`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript/);
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, /worker-src 'self'/);
    assert.match(policy, /script-src 'self';/);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https:/);
    assert.ok((await response.text()).length > 100);
  }
  for (const path of ["/vendor/unknown.mjs", "/vendor/README.md", "/board-graph-client.js/extra", "/api/graph"]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404);
  }
  const page = await (await fetch(origin)).text();
  assert.match(page, /id="graph-panel"[^>]*hidden/);
  assert.match(page, /id="show-kanban"[^>]*aria-pressed="true"/);
  assert.equal(mutations, 0);
});
