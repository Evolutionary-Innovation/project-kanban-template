# Architectural Decisions

Record significant decisions. Do not use this log as a task list; link to the owning roadmap or debt task.

## ADR-01: Keep board views ephemeral and Markdown order canonical

- **Status:** Accepted
- **Observations:** Search, filters, collapse state, and independent sorts are presentation preferences. The task table already owns canonical `Order`, and writes are protected by revisions and a single-source transaction.
- **Assumptions:** A canvas session may reset view preferences when the host closes it; users can return a column to Manual to see canonical order.
- **Alternatives considered:** Persist view preferences in Markdown, add a browser-storage database, or move matching cards into a separate search-results column.
- **Decision:** Keep search, filters, collapse state, and per-column sort in browser memory. Filter each status column in place, keep sorts view-only, and disable manual reordering whenever the visible card set/order differs from canonical order.
- **Consequences:** No schema migration or extra persistence is needed for these controls. Users can inspect the visible/total counts and clear filters to restore the full canonical view.

## ADR-02: Isolate synthetic browser-test records

- **Status:** Accepted
- **Observations:** Root Markdown registers are authoritative project data, while generic extension contracts must run independently of any repository's task rows or example paths. Browser UX checks need a larger, repeatable dataset.
- **Assumptions:** Generic contract tests can generate deterministic schema-v1 workspaces in temporary directories, and a fixture-specific local server can root browser writes within the synthetic project.
- **Alternatives considered:** Read live root registers, add fictional entries to canonical task documents, create browser-only mocks, or make consumers depend on Template examples.
- **Decision:** Use generated temporary workspaces for generic contracts; keep Template sample and synthetic-project integration tests separate; run browser/UX checks only against the isolated 60-record synthetic project. Consumer smoke tests must copy configured sources into a temporary workspace before writes. Consumer-owned migration checks remain outside the generic suite.
- **Consequences:** Generic tests validate reusable behavior without project data. Template integration retains real parser/config coverage, consumer smoke validates source wiring without mutating consumer documents, and the synthetic fixture remains dedicated to Template browser verification. Any consumer-owned migration tests remain separate from the generic suite.

## ADR-03: Keep per-source task ID high-water marks in Markdown

- **Status:** Accepted
- **Observations:** Deriving the next ID from active rows reuses the deleted maximum. Markdown remains the source of truth, and writes already use a locked, revision-checked, atomic single-source transaction.
- **Assumptions:** A comment outside the schema-v1 table is acceptable metadata and can be preserved with the task source. Existing projects may have deleted IDs that cannot be inferred from active rows.
- **Alternatives considered:** Add a separate sequence file or database, change the task-table schema, or keep deriving IDs from active tasks.
- **Decision:** Store one validated `project-kanban-id-sequence` comment per source document. Initialize it from the highest active configured-prefix ID on the first write, preserve it on edits/deletes, and advance it atomically when creating a task.
- **Consequences:** Task-table schema v1 and Markdown ownership remain unchanged. Projects with historical deletions must manually bootstrap the marker to a value above the highest-ever allocated ID before relying on non-reuse.

## ADR-04: Configure lifecycle dates as schema-v1 date fields

- **Status:** Accepted
- **Observations:** Source-specific fields already support project customization, and view sorting can remain separate from canonical Markdown order. Status names vary between projects. Creation and completion dates describe different events and must not overwrite one another.
- **Assumptions:** Each project can identify its completion status; unsupported historical dates must remain unknown rather than be inferred.
- **Alternatives considered:** Bump the task-table schema version, infer completion from a hard-coded status label, or store dates in browser state.
- **Decision:** Keep `createdDate` and `completionDate` as independent, configured `date` extra fields on each source, and optionally configure `completionStatus`. Populate Created Date when configured on creation. Populate Completion Date on creation in the completion status or every transition into it (latest completion wins), retain it on reopen, and allow manual corrections. Do not infer historical dates.
- **Consequences:** Schema v1 and Markdown persistence remain intact. Existing projects add the desired date fields to their configs and table headers; historical dates remain blank unless supported by evidence. Date changes use the existing revision-checked, locked, atomic write.

## ADR-05: Store prerequisite links once and derive workflow projections

- **Status:** Accepted
- **Observations:** Tasks are owned by separate Markdown sources, IDs are stable and project-configured, and writes already reread all sources under one revision-checked lock. Persisting both `Depends On` and `Blocked By` would duplicate relationship state and make cross-file edits fragile.
- **Assumptions:** A dependency can reference a task that has not been created yet, and projects may use ID prefixes, statuses, and source paths other than RM/TD/RA.
- **Alternatives considered:** Store reciprocal blocker values, require every reference to resolve immediately, reject a board with any historical cycle, or add a task database/graph store.
- **Decision:** Store only comma-separated task IDs in optional `Depends On` fields. Validate syntax, configured prefixes, duplicates, self-links, and cycles introduced by edits. Keep unresolved links visible. Derive incomplete/unresolved `Blocked By` values and a graph-ready projection with prerequisite-to-dependent edges. Flag existing cycles without making the source unreadable.
- **Consequences:** Dependency edits use the existing all-source locked snapshot and persist only the edited task's owning Markdown file. Schema v1 remains the persistence contract; older tables load missing optional fields as blank and normalize on the next write. The graph projection can support a later DAG view without introducing a second relationship model.

## ADR-06: Keep execution type descriptive

- **Status:** Accepted
- **Observations:** Future agent workflows must remain independent of model, provider, and harness churn. A status change is currently a user-controlled Markdown mutation.
- **Assumptions:** Teams benefit from a compact indication of whether work is human-led, AI-assisted, or needs a decision, without authorizing automation.
- **Alternatives considered:** Embed model/provider names, automatically claim tasks on In Progress, or execute work on a status transition.
- **Decision:** Configure `Execution Type` as optional choice metadata only. It does not claim tasks, launch agents, alter dependencies, or trigger status changes.
- **Consequences:** Metadata remains portable across execution tools. Automated task execution requires a separately reviewed workflow and conflict/authorization design.

## ADR-07: Keep dependency visualisation secondary, local and read-only

- **Status:** Accepted
- **Observations:** The snapshot already contains stable task nodes, prerequisite-to-dependent edges and diagnostics. SVG rendering is simple, but robust directed layout and cycle placement would add substantial custom algorithm maintenance. Larger synthetic layouts produce noticeable synchronous computation.
- **Assumptions:** Kanban remains the primary editing view; users benefit from a whole-project overview including isolated tasks, with an accessible text alternative. No graph interaction authorizes work.
- **Alternatives considered:** Handwritten DAG layout, custom force simulation, D3, Plotly, ELK.js and a graph framework. Force layouts obscure execution direction; chart/framework dependencies add unnecessary UI/runtime scope; handwritten layout would duplicate mature algorithms.
- **Decision:** Render native SVG and HTML using a pinned MIT-licensed `@dagrejs/dagre` standalone distribution served locally in a same-origin module worker. Preserve original link directions and existing blocker/cycle facts. Keep task selection, zoom, metadata grouping and cached coordinates ephemeral; do not persist a graph, layout or new fields. Area/Category grouping uses explicit metadata regions, with cross-region dependencies retained as dashed routed edges. Pin provenance/checksums and both Dagre/graphlib licence notices, and retain offline template-copy operation.
- **Consequences:** The graph remains read-only except for launching the existing task editor; board filters, focus and cross-view navigation are shared through ephemeral client state. Graph clients/assets load lazily, and layout workers terminate after work or cancellation. Claims and execution remain outside the architecture. Performance remains bounded by graph topology and SVG rendering even with worker-based layout.

## ADR-08: Derive workflow intelligence without task automation

- **Status:** Accepted
- **Observations:** The current snapshot already derives completion, blockers, unresolved references, cycles and directed dependency edges. It does not contain duration estimates or execution authorization.
- **Assumptions:** Teams benefit from dependency-readiness and impact information while Markdown statuses remain manually controlled.
- **Alternatives considered:** Persist a Ready status, infer a time-based critical path without duration data, or trigger agents from readiness.
- **Decision:** Derive advisory readiness, blocked-work counts, unresolved/cycle counts, unique downstream impact and an unweighted longest dependency chain from each snapshot. Exclude completed tasks from readiness counts and cycle tasks from the longest-chain calculation. Describe the chain as structural, not a schedule critical path.
- **Consequences:** No schema, persistence, status transition, claim, or execution path is added. Future agent execution requires a separate authorization and conflict design.

## ADR-09: Keep multi-select filters shared and ephemeral

- **Status:** Accepted
- **Observations:** The Kanban board and dependency graph already share one in-memory filter state, but native single-value selects limit comparisons across categories, priorities, and dependency states.
- **Assumptions:** Native checkbox groups and removable selection chips improve filtering without requiring task-schema or persistence changes.
- **Alternatives considered:** Keep single-value selects, use native multi-select boxes, or persist named filter presets.
- **Decision:** Use checkbox menus for source, status, priority, category, area, and dependency state. Values within a filter group use OR; different groups and search use AND. Show each active value as a removable chip and retain filter state only for the open canvas session.
- **Consequences:** Kanban and graph behavior remain synchronized and Markdown/canonical order remain untouched. Saved views are deferred until user/workspace ownership and persistence are defined. Downstream-impact, dependency-depth, and blocked-count sorts are also deferred until their precise semantics and calculation cost are specified; future sorts must remain view-only.

## ADR-10: Make status transitions authoritative for lifecycle dates

- **Status:** Accepted
- **Observations:** The edit operation accepted a supplied `completionDate` alongside a status change, allowing a blank value to suppress automatic completion dating or clear the date while reopening. Historical rows can legitimately have unknown completion dates.
- **Assumptions:** Configured lifecycle-aware mutations are the supported way to change task status. Historical unknown dates must remain blank until a new completion transition provides evidence.
- **Alternatives considered:** Trust callers not to include `completionDate`; reject every Complete task with a blank date; or apply lifecycle rules to status transitions and preserve unchanged historical records.
- **Decision:** On a transition into the configured completion status, storage replaces any supplied completion date with the current date and rejects the transition if a date cannot be produced. On a transition out, storage preserves the previously stored date, including a historical blank. Manual date corrections remain available when status is unchanged.
- **Consequences:** Edit, move, HTTP, and SDK action paths share one lifecycle rule. Existing Complete rows with unknown dates remain readable and are not backfilled. Direct Markdown status edits bypass storage and are prohibited by Copilot workflow guidance.

## ADR-11: Keep dependency suggestions separate until approved

- **Status:** Accepted
- **Observations:** Task narratives can contain explicit prerequisite relationships that are absent from canonical `Depends On` fields. Automatically turning narrative matches into edges risks false dependencies and would change blocker and workflow calculations without review.
- **Assumptions:** Exact configured task IDs paired with a small deterministic set of directional phrases are useful review candidates; users can approve each real blocker through the existing task editor workflow.
- **Alternatives considered:** Automatically create edges from narrative matches, use semantic/LLM matching, or rely only on agent instructions to populate `Depends On`.
- **Decision:** Discover candidates from Details and configured text/textarea fields using exact task-ID matching and explicit phrases. Return them as a separate projection with field, evidence, phrase, and confidence. Suggestions do not affect canonical dependencies or graph analytics until a user approves them. Approval uses the existing revision-checked edit transaction and cycle validation; dismissals remain browser-local.
- **Consequences:** No schema, graph store, or new dependency is required, and uncertain candidates cannot silently alter readiness or blockers. Users in different browsers review independently; only approved `Depends On` values are shared project state.

## ADR-12: Keep next-work planning agent-led and read-only

- **Status:** Accepted for the planning proof of concept.
- **Observations:** The board already exposes task state, canonical dependencies, and derived workflow analytics, but those metrics do not determine project goals or the best next task. A single concise response contract and one alternative discard useful reasoning when several defensible approaches exist.
- **Assumptions:** The current session can provide transient advice without tools; users can inspect evidence and retain authority over task and dependency state.
- **Alternatives considered:** Add hard-coded scoring or sequencing to the extension, allow the agent to edit the board, force a single alternative, or preserve full output without validating task IDs and dependency distinctions.
- **Decision:** Build a fresh, versioned read-only context and send it to the current session's no-tools query. Include root `AGENTS.md` when available and extract project goals, success criteria, non-goals, planning principles, and constraints. Order explicit goal sources as root `AGENTS.md`, root `README.md`, `docs/roadmap.md`, then `docs/architecture.md`; architecture is descriptive unless it explicitly states a goal. Keep nested `AGENTS.md` guidance scoped to its subtree because the planner has no task-to-filesystem mapping. The extension validates all recommended task IDs, reports canonical dependency coverage from the snapshot, and keeps agent-suggested dependency relationships separate from canonical edges. Present a concise summary with expanded reasoning and all returned alternatives; do not truncate response prose or lists.
- **Consequences:** The extension remains responsible for trusted data, validation, and presentation while the agent reasons about priorities and trade-offs. No task, dependency, execution, milestone, or agent-selection path is added. Advice remains unpersisted, confidence is agent-reported, project-document excerpts remain bounded, and the experimental SDK query may not be available in every host.

## ADR-13: Keep suggested implementation sequences separate from dependencies

- **Status:** Superseded by ADR-14.
- **Observations:** The planner explains a useful next task and alternative approaches, but users cannot see a coherent route beyond the first task. Treating an ordered recommendation as a dependency would silently change graph and workflow meaning.
- **Assumptions:** The current agent can propose short, evidence-based sequences using existing eligible tasks, while the extension can validate task IDs and keep the result transient.
- **Alternatives considered:** Calculate sequences in the extension, persist task order, infer `Depends On` edges from sequence order, or require sequences for alternatives that do not support them.
- **Decision:** Extend the validated response with a recommended sequence and optional sequences only for returned alternative paths. Require each path to start with its corresponding next task and each step to include rationale, expected benefit, unlocks, and confidence. Render sequence order separately from canonical dependencies and state explicitly that ordering does not create graph edges or affect blocker, readiness, or workflow analytics.
- **Consequences:** Recommendation and dependency logic remain unchanged; no task schema, graph, or persistence changes are introduced. Sequences remain inspectable, read-only planning judgement, and alternatives without a defensible sequence are omitted.

## ADR-14: Treat delivery routes as advisory planning judgement

- **Status:** Accepted; supersedes ADR-13's next-task-plus-sequence response model.
- **Observations:** Alternative tasks with attached sequences did not communicate a coherent progression toward a project outcome. Treating route order as a dependency would silently change graph and workflow meaning.
- **Assumptions:** The current agent can propose evidence-backed routes through eligible existing tasks, while the extension can validate route shape and canonical prerequisite reporting without calculating or persisting route order.
- **Alternatives considered:** Keep one-task alternatives with attached sequences, calculate routes in the extension, persist route order, infer `Depends On` edges from route order, or require a fixed route length.
- **Decision:** Keep the executive next-task recommendation and return one recommended delivery route plus up to two genuinely distinct alternatives when supported. A route is a strategic progression toward a useful outcome, normally three to five distinct eligible tasks; two tasks are acceptable for a limited route, and unsupported routes must be omitted rather than padded. Each route states outcome, goal alignment, rationale, trade-offs, assumptions, risks, evidence, confidence, stopping point, and task-level contribution and transition rationale. The recommended route begins with the executive recommendation. Each step reports the task's canonical prerequisites exactly; unfinished prerequisites outside the route and unresolved prerequisite IDs are disclosed. Route transitions distinguish practical enablement, strategic ordering, and recorded prerequisites. The UI renders each route and its ordered steps together in a responsive card and explicitly states that route order is not a dependency.
- **Consequences:** Planning remains read-only. Routes and route ordering are transient agent judgement and cannot create tasks, dependencies, blockers, readiness, graph state, or workflow analytics. The validator rejects unknown/ineligible route tasks, unsupported route lengths, inconsistent route assessments, unreported prerequisites, and a recommended route whose first task differs from the executive recommendation. When evidence cannot support a multi-task route, the agent may still recommend an individual next task while explicitly returning no routes.

## ADR-15: Keep legacy-format migration outside the shared runtime

- **Status:** Accepted
- **Observations:** The current Trade-MSTR documents use configured schema-v1 tables. The `TD-20` record in the audit source uses a historical ID prefix, but its table is canonical; the shared adapter is not needed to parse that source. The original pre-cutover format is available in repository history, and no active source requires automatic conversion.
- **Assumptions:** The one-time migration to canonical tables is complete. If an old-format document must be restored, its owning project can recover it from history and perform an explicit migration without changing the shared board runtime.
- **Alternatives considered:** Keep Trade-MSTR-specific parsing in the Template, remove historical ID aliases with the adapter, or retain legacy-format inference in the generic CRUD path.
- **Decision:** Restrict the shared runtime to configured schema-v1 tables and remove legacy adapter selection and automatic conversion. Keep `legacyIdPrefixes` as generic source configuration, independent of parsing, so historical task IDs and references remain valid. Any future legacy conversion must be an explicit utility owned by the project whose format it understands.
- **Consequences:** No task-table schema or current task data changes are required. A non-canonical source now fails explicitly instead of being inferred or rewritten during a normal board mutation. The deprecated `legacyAdapter` source field remains accepted as a validated no-op for configuration compatibility, but does not restore legacy parsing. Historical ID aliases remain supported.

## ADR-16: Template authority and release governance

- **Status:** Accepted
- **Observations:** Generic runtime behavior and reusable tests are maintained in the Template, while consumers own project configuration, Markdown task data, documentation, and domain integrations. Unreviewed snapshots and permanent consumer patches create behavioral drift and obscure provenance.
- **Assumptions:** Consumers can adopt a pinned release by syncing an explicit runtime payload and validating it in a disposable copy without replacing project-owned files.
- **Alternatives considered:** Treat each consumer as an independent implementation, synchronize the full Template repository, or leave release and rollback behavior to undocumented convention.
- **Decision:** Make the Template the sole authority for generic runtime, tests, architecture, decisions, release tags, and release notes. Consumers adopt only published immutable releases through an exact diff, preserve their project-owned content, and maintain one provenance record. Generic fixes are Template-first; emergency consumer patches must be minimal, documented, and reconciled with the next applicable release.
- **Consequences:** Releases state schema/config compatibility and explicitly verified host scope. Consumer compatibility is not inferred from repository similarity. Release and synchronization gates are reproducible, while project-specific tasks and integrations remain consumer-owned. See [release governance](release-governance.md).

## ADR-17: Resolve workspace and lock identity from the project root

- **Status:** Accepted
- **Observations:** Extension installation paths can vary across repositories and nesting layouts. The Copilot canvas may provide a workspace working directory; otherwise the canonical `project-kanban.config.json` is the authoritative identity. Storage already roots the exclusive lock at the resolved workspace, so independent runtime copies targeting one project share a lock while separate workspaces remain isolated.
- **Assumptions:** A bounded ancestor search from the extension or host-provided directory can resolve a unique valid project root. Missing, invalid, or ambiguous roots must fail explicitly rather than selecting an implicit current directory.
- **Alternatives considered:** Infer the root from repository or extension names, assume a fixed parent depth, use `process.cwd()`, place locks beside each runtime copy, or add configurable lock identity without a demonstrated need.
- **Decision:** Prefer the host-provided workspace directory when available; otherwise use bounded canonical-config discovery. Reject missing, invalid, or ambiguous roots and pass the resolved root through runtime components. Derive lock identity from that workspace root, not from the extension installation location; preserve the established lock path and transaction behavior.
- **Consequences:** Renaming a repository or relocating the extension does not change workspace identity. Runtime copies for one workspace coordinate through the same exclusive lock, and separate workspaces remain isolated. Schema v1, revision checks, atomic replacement, conflict behavior, and fail-closed handling of an abandoned lock remain unchanged. See [architecture](architecture.md#data-flow) and the [release governance contract](release-governance.md).

## ADR-18: Keep task-entry improvements configuration-driven

- **Status:** Superseded by ADR-19
- **Observations:** Area and Category are task fields that users may need to vary per task, while source configuration supplies useful defaults and suggestions. Configured extra fields already support project-specific text such as Acceptance Criteria, and task-ID fields already define the canonical dependency representation.
- **Assumptions:** Existing clients may omit Category when creating tasks and must continue to receive the source-configured value. Suggestions should aid entry without restricting new values or replacing validation.
- **Alternatives considered:** Keep Category fixed to the source on creation, add Acceptance Criteria to every task schema, or introduce a new schema version and persistence model for the form.
- **Decision:** Use the same configuration-driven form for create and edit. Accept an optional Category in create drafts and fall back to the configured source Category when omitted; at the time, keep Acceptance Criteria as an optional configured textarea; keep dependency selection as an assistive picker over the existing task-ID field and comma-separated value.
- **Consequences:** The form preserved the schema-v1 task model at that time. ADR-19 supersedes the Acceptance Criteria choice while preserving the other form decisions.

## ADR-19: Make Acceptance Criteria an optional first-class task field

- **Status:** Accepted
- **Observations:** Acceptance Criteria is useful across unrelated projects as task completion guidance, but making it a required value would burden tasks for which explicit criteria do not apply. Keeping it source-configured duplicates a common capability in every project configuration and makes the data contract inconsistent across sources.
- **Assumptions:** Existing schema-v1 consumers must continue to load tables that predate this field. Missing criteria are unknown/not supplied, not a basis for inferring project requirements.
- **Alternatives considered:** Keep Acceptance Criteria as a configured extra field; require a new task-table schema version and migrate all consumers before use; or make the field globally required.
- **Decision:** Add `acceptanceCriteria` as an optional core task string with a dedicated Markdown column. Parse a missing column/value as an empty string, validate supplied values up to 5,000 characters, and add the column when an older source is normalized for a write. Keep the schema marker and configuration version at v1.
- **Consequences:** Existing task tables and create callers remain valid, with blank criteria until explicitly supplied. New and normalized tables share a consistent column, all edits continue through the locked/revision-checked atomic write, and no completion criteria are fabricated for historical tasks.

## ADR-20: Release legacy-format parser removal as a major version

- **Status:** Accepted
- **Observations:** The published `v2.0.0` runtime included configured legacy-format parsing and migration. The current runtime restricts task loading to canonical schema-v1 tables and accepts `legacyAdapter` only as a validated no-op. The later `v2.1.1` tag was never published, so it did not provide a public deprecation release.
- **Assumptions:** Consumers can identify non-canonical sources and convert them with project-owned migration utilities before adopting the new runtime. Historical ID aliases remain independently supported through `legacyIdPrefixes`.
- **Alternatives considered:** Restore legacy parsing in the shared runtime for a minor release; publish the current behavior as a minor release despite the compatibility break; or use a major release with explicit migration guidance.
- **Decision:** Use `v3.0.0` for the first post-inversion release that removes legacy-format parsing. Do not restore the adapter. Keep schema v1 and `configVersion: 1` for canonical task tables, retain `legacyAdapter` as a no-op configuration compatibility field, and document that non-canonical documents must be explicitly converted before upgrade.
- **Consequences:** Consumers using legacy-format documents must migrate them before adopting v3.0.0. The release must state its canonical-schema-only contract, provide migration steps, and preserve the existing Markdown transaction, locking, revision, atomic replacement, and conflict guarantees. See [release governance](release-governance.md) and the [v3.0.0 release plan](v3.0.0/plan.md).
