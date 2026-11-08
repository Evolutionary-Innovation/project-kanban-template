import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "../board-config.mjs";
import { parseBoardDocuments } from "../board-data.mjs";

const fixtureRoot = fileURLToPath(new URL("../../../../examples/synthetic-browser-project/", import.meta.url));

test("parses the isolated synthetic browser fixture and its UX data distributions", async () => {
  const config = await readBoardConfig(fixtureRoot);
  assert.ok(config.sources.every((source) =>
    source.extraFields.some(({ key, label, type, required }) =>
      key === "acceptanceCriteria" && label === "Acceptance Criteria" && type === "textarea" && !required)));
  const documents = Object.fromEntries(
    await Promise.all(
      config.sources.map(async (source) => [source.path, await readFile(`${fixtureRoot}/${source.path}`, "utf8")]),
    ),
  );
  const board = parseBoardDocuments(documents, config);
  const counts = (field) =>
    Object.fromEntries([...new Set(board.tasks.map((task) => task[field]))]
      .map((value) => [value, board.tasks.filter((task) => task[field] === value).length]));

  assert.equal(board.tasks.length, 60);
  assert.equal(board.config.completionStatus, "Complete");
  assert.deepEqual(counts("status"), {
    Complete: 10,
    "In Progress": 10,
    Planned: 16,
    Research: 12,
    "Future Ideas": 12,
  });
  assert.deepEqual(counts("priority"), { High: 20, Medium: 24, Low: 16 });
  assert.deepEqual(counts("category"), {
    Delivery: 12,
    Reliability: 12,
    "User experience": 10,
    Compatibility: 10,
    Documentation: 8,
    Research: 8,
  });
  assert.equal(new Set(board.tasks.map((task) => task.area)).size, 9);
  assert.equal(board.tasks.filter(({ createdDate }) => createdDate).length, 58);
  assert.equal(board.tasks.filter(({ completionDate }) => completionDate).length, 10);
  assert.ok(board.tasks.every(({ id, title }) => title.startsWith(`${id}: `)));
  assert.equal(board.tasks.find(({ id }) => id === "RM-019").createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "RA-005").createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "RM-005").completionDate, "2026-03-14");
  assert.equal(board.tasks.find(({ id }) => id === "RA-008").status, "Complete");
  assert.equal(board.tasks.find(({ id }) => id === "RA-008").completionDate, "");
  assert.ok(board.tasks.some(({ dependencyView }) => dependencyView?.hasUnresolved));
  assert.ok(board.tasks.some(({ dependencyView }) => dependencyView?.hasCycle));
  assert.match(board.tasks.find(({ id }) => id === "RM-002").details, /escaped pipe \| stays/);
});
