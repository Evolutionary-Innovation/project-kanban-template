import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig, validateBoardConfig } from "./board-config.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("loads the default project config and validates configured source paths", async () => {
  const config = await readBoardConfig(workspaceRoot);

  assert.equal(config.projectName, "Project Kanban Template");
  assert.deepEqual(config.statuses, ["Complete", "In Progress", "Planned", "Research", "Future Ideas"]);
  assert.deepEqual(config.sources.map(({ path }) => path), [
    "docs/roadmap.md",
    "docs/technical-debt.md",
    "docs/repository-audit.md",
  ]);
  assert.deepEqual(config.sources[1].extraFields.map(({ key }) => key), [
    "limitation",
    "recommendedFix",
    "rationale",
  ]);
});

test("supports a distinct independent project configuration", async () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const config = await readBoardConfig(exampleRoot);

  assert.deepEqual(config.statuses, ["Open", "Doing", "Done"]);
  assert.deepEqual(config.sources.map(({ idPrefix }) => idPrefix), ["PLAN", "EXP"]);
  assert.equal(config.sources[1].extraFields[0].key, "hypothesis");
});

test("rejects unsafe paths, duplicate sources, and invalid field definitions", async () => {
  const raw = JSON.parse(await readFile(`${workspaceRoot}/project-kanban.config.json`, "utf8"));

  const traversal = structuredClone(raw);
  traversal.sources[0].path = "../outside.md";
  assert.throws(() => validateBoardConfig(traversal, workspaceRoot), /workspace-relative path/);

  const duplicate = structuredClone(raw);
  duplicate.sources[1].path = duplicate.sources[0].path;
  assert.throws(() => validateBoardConfig(duplicate, workspaceRoot), /duplicated/);

  const invalidField = structuredClone(raw);
  invalidField.sources[1].extraFields[0].key = "status";
  assert.throws(() => validateBoardConfig(invalidField, workspaceRoot), /invalid or duplicated/);
});

test("rejects unsupported config keys and status defaults", async () => {
  const raw = JSON.parse(await readFile(`${workspaceRoot}/project-kanban.config.json`, "utf8"));

  const extraProperty = { ...raw, parserExpression: "arbitrary code" };
  assert.throws(() => validateBoardConfig(extraProperty, workspaceRoot), /missing or unsupported/);

  const invalidDefault = { ...raw, defaultStatus: "Started" };
  assert.throws(() => validateBoardConfig(invalidDefault, workspaceRoot), /defaultStatus/);
});
