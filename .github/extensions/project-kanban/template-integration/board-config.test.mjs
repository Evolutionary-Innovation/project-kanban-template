import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readBoardConfig } from "../board-config.mjs";

const templateRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("loads the template config and validates its configured source contract", async () => {
  const config = await readBoardConfig(templateRoot);

  assert.equal(config.projectName, "Project Kanban Template");
  assert.deepEqual(config.statuses, ["Complete", "In Progress", "Planned", "Research", "Future Ideas"]);
  assert.deepEqual(config.sources.map(({ path }) => path), [
    "docs/roadmap.md",
    "docs/technical-debt.md",
    "docs/repository-audit.md",
  ]);
  assert.deepEqual(
    config.sources[1].extraFields.map(({ key }) => key),
    [
      "evidence",
      "limitation",
      "recommendedFix",
      "rationale",
      "recommendations",
      "dependsOn",
      "executionType",
      "createdDate",
      "completionDate",
    ],
  );
  assert.deepEqual(config.sources[0].extraFields.map(({ key }) => key), config.sources[1].extraFields.map(({ key }) => key));
  assert.deepEqual(config.sources[2].extraFields.map(({ key }) => key), config.sources[1].extraFields.map(({ key }) => key));
  assert.deepEqual(config.sources[0].extraFields.find(({ key }) => key === "executionType").choices, [
    "Human",
    "AI",
    "Human+AI",
    "Decision Required",
  ]);
  assert.equal(config.completionStatus, "Complete");
});

test("loads the template's independent example configuration", async () => {
  const exampleRoot = fileURLToPath(new URL("../../../../examples/independent-project/", import.meta.url));
  const config = await readBoardConfig(exampleRoot);

  assert.deepEqual(config.statuses, ["Open", "Doing", "Done"]);
  assert.deepEqual(config.sources.map(({ idPrefix }) => idPrefix), ["PLAN", "EXP"]);
  assert.equal(config.sources[1].extraFields[0].key, "hypothesis");
  assert.equal(config.completionStatus, "Done");
});
