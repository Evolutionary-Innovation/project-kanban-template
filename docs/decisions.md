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
