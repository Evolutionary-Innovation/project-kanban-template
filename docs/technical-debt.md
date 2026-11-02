# Technical Debt Register

Record known limitations, their impact, and the preferred remediation. Priority reflects delivery risk, not implementation effort.

## Register

### Deep dependency graph layouts

The secondary graph's pinned Dagre layout runs in a worker so layout does not block Kanban. Chromium verification covered the 60-task fixture and 250-task graphs (744 chain edges and 690 wide-rank edges). A synthetic 1,000-task/2,994-edge deep chain exceeds Dagre's browser call-stack limit. This is a topology-dependent limitation, not a supported fixed task-count ceiling.

The UI reports the failure explicitly and retains the fresh snapshot's accessible relationship list; users can return to Kanban without altering tasks. Do not silently truncate the graph or rewrite dependencies to avoid this failure. Reassess deeper-layout support, a newer engine, or ELK only against representative project demand and benchmarks. Shared graph filtering and focus mode remain Stage 2 work rather than an implicit fallback implemented here.

## Kanban tasks
<!-- project-kanban-schema:1 -->
| ID | Title | Status | Priority | Order | Area | Category | Details | Evidence | Limitation | Recommended Fix | Rationale | Recommendations | Depends On | Execution Type | Created Date | Completion Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-01 | Add automated recovery for abandoned lock files | Research | Low | 100 | Persistence | Reliability | The lock is removed in the normal transaction cleanup path. |  | A process crash can leave the exclusive lock file behind. | Design a safe, ownership-aware stale-lock recovery flow before implementing it. | Automatic deletion without proving lock ownership could allow concurrent writes. |  |  |  |  |  |
