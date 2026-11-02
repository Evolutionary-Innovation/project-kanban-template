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
- **Observations:** The template's root Markdown task registers are authoritative and may contain real project work or audit evidence. Browser UX checks need a larger, repeatable dataset.
- **Assumptions:** A fixture-specific local server can use the existing generic parser and storage modules while rooting all writes within the fixture directory.
- **Alternatives considered:** Add fictional entries to the root task registers or create ephemeral test rows in a browser-only mock.
- **Decision:** Keep 60 fictional records in a separate configured project and run new browser/UX checks against it. Its local server loads and writes only the fixture's Markdown files.
- **Consequences:** Test data exercises real parsing and persistence code without polluting or mutating canonical project records. The fixture is explicitly marked as synthetic.

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
- **Decision:** Render native SVG and HTML using a pinned MIT-licensed `@dagrejs/dagre` standalone distribution served locally in a same-origin module worker. Preserve original link directions and existing blocker/cycle facts. Keep task selection, zoom and cached coordinates ephemeral; do not persist a graph, layout or new fields. Pin provenance/checksums and both Dagre/graphlib licence notices, and retain offline template-copy operation.
- **Consequences:** Initial graph delivery is read-only and whole-project; board filters remain Kanban-only until the next interaction stage. Graph clients/assets load lazily, and layout workers terminate after work or cancellation. The existing editor and transaction remain untouched. Ready-state policy, graph editing, focus/filter integration, claims and execution need separate implementation stages. Performance remains bounded by graph topology and SVG rendering even with worker-based layout.
