import assert from "node:assert/strict";
import test from "node:test";
import { validateBoardConfig } from "./board-config.mjs";
import {
  analyzeDependencies,
  findDependencySuggestions,
  findIntroducedDependencyCycle,
  parseDependencyIds,
} from "./board-dependencies.mjs";
import { independentTestConfig, testConfig } from "./test-fixtures.mjs";

const config = validateBoardConfig(testConfig());
const roadmapPath = config.sources.find(({ key }) => key === "roadmap").path;
const debtPath = config.sources.find(({ key }) => key === "technicalDebt").path;
const auditPath = config.sources.find(({ key }) => key === "repositoryAudit").path;

test("validates configured dependency ID formats and normalizes comma-separated IDs", () => {
  assert.deepEqual(parseDependencyIds(" TD-03, RM-019 ", config), ["TD-03", "RM-019"]);
  assert.deepEqual(parseDependencyIds("", config), []);
  assert.throws(() => parseDependencyIds("XX-001", config), /configured task ID prefix/);
  assert.throws(() => parseDependencyIds("RM-019, RM-019", config), /duplicate task ID/);
  assert.throws(() => parseDependencyIds("RM-019,,TD-03", config), /empty task ID/);
});

test("derives blockers and graph edges from stored Depends On relationships", () => {
  const tasks = [
    { id: "TD-03", title: "Prerequisite", status: "In Progress", dependsOn: "", source: { document: debtPath } },
    { id: "RM-019", title: "Dependent", status: "Planned", dependsOn: "TD-03, RA-005", source: { document: roadmapPath } },
    { id: "RA-005", title: "Completed prerequisite", status: "Complete", dependsOn: "", source: { document: auditPath } },
    { id: "RM-020", title: "Unresolved dependency", status: "Planned", dependsOn: "TD-99", source: { document: roadmapPath } },
    { id: "RM-021", title: "Cycle A", status: "Planned", dependsOn: "RM-022", source: { document: roadmapPath } },
    { id: "RM-022", title: "Cycle B", status: "Planned", dependsOn: "RM-021", source: { document: roadmapPath } },
  ];
  const { taskViews, graph } = analyzeDependencies(tasks, config);

  assert.deepEqual(taskViews.get("RM-019").blockedBy, ["TD-03"]);
  assert.deepEqual(taskViews.get("RM-019").dependsOn, ["TD-03", "RA-005"]);
  assert.equal(taskViews.get("RM-020").hasUnresolved, true);
  assert.deepEqual(taskViews.get("RM-020").blockedBy, ["TD-99"]);
  assert.deepEqual(graph.edges[0], { source: "TD-03", target: "RM-019", unresolved: false });
  assert.deepEqual(graph.unresolvedIds, ["TD-99"]);
  assert.deepEqual(graph.cyclicTaskIds, ["RM-021", "RM-022"]);
});

test("suggests only exact task IDs paired with explicit dependency phrases", () => {
  const tasks = [
    {
      id: "RM-019",
      title: "Dependent task",
      details: "This work depends on TD-03. It also mentions RA-005 and TD-0300.",
      evidence: "Blocked by RA-005; the narrative includes no other relationship.",
      dependsOn: "",
      source: { document: roadmapPath },
    },
    {
      id: "TD-03",
      title: "Prerequisite debt task",
      details: "",
      dependsOn: "",
      source: { document: debtPath },
    },
    {
      id: "TD-030",
      title: "Longer ID",
      details: "",
      dependsOn: "",
      source: { document: debtPath },
    },
    {
      id: "RA-005",
      title: "Audit prerequisite",
      details: "",
      dependsOn: "",
      source: { document: auditPath },
    },
    {
      id: "RM-020",
      title: "Already canonical",
      details: "This is blocked by TD-03.",
      dependsOn: "TD-03",
      source: { document: roadmapPath },
    },
    {
      id: "TD-04",
      title: "Unrelated task",
      details: "Reviewed RM-019 and requires completion of TD-0300.",
      dependsOn: "",
      source: { document: debtPath },
    },
  ];

  const suggestions = findDependencySuggestions(tasks, config);

  assert.deepEqual(
    suggestions.map(({ dependentTaskId, prerequisiteTaskId, field, relationshipPhrase, confidenceLabel }) => ({
      dependentTaskId,
      prerequisiteTaskId,
      field,
      relationshipPhrase,
      confidenceLabel,
    })),
    [
      {
        dependentTaskId: "RM-019",
        prerequisiteTaskId: "RA-005",
        field: "Evidence",
        relationshipPhrase: "blocked by",
        confidenceLabel: "High",
      },
      {
        dependentTaskId: "RM-019",
        prerequisiteTaskId: "TD-03",
        field: "Details",
        relationshipPhrase: "depends on",
        confidenceLabel: "High",
      },
    ],
  );
  const dependsOnSuggestion = suggestions.find(({ prerequisiteTaskId }) => prerequisiteTaskId === "TD-03");
  assert.match(dependsOnSuggestion.evidence, /depends on TD-03/);
  assert.equal(dependsOnSuggestion.confidence, 0.96);
  assert.equal(suggestions.some(({ prerequisiteTaskId }) => prerequisiteTaskId === "TD-030"), false);
  assert.equal(suggestions.some(({ dependentTaskId }) => dependentTaskId === "RM-020"), false);
  assert.equal(suggestions.some(({ dependentTaskId }) => dependentTaskId === "TD-04"), false);
});

test("supports explicit dependency phrase variants without title or bare-ID matching", () => {
  const phrases = [
    ["requires", "The work requires RA-005.", 0.82],
    ["must complete first", "Must complete TD-03 first.", 0.95],
    ["after completion of", "Begin after completion of RM-021.", 0.9],
    ["prerequisite", "Prerequisite: TD-030.", 0.9],
  ];
  const tasks = [
    {
      id: "RM-019",
      title: "No title matching",
      details: phrases.map(([, text]) => text).join(" "),
      dependsOn: "",
      source: { document: roadmapPath },
    },
    ...["TD-03", "TD-030", "RA-005", "RM-021"].map((id) => ({
      id,
      title: "Prerequisite",
      details: "",
      dependsOn: "",
      source: { document: config.sources.find(({ idPrefix }) => id.startsWith(`${idPrefix}-`)).path },
    })),
  ];

  const suggestions = findDependencySuggestions(tasks, config);
  assert.deepEqual(
    suggestions.map(({ relationshipPhrase, confidence }) => [relationshipPhrase, confidence]),
    [
      ["must complete first", 0.95],
      ["after completion of", 0.9],
      ["prerequisite", 0.9],
      ["requires", 0.82],
    ],
  );
  assert.ok(suggestions.every(({ prerequisiteTaskTitle }) => prerequisiteTaskTitle === "Prerequisite"));
});

test("rejects newly introduced cycles while permitting acyclic cross-source references", () => {
  const tasks = [
    { id: "RM-019", dependsOn: "", source: { document: roadmapPath } },
    { id: "TD-03", dependsOn: "RM-019", source: { document: debtPath } },
  ];

  assert.deepEqual(findIntroducedDependencyCycle("RM-019", [], ["TD-03"], tasks, config), [
    "RM-019",
    "TD-03",
    "RM-019",
  ]);
  assert.equal(findIntroducedDependencyCycle("RM-019", [], ["RA-005"], tasks, config), null);
});

test("dependency ID validation follows independent project prefixes", () => {
  const config = validateBoardConfig(independentTestConfig());

  assert.deepEqual(parseDependencyIds("PLAN-001, EXP-001", config), ["PLAN-001", "EXP-001"]);
  assert.throws(() => parseDependencyIds("RM-001", config), /configured task ID prefix/);
});
