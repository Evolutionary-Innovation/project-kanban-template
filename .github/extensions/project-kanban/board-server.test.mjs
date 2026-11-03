import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BoardStorageError,
  createTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
} from "./board-storage.mjs";
import { readBoardConfig } from "./board-config.mjs";
import { createBoardRequestHandler } from "./board-server.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function createWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "project-kanban-api-test-"));
  await cp(join(workspaceRoot, "project-kanban.config.json"), join(root, "project-kanban.config.json"));
  await cp(join(workspaceRoot, "docs"), join(root, "docs"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, config: await readBoardConfig(root) };
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
