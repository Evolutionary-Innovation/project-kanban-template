import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { BoardStorageError } from "./board-storage.mjs";
import { createBoardRequestHandler } from "./board-server.mjs";

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
