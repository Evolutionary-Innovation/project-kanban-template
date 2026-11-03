# Project Kanban Template Roadmap

The template's task state is maintained in the table below. See [architecture](architecture.md), [decisions](decisions.md), and [technical debt](technical-debt.md) for supporting context.

## Completed

- Markdown-backed board with source revisions, exclusive locking, and atomic replacement.
- Example configuration and independent fixture project.
- Search, multi-select shared filters with removable chips, per-column view sorting, card collapse, and a visible status footer; UX checks use an isolated synthetic project.
- Configured completion dates and per-source non-reusable ID sequences, persisted through the existing Markdown transaction; status transitions override supplied dates, preserve unknown historical blanks, and are covered across edit, move, and HTTP paths.
- A secondary read-only dependency graph with shared filters, explicit dependency-neighbourhood focus/expansion, board linking, graph-launched editing through the existing editor, cycle/unresolved warnings, zoom controls and an accessible relationship list.
- Derived workflow intelligence for dependency readiness, blocked work, unresolved/cycle diagnostics, unique downstream impact, and the longest unweighted dependency chain. No schema or execution automation was added.

## Kanban tasks
<!-- project-kanban-schema:1 -->
| ID | Title | Status | Priority | Order | Area | Category | Details | Evidence | Limitation | Recommended Fix | Rationale | Recommendations | Depends On | Execution Type | Created Date | Completion Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RM-001 | Add installation checks for additional Copilot hosts | In Progress | High | 100 | Compatibility | Roadmap | Verify workspace extension loading behavior against supported host contracts. |  |  |  |  |  |  |  |  |  |
| RM-002 | Add optional task-field display preferences | Future Ideas | Low | 200 | User experience | Roadmap | Consider only if real projects need per-field card summaries. |  |  |  |  |  |  |  |  |  |
| RM-003 | Implement deterministic dependency suggestions | Complete | High | 200 | Workflow | Roadmap | Detect exact task IDs paired with explicit dependency phrases in configured narrative fields; present review suggestions separately from canonical dependencies and verify graph integrity. |  |  |  |  |  |  |  | 2026-11-03 | 2026-11-03 |
<!-- project-kanban-id-sequence:RM:4 -->
