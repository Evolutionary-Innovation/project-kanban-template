import assert from "node:assert/strict";
import test from "node:test";
import { validateBoardConfig } from "./board-config.mjs";
import { independentTestConfig, testConfig } from "./test-fixtures.mjs";

test("rejects unsafe paths, duplicate sources, and invalid field definitions", async () => {
  const raw = testConfig();

  const traversal = structuredClone(raw);
  traversal.sources[0].path = "../outside.md";
  assert.throws(() => validateBoardConfig(traversal, "/workspace"), /workspace-relative path/);

  const duplicate = structuredClone(raw);
  duplicate.sources[1].path = duplicate.sources[0].path;
  assert.throws(() => validateBoardConfig(duplicate, "/workspace"), /duplicated/);

  const invalidField = structuredClone(raw);
  invalidField.sources[1].extraFields[0].key = "status";
  assert.throws(() => validateBoardConfig(invalidField, "/workspace"), /invalid or duplicated/);
});

test("rejects unsupported config keys and status defaults", async () => {
  const raw = testConfig();

  const extraProperty = { ...raw, parserExpression: "arbitrary code" };
  assert.throws(() => validateBoardConfig(extraProperty, "/workspace"), /missing or unsupported/);

  const invalidDefault = { ...raw, defaultStatus: "Started" };
  assert.throws(() => validateBoardConfig(invalidDefault, "/workspace"), /defaultStatus/);

  const invalidCompletionStatus = { ...raw, completionStatus: "Finished" };
  assert.throws(() => validateBoardConfig(invalidCompletionStatus, "/workspace"), /completionStatus/);

  const missingDateField = structuredClone(raw);
  missingDateField.sources[0].extraFields = [];
  assert.throws(() => validateBoardConfig(missingDateField, "/workspace"), /completionDate as a date field/);
});

test("validates an independent project with unrelated paths, prefixes, statuses, and fields", () => {
  const config = validateBoardConfig(independentTestConfig(), "/consumer/workspace");

  assert.deepEqual(config.statuses, ["Open", "Doing", "Done"]);
  assert.deepEqual(config.sources.map(({ idPrefix }) => idPrefix), ["PLAN", "EXP"]);
  assert.deepEqual(config.sources.map(({ path }) => path), [
    "planning/plans.md",
    "research/experiments.md",
  ]);
  assert.equal(config.sources[1].extraFields[0].key, "hypothesis");
  assert.equal(config.completionStatus, "Done");
});

test("keeps historical ID prefixes independent of parser selection", () => {
  const raw = testConfig();
  raw.sources[2].legacyIdPrefixes = ["OLD"];
  const config = validateBoardConfig(raw, "/workspace");

  assert.deepEqual(config.sources[2].legacyIdPrefixes, ["OLD"]);
  assert.equal("legacyAdapter" in config.sources[2], false);

  const obsoleteAdapter = structuredClone(raw);
  obsoleteAdapter.sources[2].legacyAdapter = "trade-mstr-v1";
  assert.throws(() => validateBoardConfig(obsoleteAdapter, "/workspace"), /missing or unsupported/);
});
