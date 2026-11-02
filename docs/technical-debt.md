# Technical Debt Register

Record known limitations, their impact, and the preferred remediation. Priority reflects delivery risk, not implementation effort.

## Register

## Kanban tasks
<!-- project-kanban-schema:1 -->
| ID | Title | Status | Priority | Order | Area | Category | Details | Limitation | Recommended Fix | Rationale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-01 | Add automated recovery for abandoned lock files | Research | Low | 100 | Persistence | Reliability | The lock is removed in the normal transaction cleanup path. | A process crash can leave the exclusive lock file behind. | Design a safe, ownership-aware stale-lock recovery flow before implementing it. | Automatic deletion without proving lock ownership could allow concurrent writes. |
