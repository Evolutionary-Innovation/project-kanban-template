# Architecture

## System overview

Project Kanban is a workspace-scoped Copilot canvas with a local HTTP board UI. Configured Markdown documents remain authoritative for task records; the browser receives a parsed snapshot and sends validated CRUD or move actions back to the extension.

## Components and boundaries

| Component | Responsibility | Owns |
|---|---|---|
| `project-kanban.config.json` | Validates project labels, sources, workflow values, ID prefixes, and typed extra fields | Project-specific board configuration |
| `board-data.mjs` | Parses schema-v1 tables, normalizes configured columns on mutation, and builds status/dependency/suggestion projections | Markdown-to-task mapping and row edits |
| `board-dependencies.mjs` | Parses configured task references, derives blocker state, detects cycles, exposes graph-ready nodes/edges, and discovers narrative dependency candidates | Pure canonical and suggestion analysis; no persistence |
| `legacy-adapters.mjs` | Routes only explicitly configured legacy sources to their adapter | Legacy-format compatibility |
| `board-storage.mjs` | Reads snapshots and performs validated, revision-checked, locked single-source writes | Persistence transaction and conflict behavior |
| `board-server.mjs` | Serves the browser assets and same-origin JSON mutation routes | Local HTTP boundary |
| `board-client.js` and `board-view.mjs` | Render cards, project search/filter/sort views, review dependency suggestions, and send user actions | Ephemeral browser view state and per-browser suggestion dismissals |
| `board-graph.mjs` | Joins existing graph projection to tasks, constructs diagnostic placeholders, and adapts immutable inputs to layout | Pure graph presentation and layout |
| `board-graph-client.js` and `board-graph-worker.mjs` | Render native SVG/HTML graph views and calculate positions in a local worker | Ephemeral selection, viewport and cached layout; no mutations |
| `extension.mjs` | Registers SDK canvas actions and opens/closes per-instance local servers | Copilot host integration |

## Data flow

Opening the canvas reads each configured source, parses its schema-v1 table, and returns tasks, configured columns, source paths, SHA-256 revisions, the canonical dependency graph, a separate dependency-suggestion projection, and a generation time. The client projects the snapshot into columns. Search includes task IDs and canonical dependency references. Checkbox filters allow multiple values per source, status, priority, category, area, and dependency-state group; selected values within a group use OR, while groups and search combine with AND. Removable chips expose individual active filter selections. Matching tasks remain in their original status columns. Each column can sort its view independently, including by category, area, and configured lifecycle dates. Cards lead with a display-only `ID: Title`, followed by category and area badges, populated configured detail sections, dependency relationships, and a subtle lifecycle footer. The display title removes configured source/category prefixes and duplicate IDs without modifying Markdown. Collapse hides content sections while retaining category/area, dependency summary, and known dates. Priority remains encoded by the card border; redundant status, priority, and source-filename labels are omitted. View state and collapsed-card IDs are held in memory and do not write Markdown.

Dependency suggestions use exact configured task-ID formats and a deterministic list of explicit directional phrases in Details and configured text/textarea fields. Bare ID mentions, title matches, and unrecognized IDs are ignored. Candidates include the dependent and prerequisite tasks, field, evidence snippet, phrase, and phrase-based confidence. They are returned separately from `dependencyGraph` and `dependencyView`, so suggestions cannot affect graph edges, blockers, readiness, impact, or workflow analytics. The review panel's Approve action submits only a `Depends On` edit through the existing revision-checked task edit route, including its cycle validation; Not a Dependency dismissals are stored in browser local storage and do not create project records.

CRUD and status/order changes go through the local HTTP server or SDK action. Storage validates the request, takes the exclusive workspace lock, rereads every source, compares all expected revisions, applies one row-level change to the owning source, and atomically replaces that file. A dependency edit is checked against the complete locked board before writing; malformed, duplicate, self-referential, or newly cyclic links are rejected. References to not-yet-present task IDs remain valid and are reported as unresolved. `Blocked By` is derived from incomplete or unresolved `Depends On` references and is never duplicated in Markdown. The graph projection emits each resolved edge from prerequisite to dependent and retains unresolved edges for diagnosis/future graph UI. Existing cycles remain loadable and are flagged; newly introduced cycles are rejected. `executionType` is configured metadata only and never triggers task execution or status changes.

`createdDate` and `completionDate` are independent optional schema-v1 date extra fields. When configured, creation sets `createdDate` if absent; creation in or transition into the configured completion status sets or replaces `completionDate`, while reopening retains it. Status transitions are authoritative: entering the completion status overrides any supplied date with the current date, and leaving it preserves the stored date, including a historical blank. Manual corrections remain available when status is unchanged. The storage transaction validates new completion transitions without rejecting or backfilling existing historical blanks. A source-local ID high-water marker is initialized or advanced in the same write, outside the task table. A stale revision or held lock is surfaced as HTTP 409. Narrative text and other source documents are not rewritten.

The generic parser handles only canonical schema-v1 task tables. Legacy inference is isolated in explicitly selected adapters.

## Secondary dependency graph

Kanban is the default view. The secondary Dependencies view uses only the existing canonical `dependencyGraph` and task-by-ID snapshot, not suggestions, another dependency calculation, or another stored representation. It shows every task, including isolated tasks, and creates labelled placeholders for unresolved references. Edges always run from prerequisite to dependent. Blocker styling comes from existing `dependencyView.blockedBy`; cycle task flags are displayed without inventing precise cycle-edge membership.

Native SVG renders compact fixed-size nodes with ID, short title, configured Status, priority accents and warnings. Full metadata, populated content and known dates are available in an HTML inspector; an accessible list describes all tasks and their direct relationships. A click selects a node; double-click opens the existing task editor, while Shift+double-click focuses its neighbourhood. Left drag pans and Shift+drag zooms to a bounded selection; Shift+wheel zooms around the pointer. Right-click or the keyboard context-menu shortcut opens an accessible graph action menu. Arrow/Home/End navigation, Enter/Space selection, fit/zoom/reset controls, native scrolling, and the accessible task list remain available. Graph navigation does not write Markdown; edits use the existing task editor and transaction.

Only when the graph opens, its client module creates a same-origin module worker loading the pinned local Dagre distribution. The worker receives copied layout-only IDs and edges and returns coordinates; it cannot mutate task records. Dagre lays out connected tasks top-to-bottom, while isolated tasks are arranged in a compact grid below them. Original dependency directions survive cyclic layout. Geometry is cached by topology, so metadata-only refreshes do not move nodes. View exit, newer snapshots and errors terminate pending workers, and generation checks reject stale results.

Graph modules/vendor assets use explicit same-origin static routes and are read lazily so a missing optional graph asset does not prevent Kanban from starting. CSP permits only same-origin workers, without remote scripts or dynamic evaluation. The [vendor inventory](../.github/extensions/project-kanban/vendor/README.md) records pinned bytes, licences and update steps; copied templates need no dependency installation or build.

Refresh and successful mutations feed one current snapshot to both views. Shared search and multi-select filters apply to both views; column sorts and collapse controls remain Kanban-only. Graph projection distinguishes matching tasks from subdued prerequisite context, retains unresolved placeholders, and can temporarily reveal a selected task outside filters. Focus begins with direct prerequisites/dependents; cycle-safe upstream/downstream expansion is explicit. Graph-to-board and board-to-graph navigation reveal and focus the same task without modifying filters. Graph-launched editing opens the existing editor and uses the same transaction.

Workflow intelligence is derived from the current snapshot and is never persisted. A task is dependency-ready when it is not complete, has no incomplete or unresolved prerequisites, and is not part of a known cycle. This is advisory information—not a status, claim, or authorization to execute. Blocked work, unresolved blockers, and cycle tasks are counted separately. Downstream impact counts unique reachable dependents with cycle-safe traversal. The highlighted longest dependency chain is an unweighted structural path with cycle tasks excluded; without duration estimates, it is not a schedule critical path. No execution automation or schema fields are introduced.

Graph failures are explicitly reported with retry/return controls; a failed Markdown refresh invalidates the displayed graph. Search/filter/focus/reveals remain ephemeral.

SVG readability and layout cost depend on topology, not just task count. The 60-task fixture verifies correctness but is sparse; larger dense/long-chain benchmarks are synthetic performance probes, not a guarantee of unlimited whole-project usability. The local worker prevents layout from blocking board interaction, but large SVGs still carry rendering and accessibility costs. A 250-task/744-edge chain benchmark renders successfully; a 1,000-task/2,994-edge deep chain exceeds the current engine's browser stack limit. This produces an explicit depth-limit error rather than dropping records. A fresh snapshot's accessible task/relationship list remains available when only layout fails; a failed Markdown refresh clears it along with the diagram to avoid stale data. See the [technical-debt register](technical-debt.md).

## Persistence and external systems

Markdown task tables are the task source of truth. No task database or browser view-state file is maintained. Writes use workspace-relative source validation, an exclusive lock, revision hashes, Markdown cell escaping, same-directory temporary files, atomic rename, and original file modes. The per-source `project-kanban-id-sequence` comment retains the next ID after deletion; it is validated and updated in the same transaction as the task row. External Markdown changes require refresh rather than force overwrite.

The browser-only synthetic test project under [`examples/synthetic-browser-project/`](../examples/synthetic-browser-project/) supplies fictional UX data and a local server rooted at that fixture. UX testing must not mutate the template's actual task registers.

## Constraints

- Preserve schema v1 task tables, configured statuses/priorities/source ownership, and stable task IDs.
- Do not bypass the existing transaction, revision checks, lock, validation, atomic replacement, or conflict handling.
- Keep view sorting separate from canonical Markdown `Order`. Disable manual reorder when filters/search hide tasks or a column uses a non-manual sort.
- Keep search/filter/collapse/sorting generic over configured source fields, without hard-coded project labels.
- Keep lifecycle dates as configured `date` extra fields and define the project's completion status in config. Upgrading an existing project requires adding the fields it wants to support to each source config and task-table header; leave historical unknown dates blank rather than inferring them.
- In the default template configuration, all three sources use the same schema-v1 columns. Extra fields are optional; older schema-v1 tables that omit configured optional columns load with blank values and acquire the configured columns on their next mutation. Store only `Depends On`; derive `Blocked By`. Keep dependency IDs project-configured and use the graph-ready `dependsOn` projection rather than persisting a second edge representation.
- `Execution Type` is passive metadata. Agent/provider/model identity, automatic claiming, and status-triggered execution are outside the current architecture.
- A source's ID sequence marker prevents reuse after it is established. When first initialized, it can only infer a safe next value from active rows; projects with pre-existing deletions must bootstrap it above the highest ID ever allocated because Markdown cannot reveal deleted history.
- Keep the independent example configuration and explicit legacy adapter compatible.
