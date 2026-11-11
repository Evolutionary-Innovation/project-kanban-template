import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBoardConfig } from "./board-config.mjs";

const standardFields = [
  { key: "evidence", label: "Evidence", type: "textarea" },
  { key: "limitation", label: "Limitation", type: "textarea" },
  { key: "recommendedFix", label: "Recommended Fix", type: "textarea" },
  { key: "rationale", label: "Rationale", type: "textarea" },
  { key: "recommendations", label: "Recommendations", type: "textarea" },
  { key: "dependsOn", label: "Depends On", type: "task-ids" },
  { key: "executionType", label: "Execution Type", type: "text", choices: ["Human", "AI"] },
  { key: "createdDate", label: "Created Date", type: "date" },
  { key: "completionDate", label: "Completion Date", type: "date" },
];

function source(key, label, path, idPrefix, idWidth, category, categoryTone, extraFields = standardFields) {
  return { key, label, path, idPrefix, idWidth, category, categoryTone, extraFields };
}

export function testConfig() {
  return {
    configVersion: 1,
    projectName: "Generic Contract Fixture",
    boardTitle: "Contract Test Board",
    schemaMarker: "<!-- contract-test-schema:1 -->",
    statuses: ["Complete", "In Progress", "Planned", "Research", "Future Ideas"],
    priorities: [
      { name: "High", tone: "high" },
      { name: "Medium", tone: "medium" },
      { name: "Low", tone: "low" },
    ],
    defaultStatus: "Planned",
    completionStatus: "Complete",
    sources: [
      source("roadmap", "Plan", "planning/items.md", "RM", 3, "Plan", "blue"),
      source("technicalDebt", "Risk", "quality/risks.md", "TD", 2, "Risk", "purple"),
      source("repositoryAudit", "Audit", "review/findings.md", "RA", 3, "Audit", "green"),
    ],
  };
}

export function independentTestConfig() {
  const experimentFields = [
    { key: "hypothesis", label: "Hypothesis", type: "textarea", required: true },
    { key: "dependsOn", label: "Depends On", type: "task-ids" },
    { key: "createdDate", label: "Created Date", type: "date" },
    { key: "completionDate", label: "Completion Date", type: "date" },
  ];
  return {
    configVersion: 1,
    projectName: "Independent Contract Fixture",
    boardTitle: "Independent Test Board",
    schemaMarker: "<!-- independent-test-schema:1 -->",
    statuses: ["Open", "Doing", "Done"],
    priorities: [
      { name: "Urgent", tone: "high" },
      { name: "Standard", tone: "medium" },
      { name: "Low", tone: "low" },
    ],
    defaultStatus: "Open",
    completionStatus: "Done",
    sources: [
      source("plans", "Plan", "planning/plans.md", "PLAN", 3, "Plan", "blue", [
        { key: "dependsOn", label: "Depends On", type: "task-ids" },
        { key: "createdDate", label: "Created Date", type: "date" },
        { key: "completionDate", label: "Completion Date", type: "date" },
      ]),
      source("experiments", "Experiment", "research/experiments.md", "EXP", 3, "Experiment", "green", experimentFields),
    ],
  };
}

function rowsFor(config, sourceConfig) {
  const values = (id, title, status, priority, order, area, details, extra = {}) => ({
    id,
    title,
    status,
    priority,
    order,
    area,
    category: sourceConfig.category,
    details,
    ...extra,
  });

  if (sourceConfig.key === "plans" || sourceConfig.key === "experiments") {
    return sourceConfig.key === "plans"
      ? [values("PLAN-001", "Review the planning workflow", "Doing", "Urgent", 100, "Planning", "A portable plan record.")]
      : [values("EXP-001", "Test a weekly review", "Open", "Standard", 100, "Research", "A portable experiment.", {
        hypothesis: "A weekly review will reduce missed follow-ups.",
        dependsOn: "PLAN-001",
      })];
  }

  switch (sourceConfig.key) {
    case "roadmap":
      return [
        values("RM-001", "Generic plan one", "Planned", "High", 100, "Delivery", "A generic contract record."),
        values("RM-002", "Generic plan two", "In Progress", "Medium", 200, "Reliability", "A second generic record."),
        values("RM-003", "Generic plan three", "Planned", "Low", 300, "Documentation", "A third generic record."),
      ];
    case "technicalDebt":
      return [values("TD-01", "Generic risk one", "Research", "Medium", 100, "Reliability", "A generic risk record.")];
    case "repositoryAudit":
      return [values("RA-001", "Generic audit one", "Complete", "Low", 100, "Quality", "A generic audit record.", {
        completionDate: "2026-10-05",
      })];
    default:
      throw new TypeError(`No test rows are defined for source "${sourceConfig.key}".`);
  }
}

function markdownFor(config, sourceConfig, rows) {
  const columns = [
    ["id", "ID"],
    ["title", "Title"],
    ["status", "Status"],
    ["priority", "Priority"],
    ["order", "Order"],
    ["area", "Area"],
    ["category", "Category"],
    ["details", "Details"],
    ["acceptanceCriteria", "Acceptance Criteria"],
    ...sourceConfig.extraFields.map(({ key, label }) => [key, label]),
  ];
  const line = (values) => `| ${values.map((value) => String(value ?? "").replaceAll("|", "\\|")).join(" | ")} |`;
  const narrative = sourceConfig.key === "experiments"
    ? "Use the Hypothesis field to record the test assumption."
    : "The fixture narrative is preserved outside the task table.";
  return [
    `# ${sourceConfig.label}`,
    "",
    "## Context",
    narrative,
    "",
    "## Kanban tasks",
    config.schemaMarker,
    line(columns.map(([, label]) => label)),
    line(columns.map(() => "---")),
    ...rows.map((row) => line(columns.map(([key]) => row[key]))),
    "",
  ].join("\n");
}

export function testDocuments(config = testConfig()) {
  return Object.fromEntries(config.sources.map((sourceConfig) => [
    sourceConfig.path,
    markdownFor(config, sourceConfig, rowsFor(config, sourceConfig)),
  ]));
}

export async function createTestWorkspace(t, config = testConfig()) {
  const root = await mkdtemp(join(tmpdir(), "project-kanban-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "project-kanban.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  for (const [path, content] of Object.entries(testDocuments(config))) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { root, config: await readBoardConfig(root) };
}
