# Technical Debt Register

Record known limitations, their impact, and the preferred remediation. Priority reflects delivery risk, not implementation effort.

## Register

### Deep dependency graph layouts

The secondary graph's pinned Dagre layout runs in a worker so layout does not block Kanban. Chromium verification covered the 60-task fixture and 250-task graphs (744 chain edges and 690 wide-rank edges). A synthetic 1,000-task/2,994-edge deep chain exceeds Dagre's browser call-stack limit. This is a topology-dependent limitation, not a supported fixed task-count ceiling.

The UI reports the failure explicitly and retains the fresh snapshot's accessible relationship list; users can return to Kanban without altering tasks. Do not silently truncate the graph or rewrite dependencies to avoid this failure. Reassess deeper-layout support, a newer engine, or ELK only against representative project demand and benchmarks. Shared graph filtering and focus mode are implemented in Stage 2; they do not bypass the layout limit.

### Dense graph navigation

The graph supports direct pan, zoom-to-selection, pointer-anchored wheel zoom, and focus/whole-project controls, but has no minimap or viewport locator. The 60-task synthetic graph is navigable, though users must reorient with fit, focus, and manual pan when moving between distant regions. Consider a lightweight overview only if representative Trade-MSTR boards show this remains a usability burden; preserve the accessible task list and keyboard controls.

### Duration-based critical path

The schema has no task-duration estimates, so workflow intelligence can show only an unweighted longest dependency chain. Do not label it as a schedule critical path. Add duration fields or scheduling constraints only after a separate schema and migration decision based on real project needs.

## Kanban tasks
<!-- project-kanban-schema:1 -->
| ID | Title | Status | Priority | Order | Area | Category | Details | Evidence | Limitation | Recommended Fix | Rationale | Recommendations | Depends On | Execution Type | Created Date | Completion Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-01 | Add automated recovery for abandoned lock files | Research | Low | 100 | Persistence | Reliability | The lock is removed in the normal transaction cleanup path. |  | A process crash can leave the exclusive lock file behind. | Design a safe, ownership-aware stale-lock recovery flow before implementing it. | Automatic deletion without proving lock ownership could allow concurrent writes. |  |  |  |  |  |
