import assert from "node:assert/strict";
import test from "node:test";
import { validateBoardConfig } from "../../board-config.mjs";
import { migrateLegacyMarkdown, parseBoardDocuments } from "../../board-data.mjs";
import { testConfig } from "../../test-fixtures.mjs";

test("adds configured lifecycle fields while migrating legacy sources", () => {
  const rawConfig = testConfig();
  rawConfig.schemaMarker = "<!-- trade-mstr-kanban-schema:1 -->";
  for (const source of rawConfig.sources) {
    source.path = ({
      roadmap: "docs/roadmap.md",
      technicalDebt: "docs/technical-debt.md",
      repositoryAudit: "docs/repository-audit.md",
    })[source.key];
    source.legacyAdapter = "trade-mstr-v1";
    source.extraFields = [
      { key: "createdDate", label: "Created Date", type: "date" },
      { key: "completionDate", label: "Completion Date", type: "date" },
    ];
  }
  rawConfig.sources[2].legacyIdPrefixes = ["TD"];
  const config = validateBoardConfig(rawConfig);
  const documents = {
    "docs/roadmap.md": `# Roadmap
## Completed
**Dashboard**
- The dashboard loads its data.
## Next
1. **Tests for pure libraries** (\`metrics.ts\`, \`kpis.ts\`).
## Future
- **Data pipeline:** automate daily ingestion.
`,
    "docs/technical-debt.md": `# Technical Debt Register
## Register
| ID | Severity | Area | Limitation | Recommended fix | Rationale |
|---|---|---|---|---|---|
| TD-02 | Medium | Testing | Some tests are missing. | Add unit tests for pure libraries. | Regressions may be silent. |
## Closed: TD-19 - Moving averages restarted warm-up at the display boundary
The closed task details must remain available.
`,
    "docs/repository-audit.md": `# Repository Audit
## Recommendations
Recommendations require current-state verification before action.
`,
  };
  const board = parseBoardDocuments(documents, config);
  assert.ok(board.tasks.every(({ createdDate, completionDate }) => createdDate === "" && completionDate === ""));

  const migrated = Object.fromEntries(
    config.sources.map((source) => [
      source.path,
      migrateLegacyMarkdown(
        documents[source.path],
        source,
        board.tasks.filter(({ source: taskSource }) => taskSource.document === source.path),
        config,
      ),
    ]),
  );
  assert.match(migrated["docs/roadmap.md"], /\| Completion Date \|/);
  assert.match(migrated["docs/roadmap.md"], /\| Created Date \|/);
  assert.ok(parseBoardDocuments(migrated, config).tasks.every(({ createdDate, completionDate }) => createdDate === "" && completionDate === ""));
});
