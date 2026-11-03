import assert from "node:assert/strict";
import test from "node:test";
import { invokeGraphTaskEdit } from "./board-graph-client.js";

test("forwards graph edits for stored tasks to the shared editor callback", () => {
  const task = { id: "RM-017", status: "Planned" };
  let editedTask;

  assert.equal(invokeGraphTaskEdit({ tasks: [task] }, task.id, (value) => {
    editedTask = value;
  }), true);
  assert.equal(editedTask, task);
});

test("does not invoke the editor for missing tasks or without an edit callback", () => {
  const editTask = () => assert.fail("No edit should be requested.");

  assert.equal(invokeGraphTaskEdit({ tasks: [] }, "TD-999", editTask), false);
  assert.equal(invokeGraphTaskEdit(null, "RM-017", editTask), false);
  assert.equal(invokeGraphTaskEdit({ tasks: [{ id: "RM-017" }] }, "RM-017"), false);
});
