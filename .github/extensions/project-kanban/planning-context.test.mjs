import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildNextWorkPrompt,
  buildPlanningContext,
  buildPlanningCoverage,
  parsePlanningAnswer,
  PlanningError,
  readPlanningDocuments,
} from "./planning-context.mjs";

const board = {
  generatedAt: "2026-11-03T12:00:00.000Z",
  config: {
    projectName: "Example",
    boardTitle: "Example Kanban",
    completionStatus: "Complete",
    statuses: ["Future Ideas", "Research", "Planned", "In Progress", "Complete"],
    priorities: [{ name: "High" }, { name: "Medium" }, { name: "Low" }],
    sources: [{ key: "roadmap", path: "docs/roadmap.md" }],
  },
  tasks: [
    {
      id: "RM-001",
      title: "Build analytics",
      status: "Planned",
      priority: "High",
      category: "Product",
      area: "Analytics",
      source: { document: "docs/roadmap.md" },
      details: "Create reliable investor analytics.",
      dependencyView: {
        dependsOn: ["TD-001"],
        blockedBy: [],
        unresolved: [],
        isBlocked: false,
        hasCycle: false,
      },
    },
    {
      id: "TD-001",
      title: "Validate market data",
      status: "Research",
      priority: "Medium",
      category: "Data",
      area: "Data quality",
      source: { document: "docs/roadmap.md" },
      dependencyView: {
        dependsOn: [],
        blockedBy: [],
        unresolved: [],
        isBlocked: false,
        hasCycle: false,
      },
    },
    {
      id: "RM-002",
      title: "Explore a future layout",
      status: "Future Ideas",
      priority: "Low",
      category: "Workspace",
      area: "Workspace",
      source: { document: "docs/roadmap.md" },
      dependencyView: {
        dependsOn: [],
        blockedBy: [],
        unresolved: [],
        isBlocked: false,
        hasCycle: false,
      },
    },
    {
      id: "RM-003",
      title: "Already underway",
      status: "In Progress",
      priority: "High",
      category: "Product",
      area: "Analytics",
      source: { document: "docs/roadmap.md" },
      dependencyView: {
        dependsOn: [],
        blockedBy: [],
        unresolved: [],
        isBlocked: false,
        hasCycle: false,
      },
    },
    {
      id: "RM-004",
      title: "Already complete",
      status: "Complete",
      priority: "High",
      category: "Product",
      area: "Analytics",
      source: { document: "docs/roadmap.md" },
      dependencyView: {
        dependsOn: [],
        blockedBy: [],
        unresolved: [],
        isBlocked: false,
        hasCycle: false,
      },
    },
  ],
};

const documents = [
  { path: "AGENTS.md", available: false, hash: null, contents: "" },
  { path: "README.md", available: false, hash: null, contents: "" },
  { path: "frontend/README.md", available: false, hash: null, contents: "" },
  {
    path: "docs/architecture.md",
    available: true,
    hash: "architecture-hash",
    contents: "# Architecture\n\n**Project Goal:** Support MSTR/BTC investors.\n\n## Data flow\nPrices flow through the canonical data boundary.",
  },
  {
    path: "docs/roadmap.md",
    available: true,
    hash: "roadmap-hash",
    contents: "# Roadmap\n\n## Future\nExplore the next generation of the workspace.",
  },
];

function createContext(currentView) {
  return buildPlanningContext({ board, documents, currentView });
}

function validAnswer(recommendationId = "RM-001") {
  return JSON.stringify({
    summary: "Validate data before extending analytics.",
    recommendation: {
      taskId: recommendationId,
      whyNow: "It protects downstream calculations.",
      unlocks: "Reliable analytics work.",
      confidence: "High",
      confidenceRationale: "A canonical dependency points to the data task.",
    },
    noRecommendationReason: "",
    planningConfidence: {
      level: "Medium",
      rationale: "One dependency is recorded, but narrative coverage is incomplete.",
    },
    reasoning: {
      whyRecommendation: "The data validation task is the best leverage point.\n\nIt protects future calculations from silently propagating bad inputs.",
      whatItUnlocks: "It allows analytics work to build on validated market data and exposes data quality risks early.",
      prerequisites: ["TD-001 is the recorded prerequisite."],
      alternativesNotSelected: ["RM-002 is lower leverage now."],
      missingDependencyObservations: ["The roadmap narrative may imply additional ordering, but it does not prove a blocker."],
      suggestedDependencies: [{
        dependentTaskId: "RM-002",
        prerequisiteTaskId: "RM-001",
        evidence: "RM-002 details mention analytics workspace work.",
        rationale: "It may need the analytics capability, but the wording is not definitive.",
        confidence: "Low",
      }],
      assumptions: ["The canonical market-data boundary remains the intended source."],
      uncertainty: ["The task text does not define a measurable validation threshold."],
      suggestedFirstStep: "Review current data-quality checks and write down the acceptance criteria before implementation.",
      evidence: ["RM-001 depends on TD-001 in the canonical graph."],
    },
    alternativePaths: [
      {
        label: "Workspace-first",
        taskId: "RM-002",
        approach: "Explore the workspace layout first.",
        tradeoff: "This creates visible progress but leaves data-quality risk unresolved.",
        confidence: "Low",
      },
      {
        label: "Data-first",
        taskId: "TD-001",
        approach: "Start with the validation research task.",
        tradeoff: "This reduces uncertainty but delays visible feature delivery.",
        confidence: "Medium",
      },
    ],
    implementationSequences: [
      {
        pathType: "recommended",
        label: "Recommended Path",
        steps: [{
          taskId: "RM-001",
          rationale: "It is the selected next task.",
          benefit: "It validates the data boundary.",
          unlocks: "Reliable analytics work.",
          confidence: "High",
        }],
      },
      {
        pathType: "alternative",
        label: "Data-first",
        steps: [
          {
            taskId: "TD-001",
            rationale: "Resolve the recorded prerequisite first.",
            benefit: "It reduces data uncertainty.",
            unlocks: "The analytics task can proceed.",
            confidence: "Medium",
          },
          {
            taskId: "RM-001",
            rationale: "Continue with the recommended analytics task.",
            benefit: "The data validation can be applied.",
            unlocks: "Reliable analytics work.",
            confidence: "High",
          },
        ],
      },
    ],
    risks: [{ risk: "Validation may reveal more data issues.", mitigation: "Keep acceptance criteria and scope explicit." }],
  });
}

test("builds read-only planning context with explicit goals, canonical edges, and current-view metadata", () => {
  const context = createContext({
    activeView: "graph",
    searchActive: true,
    filters: { status: ["Planned"], dependency: ["blocked"] },
    revealedTaskId: "RM-001",
  });

  assert.equal(context.schemaVersion, 1);
  assert.deepEqual(context.projectGoals.explicitGoals, [{
    source: "docs/architecture.md",
    line: 3,
    text: "Support MSTR/BTC investors.",
  }]);
  assert.equal(context.projectGoals.explicitGoalFound, true);
  assert.deepEqual(context.board.candidateTaskIds, ["RM-001", "TD-001", "RM-002"]);
  assert.deepEqual(context.board.inProgressTaskIds, ["RM-003"]);
  assert.equal(context.board.tasks.length, 5);
  assert.equal(context.board.tasks.find(({ id }) => id === "RM-004").readiness, "complete");
  assert.deepEqual(context.board.canonicalDependencies, [{ prerequisiteId: "TD-001", dependentId: "RM-001" }]);
  assert.equal(context.board.unapprovedSuggestionsIncluded, false);
  assert.deepEqual(context.currentView, {
    activeView: "graph",
    searchActive: true,
    filters: { status: ["Planned"], dependency: ["blocked"] },
    revealedTaskId: "RM-001",
    allTasksIncluded: true,
  });
  assert.ok(context.projectGoals.relevantSections.some(({ section }) => section === "Data flow"));
});

test("prioritizes project goals and includes agent success criteria and planning guidance", () => {
  const context = buildPlanningContext({
    board,
    documents: [
      {
        path: "docs/architecture.md",
        available: true,
        hash: "architecture-hash",
        contents: "# Architecture\n\n## Project Goal\nArchitecture description.",
      },
      {
        path: "docs/roadmap.md",
        available: true,
        hash: "roadmap-hash",
        contents: "# Roadmap\n\n## Goal\nRoadmap goal.",
      },
      {
        path: "README.md",
        available: true,
        hash: "readme-hash",
        contents: "# Example\n\n## Current Project Goal\nREADME goal.\n\n## Success Criteria\n- Users can verify results.",
      },
      {
        path: "AGENTS.md",
        available: true,
        hash: "agents-hash",
        contents: "# Project Goal\n\n## Primary Goal\nAgent goal.\n\n## Success Criteria\n- Analytics are reproducible.\n\n## Non-Goals\n- Do not provide financial advice.\n\n## Planning Principles\n- Prefer evidence over assumptions.",
      },
      { path: "frontend/README.md", available: false, hash: null, contents: "" },
    ],
  });

  assert.deepEqual(context.projectGoals.goalSourcePriority, [
    "AGENTS.md",
    "README.md",
    "docs/roadmap.md",
    "docs/architecture.md",
  ]);
  assert.deepEqual(context.sources.map(({ path }) => path), [
    "AGENTS.md",
    "README.md",
    "docs/roadmap.md",
    "docs/architecture.md",
    "frontend/README.md",
  ]);
  assert.deepEqual(context.projectGoals.explicitGoals.map(({ source, text }) => ({ source, text })), [
    { source: "AGENTS.md", text: "Agent goal." },
    { source: "README.md", text: "README goal." },
    { source: "docs/roadmap.md", text: "Roadmap goal." },
    { source: "docs/architecture.md", text: "Architecture description." },
  ]);
  assert.ok(context.projectGoals.relevantSections.some(({ source, section }) =>
    source === "AGENTS.md" && section === "Success Criteria"
  ));
  assert.ok(context.projectGoals.relevantSections.some(({ source, section }) =>
    source === "AGENTS.md" && section === "Non-Goals"
  ));
  assert.ok(context.projectGoals.relevantSections.some(({ source, section }) =>
    source === "AGENTS.md" && section === "Planning Principles"
  ));
});

test("reads root AGENTS.md as an optional planning source", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "project-kanban-planning-"));
  try {
    await mkdir(join(workspaceRoot, "docs"));
    await writeFile(join(workspaceRoot, "AGENTS.md"), "# Project Goal\n\n## Primary Goal\nA test goal.\n");
    await writeFile(join(workspaceRoot, "docs/architecture.md"), "# Architecture\n");
    await writeFile(join(workspaceRoot, "docs/roadmap.md"), "# Roadmap\n");

    const loadedDocuments = await readPlanningDocuments(workspaceRoot);
    assert.deepEqual(loadedDocuments.map(({ path, available }) => ({ path, available })), [
      { path: "AGENTS.md", available: true },
      { path: "README.md", available: false },
      { path: "docs/roadmap.md", available: true },
      { path: "docs/architecture.md", available: true },
      { path: "frontend/README.md", available: false },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports recorded dependency and project-goal coverage from canonical context", () => {
  const coverage = buildPlanningCoverage(createContext());
  assert.equal(coverage.totalTaskCount, 5);
  assert.equal(coverage.canonicalDependencyCount, 1);
  assert.equal(coverage.tasksWithRecordedDependencies, 1);
  assert.deepEqual(coverage.recordedDependencies, [{
    prerequisiteId: "TD-001",
    prerequisiteTitle: "Validate market data",
    dependentId: "RM-001",
    dependentTitle: "Build analytics",
  }]);
  assert.equal(coverage.explicitGoalFound, true);
  assert.deepEqual(coverage.explicitGoals, [{
    source: "docs/architecture.md",
    line: 3,
    text: "Support MSTR/BTC investors.",
  }]);
});

test("discloses missing explicit goals without promoting descriptions into goals", () => {
  const context = buildPlanningContext({
    board: { ...board, config: { ...board.config } },
    documents: documents.map((document) => document.path === "docs/architecture.md"
      ? { ...document, contents: "# Architecture\n\nWhat it is: A dashboard for market data." }
      : document),
  });

  assert.equal(context.projectGoals.explicitGoalFound, false);
  assert.deepEqual(context.projectGoals.explicitGoals, []);
  assert.deepEqual(context.projectGoals.descriptions, [{
    source: "docs/architecture.md",
    line: 3,
    text: "A dashboard for market data.",
  }]);
});

test("preserves expanded reasoning, multiple paths, and suggested edges without changing canonical dependencies", () => {
  const context = createContext();
  const plan = parsePlanningAnswer(validAnswer(), context);

  assert.equal(plan.recommendation.taskId, "RM-001");
  assert.equal(plan.recommendation.title, "Build analytics");
  assert.equal(plan.planningConfidence.level, "Medium");
  assert.match(plan.reasoning.whyRecommendation, /silently propagating bad inputs/);
  assert.equal(plan.reasoning.suggestedFirstStep.startsWith("Review current"), true);
  assert.equal(plan.alternativePaths.length, 2);
  assert.equal(plan.alternativePath.taskId, "RM-002");
  assert.equal(plan.implementationSequences[0].label, "Recommended Path");
  assert.equal(plan.implementationSequences[0].steps[0].taskId, "RM-001");
  assert.equal(plan.implementationSequences[0].steps[0].title, "Build analytics");
  assert.equal(plan.implementationSequences[1].label, "Data-first");
  assert.deepEqual(plan.implementationSequences[1].steps.map(({ taskId }) => taskId), ["TD-001", "RM-001"]);
  assert.equal(plan.implementationSequences[1].steps[0].confidence, "Medium");
  assert.equal(plan.reasoning.suggestedDependencies[0].dependentTaskTitle, "Explore a future layout");
  assert.equal(plan.reasoning.suggestedDependencies[0].prerequisiteTaskTitle, "Build analytics");
  assert.equal(context.board.canonicalDependencies.length, 1);
  assert.deepEqual(context.board.canonicalDependencies, [{ prerequisiteId: "TD-001", dependentId: "RM-001" }]);
});

test("rejects implementation sequences that invent tasks or do not match supported paths", () => {
  const context = createContext();
  const missingSequenceAnswer = JSON.parse(validAnswer());
  delete missingSequenceAnswer.implementationSequences;
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(missingSequenceAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const unknownTaskAnswer = JSON.parse(validAnswer());
  unknownTaskAnswer.implementationSequences[0].steps[0].taskId = "RM-999";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(unknownTaskAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const mismatchedStartAnswer = JSON.parse(validAnswer());
  mismatchedStartAnswer.implementationSequences[0].steps[0].taskId = "RM-002";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(mismatchedStartAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const unsupportedPathAnswer = JSON.parse(validAnswer());
  unsupportedPathAnswer.implementationSequences[1].label = "Architecture-first";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(unsupportedPathAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const repeatedTaskAnswer = JSON.parse(validAnswer());
  repeatedTaskAnswer.implementationSequences[1].steps[1].taskId = "TD-001";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(repeatedTaskAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );
  assert.deepEqual(context.board.canonicalDependencies, [{ prerequisiteId: "TD-001", dependentId: "RM-001" }]);
});

test("does not truncate long narrative fields or detailed lists", () => {
  const longText = "Reasoned evidence. ".repeat(600).trimEnd();
  const answer = JSON.parse(validAnswer());
  answer.reasoning.whyRecommendation = longText;
  answer.reasoning.evidence = Array.from({ length: 12 }, (_, index) => `Evidence ${index + 1}`);

  const plan = parsePlanningAnswer(JSON.stringify(answer), createContext());
  assert.equal(plan.reasoning.whyRecommendation, longText);
  assert.equal(plan.reasoning.evidence.length, 12);
});

test("rejects unknown task IDs and suggestions that duplicate canonical dependencies", () => {
  const context = createContext();
  assert.throws(
    () => parsePlanningAnswer(validAnswer("RM-003"), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const answer = JSON.parse(validAnswer());
  answer.reasoning.suggestedDependencies[0].dependentTaskId = "RM-001";
  answer.reasoning.suggestedDependencies[0].prerequisiteTaskId = "TD-001";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(answer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );
});

test("preserves malformed output and supports explicit no-recommendation responses", () => {
  const malformed = "not json";
  assert.throws(
    () => parsePlanningAnswer(malformed, createContext()),
    (error) => error instanceof PlanningError && error.rawAnswer === malformed,
  );

  const plan = parsePlanningAnswer(JSON.stringify({
    summary: "No task is defensible from the available evidence.",
    recommendation: null,
    noRecommendationReason: "The task records do not establish a safe next step.",
    planningConfidence: {
      level: "Low",
      rationale: "The available evidence does not establish a reliable ordering.",
    },
    reasoning: {
      whyRecommendation: "",
      whatItUnlocks: "",
      prerequisites: [],
      alternativesNotSelected: [],
      missingDependencyObservations: [],
      suggestedDependencies: [],
      assumptions: [],
      uncertainty: [],
      suggestedFirstStep: "",
      evidence: [],
    },
    alternativePaths: [],
    implementationSequences: [],
    risks: [],
  }), createContext());
  assert.equal(plan.recommendation, null);
  assert.equal(plan.planningConfidence.level, "Low");
  assert.equal(plan.alternativePaths.length, 0);
});

test("builds a planning-only prompt that preserves analysis and separates dependency judgment", () => {
  const prompt = buildNextWorkPrompt(createContext());
  assert.match(prompt, /Do not create or modify tasks or dependencies/);
  assert.match(prompt, /Canonical dependencies are only board\.canonicalDependencies/);
  assert.match(prompt, /Do not compress, paraphrase away, or omit relevant analysis/);
  assert.match(prompt, /alternativePaths/);
  assert.match(prompt, /implementationSequences/);
  assert.match(prompt, /sequence order is planning judgement only/);
  assert.match(prompt, /does not create Depends On entries, graph edges, blockers, readiness, or workflow analytics/);
  assert.match(prompt, /suggestedDependencies/);
  assert.match(prompt, /goalSourcePriority order: root AGENTS\.md, root README\.md, docs\/roadmap\.md, then docs\/architecture\.md/);
  assert.match(prompt, /AGENTS\.md goals, success criteria, non-goals, planning guidance, and constraints/);
});
