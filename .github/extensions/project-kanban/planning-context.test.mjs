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

function routeStep(taskId, {
  contribution = "Advances the route outcome.",
  rationale = "This task contributes useful project progress.",
  relationshipKinds = [],
  recordedPrerequisiteIds = [],
} = {}) {
  return {
    taskId,
    contribution,
    rationale,
    benefit: "Improves the quality or delivery of the project.",
    unlocks: "Supports the next part of this route.",
    relationshipKinds,
    relationshipRationale: "This position is supported by the route strategy.",
    recordedPrerequisiteIds,
    evidence: [`${taskId} task record`],
    confidence: {
      level: "Medium",
      rationale: "The task description supports this contribution.",
    },
  };
}

function deliveryRoute({
  name = "Data-first analytics",
  recommended = true,
  steps = [
    routeStep("TD-001", { rationale: "Resolve data validation first." }),
    routeStep("RM-001", {
      rationale: "Build analytics after data validation.",
      relationshipKinds: ["recorded_prerequisite"],
      recordedPrerequisiteIds: ["TD-001"],
    }),
    routeStep("RM-002", {
      rationale: "Extend the capability after core analytics.",
      relationshipKinds: ["strategic_ordering"],
    }),
  ],
} = {}) {
  return {
    name,
    recommended,
    intendedOutcome: "Deliver reliable investor analytics with an evidence-based progression.",
    goalAlignment: "Advances the project goal of trustworthy MSTR/BTC decision support.",
    goalEvidence: ["docs/architecture.md: Project Goal"],
    strategyRationale: "Resolve a relevant prerequisite, then build and extend analytics.",
    evidence: ["TD-001", "RM-001", "RM-002", "docs/architecture.md"],
    tradeoffs: ["Delays a broader workspace redesign."],
    assumptions: ["The current market-data boundary remains usable."],
    risks: ["Data validation may reveal further issues."],
    stoppingPoint: "Stop after the initial analytics slice before planning a new capability.",
    confidence: {
      level: "Medium",
      rationale: "Task descriptions support the route, but do not define every acceptance criterion.",
    },
    externalPrerequisites: [],
    unresolvedPrerequisites: [],
    steps,
  };
}

function validAnswer(recommendationId = "TD-001") {
  return JSON.stringify({
    summary: "Validate data, build analytics, then extend the investor capability.",
    recommendation: {
      taskId: recommendationId,
      whyNow: "It protects downstream calculations.",
      unlocks: "Reliable analytics work.",
      confidence: "High",
      confidenceRationale: "The task is the first step of a supported multi-task route.",
    },
    noRecommendationReason: "",
    planningConfidence: {
      level: "Medium",
      rationale: "One dependency is recorded, but narrative coverage is incomplete.",
    },
    reasoning: {
      whyRecommendation: "Data validation is the strongest starting point for the route.\n\nIt protects future calculations from silently propagating bad inputs.",
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
    routeAssessment: {
      status: "routes_identified",
      explanation: "The task and goal context supports one coherent three-step route.",
    },
    deliveryRoutes: [
      deliveryRoute(),
      deliveryRoute({
        name: "Lean data-to-workspace path",
        recommended: false,
        steps: [
          routeStep("TD-001", { rationale: "Resolve the data concern first." }),
          routeStep("RM-002", {
            rationale: "Apply the result to the next workspace capability.",
            relationshipKinds: ["practical_enablement", "strategic_ordering"],
          }),
        ],
      }),
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

test("preserves expanded reasoning and multi-task routes without changing canonical dependencies", () => {
  const context = createContext();
  const plan = parsePlanningAnswer(validAnswer(), context);

  assert.equal(plan.recommendation.taskId, "TD-001");
  assert.equal(plan.recommendation.title, "Validate market data");
  assert.equal(plan.planningConfidence.level, "Medium");
  assert.match(plan.reasoning.whyRecommendation, /silently propagating bad inputs/);
  assert.equal(plan.reasoning.suggestedFirstStep.startsWith("Review current"), true);
  assert.equal(plan.routeAssessment.status, "routes_identified");
  assert.equal(plan.deliveryRoutes.length, 2);
  assert.equal(plan.deliveryRoutes[0].recommended, true);
  assert.deepEqual(plan.deliveryRoutes[0].steps.map(({ taskId }) => taskId), ["TD-001", "RM-001", "RM-002"]);
  assert.equal(plan.deliveryRoutes[0].steps[0].title, "Validate market data");
  assert.deepEqual(plan.deliveryRoutes[0].steps[1].recordedPrerequisiteIds, ["TD-001"]);
  assert.deepEqual(plan.deliveryRoutes[0].steps[1].relationshipKinds, ["recorded_prerequisite"]);
  assert.deepEqual(plan.deliveryRoutes[1].steps.map(({ taskId }) => taskId), ["TD-001", "RM-002"]);
  assert.equal(plan.reasoning.suggestedDependencies[0].dependentTaskTitle, "Explore a future layout");
  assert.equal(plan.reasoning.suggestedDependencies[0].prerequisiteTaskTitle, "Build analytics");
  assert.equal(context.board.canonicalDependencies.length, 1);
  assert.deepEqual(context.board.canonicalDependencies, [{ prerequisiteId: "TD-001", dependentId: "RM-001" }]);
});

test("rejects routes that invent tasks or conflict with their recommendation", () => {
  const context = createContext();
  const missingRouteAnswer = JSON.parse(validAnswer());
  delete missingRouteAnswer.deliveryRoutes;
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(missingRouteAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const unknownTaskAnswer = JSON.parse(validAnswer());
  unknownTaskAnswer.deliveryRoutes[0].steps[0].taskId = "RM-999";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(unknownTaskAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const mismatchedStartAnswer = JSON.parse(validAnswer());
  mismatchedStartAnswer.deliveryRoutes[0].steps[0].taskId = "RM-002";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(mismatchedStartAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const multipleRecommendedRoutesAnswer = JSON.parse(validAnswer());
  multipleRecommendedRoutesAnswer.deliveryRoutes[1].recommended = true;
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(multipleRecommendedRoutesAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const reversedPrerequisiteAnswer = JSON.parse(validAnswer());
  reversedPrerequisiteAnswer.deliveryRoutes[0].steps[1].taskId = "RM-002";
  reversedPrerequisiteAnswer.deliveryRoutes[0].steps[2].taskId = "RM-001";
  reversedPrerequisiteAnswer.deliveryRoutes[0].steps[2].relationshipKinds = ["strategic_ordering"];
  reversedPrerequisiteAnswer.deliveryRoutes[0].steps[2].recordedPrerequisiteIds = ["TD-001"];
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(reversedPrerequisiteAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const shortRouteAnswer = JSON.parse(validAnswer());
  shortRouteAnswer.routeAssessment.status = "limited_route";
  shortRouteAnswer.deliveryRoutes[0].steps.pop();
  shortRouteAnswer.deliveryRoutes[0].steps.pop();
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(shortRouteAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const missingPrerequisiteAnswer = JSON.parse(validAnswer());
  missingPrerequisiteAnswer.deliveryRoutes[0].steps[1].recordedPrerequisiteIds = [];
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(missingPrerequisiteAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  const duplicateTaskAnswer = JSON.parse(validAnswer());
  duplicateTaskAnswer.deliveryRoutes[1].steps[1].taskId = "TD-001";
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(duplicateTaskAnswer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );

  assert.deepEqual(context.board.canonicalDependencies, [{ prerequisiteId: "TD-001", dependentId: "RM-001" }]);
});

test("supports an evidence-limited recommendation without inventing a delivery route", () => {
  const answer = JSON.parse(validAnswer());
  answer.routeAssessment = {
    status: "insufficient_evidence",
    explanation: "The context supports a next task but not a defensible multi-task route.",
  };
  answer.deliveryRoutes = [];

  const plan = parsePlanningAnswer(JSON.stringify(answer), createContext());
  assert.equal(plan.recommendation.taskId, "TD-001");
  assert.equal(plan.routeAssessment.status, "insufficient_evidence");
  assert.deepEqual(plan.deliveryRoutes, []);
});

test("requires unfinished recorded prerequisites outside a route to be disclosed", () => {
  const context = createContext();
  const answer = JSON.parse(validAnswer("RM-001"));
  answer.routeAssessment = {
    status: "limited_route",
    explanation: "Only a short analytics progression is supported.",
  };
  answer.deliveryRoutes = [
    deliveryRoute({
      name: "Analytics-first",
      steps: [
        routeStep("RM-001", {
          rationale: "Begin the selected analytics work while tracking its outstanding prerequisite.",
          recordedPrerequisiteIds: ["TD-001"],
        }),
        routeStep("RM-002", {
          rationale: "Continue with an adjacent capability after the analytics slice.",
          relationshipKinds: ["strategic_ordering"],
        }),
      ],
    }),
  ];
  answer.deliveryRoutes[0].externalPrerequisites = [{
    taskId: "TD-001",
    rationale: "The analytics task has a recorded data-validation prerequisite.",
    condition: "Complete or explicitly resolve data validation before relying on analytics results.",
  }];

  const plan = parsePlanningAnswer(JSON.stringify(answer), context);
  assert.equal(plan.deliveryRoutes[0].externalPrerequisites[0].taskId, "TD-001");

  answer.deliveryRoutes[0].externalPrerequisites = [];
  assert.throws(
    () => parsePlanningAnswer(JSON.stringify(answer), context),
    (error) => error instanceof PlanningError && error.code === "planning_response_invalid",
  );
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
    routeAssessment: {
      status: "insufficient_evidence",
      explanation: "There is not enough task or goal evidence to support a delivery route.",
    },
    deliveryRoutes: [],
    risks: [],
  }), createContext());
  assert.equal(plan.recommendation, null);
  assert.equal(plan.planningConfidence.level, "Low");
  assert.equal(plan.deliveryRoutes.length, 0);
});

test("builds a planning-only prompt that preserves analysis and separates dependency judgment", () => {
  const prompt = buildNextWorkPrompt(createContext());
  assert.match(prompt, /Do not create or modify tasks or dependencies/);
  assert.match(prompt, /Canonical dependencies are only board\.canonicalDependencies/);
  assert.match(prompt, /Do not compress, paraphrase away, or omit relevant analysis/);
  assert.match(prompt, /coherent delivery routes exist through the next phase/);
  assert.match(prompt, /deliveryRoutes/);
  assert.match(prompt, /strategic ordering are planning judgement only/);
  assert.match(prompt, /do not create Depends On entries, graph edges, blockers, readiness, or workflow analytics/);
  assert.match(prompt, /suggestedDependencies/);
  assert.match(prompt, /goalSourcePriority order: root AGENTS\.md, root README\.md, docs\/roadmap\.md, then docs\/architecture\.md/);
  assert.match(prompt, /AGENTS\.md goals, success criteria, non-goals, planning guidance, and constraints/);
});
