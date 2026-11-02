import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createTaskInDocuments,
  editTaskInDocuments,
  readBoardSnapshot,
} from "./board-storage.mjs";
import { readBoardConfig } from "./board-config.mjs";

const roadmap = `# Roadmap
## Completed
**Dashboard**
- The dashboard loads its data.
## Next
1. **Tests for pure libraries** (\`metrics.ts\`, \`kpis.ts\`).
## Future
- **Data pipeline:** automate daily ingestion.
`;

const technicalDebt = `# Technical Debt Register
## Register
| ID | Severity | Area | Limitation | Recommended fix | Rationale |
|---|---|---|---|---|---|
| TD-02 | Medium | Testing | Some tests are missing. | Add unit tests for pure libraries. | Regressions may be silent. |
`;

const repositoryAudit = `# Repository Audit
## Recommendations
Recommendations require current-state verification before action.
`;

test("supports mixed canonical and Trade-MSTR legacy sources, including legacy audit IDs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "project-kanban-legacy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const docs = join(root, "docs");
  await mkdir(docs, { recursive: true });
  const config = {
    configVersion: 1,
    projectName: "Legacy Compatibility Test",
    boardTitle: "Project Kanban",
    schemaMarker: "<!-- trade-mstr-kanban-schema:1 -->",
    statuses: ["Complete", "In Progress", "Planned", "Research", "Future Ideas"],
    priorities: [
      { name: "High", tone: "high" },
      { name: "Medium", tone: "medium" },
      { name: "Low", tone: "low" },
    ],
    defaultStatus: "Planned",
    sources: [
      {
        key: "roadmap",
        label: "Roadmap Item",
        path: "docs/roadmap.md",
        idPrefix: "RM",
        idWidth: 3,
        category: "Roadmap",
        categoryTone: "blue",
        legacyAdapter: "trade-mstr-v1",
        extraFields: [],
      },
      {
        key: "technicalDebt",
        label: "Technical Debt",
        path: "docs/technical-debt.md",
        idPrefix: "TD",
        idWidth: 2,
        category: "Technical Debt",
        categoryTone: "purple",
        legacyAdapter: "trade-mstr-v1",
        extraFields: [
          { key: "limitation", label: "Limitation", type: "textarea" },
          { key: "recommendedFix", label: "Recommended Fix", type: "textarea" },
          { key: "rationale", label: "Rationale", type: "textarea" },
        ],
      },
      {
        key: "repositoryAudit",
        label: "Research/Audit Item",
        path: "docs/repository-audit.md",
        idPrefix: "RA",
        idWidth: 3,
        category: "Research/Audit",
        categoryTone: "green",
        legacyAdapter: "trade-mstr-v1",
        legacyIdPrefixes: ["TD"],
        extraFields: [],
      },
    ],
  };
  await writeFile(join(root, "project-kanban.config.json"), JSON.stringify(config, null, 2));
  await Promise.all([
    writeFile(join(docs, "roadmap.md"), roadmap),
    writeFile(join(docs, "technical-debt.md"), technicalDebt),
    writeFile(join(docs, "repository-audit.md"), repositoryAudit),
  ]);
  const boardConfig = await readBoardConfig(root);
  const initial = await readBoardSnapshot(root, boardConfig);
  assert.ok(initial.tasks.some(({ id, source }) => id === "TD-20" && source.document === "docs/repository-audit.md"));

  const created = await createTaskInDocuments(root, boardConfig, {
    sourceType: "repositoryAudit",
    task: {
      title: "Track an audit follow-up",
      area: "Repository",
      priority: "Low",
      status: "Planned",
      details: "Keep the original recommendation narrative.",
    },
    revisions: initial.revisions,
  });
  assert.ok(created.tasks.some(({ id }) => id === "RA-001"));
  assert.ok(created.tasks.some(({ id }) => id === "TD-20"));
  assert.ok(created.tasks.some(({ id }) => id === "TD-02"));

  const edited = await editTaskInDocuments(root, boardConfig, {
    taskId: "TD-20",
    updates: { status: "In Progress", priority: "High" },
    revisions: created.revisions,
  });
  const auditTask = edited.tasks.find(({ id }) => id === "TD-20");
  assert.equal(auditTask.status, "In Progress");
  assert.equal(auditTask.priority, "High");
  const auditText = await readFile(join(docs, "repository-audit.md"), "utf8");
  assert.match(auditText, /Recommendations require current-state verification before action/);
  assert.match(auditText, /\| TD-20 \|/);
  assert.match(auditText, /\| RA-001 \|/);
});
