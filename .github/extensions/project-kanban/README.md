# Project Kanban canvas

The workspace canvas reads the Markdown sources listed in the repository-root `project-kanban.config.json`. Markdown remains authoritative; the canvas renders configured statuses as columns and persists mutations to each task's owning source.

The common task fields are ID, Title, Status, Priority, Order, Area, Category, and Details. A source may configure additional fields. New projects should use canonical `## Kanban tasks` tables with the configured schema marker. Legacy Markdown inference is available only through an explicit adapter.

The canvas supports drag-and-drop, keyboard reordering, create, edit, confirmed delete, and refresh. Search covers titles, details, and configured extra fields; combined source, priority, category, and area filters and independent per-column view sorts keep tasks in their original status columns. Cards can be collapsed individually or as a group for the current canvas session.

Cards display `ID: Title`, removing configured category/source prefixes and duplicate IDs for presentation only; Markdown titles are not rewritten. Category and Area badges sit below the title. Details and configured content fields render as separate sections using their configured labels.

Lifecycle dates are independent `createdDate` and `completionDate` date fields configured per source. When configured, Created Date is populated on creation; historical unknown dates remain blank. Completion Date is populated when a task is created in or moved into the configured `completionStatus`, replaced on each later completion, retained when reopened, and remains manually editable. Active cards show `Added`; completed cards show `Completed`; a reopened task with a retained date shows `Last completed`. Lifecycle fields can be sorted in the view. Existing projects keep schema v1 by adding the desired fields to each source config and table header.

The sticky status footer shows visible/total counts and refresh time, with source paths and shortened revision hashes available in a disclosure. View controls do not change Markdown or canonical order. Reordering is disabled when search or filters hide cards, or when the column is sorted by anything other than Manual. The task Status control can still move a card to the end of another column.

## Dependency overview

Kanban remains the default and primary editing view. The **Dependencies** button opens a read-only whole-project SVG graph built from the existing snapshot, including isolated tasks and unresolved-reference placeholders. Edges run prerequisite to dependent. Stronger arrows identify existing blockers; dashed arrows/nodes identify unresolved references. Cycle warnings identify affected tasks without pretending every edge between warned nodes belongs to a cycle.

Select a compact node to inspect its full title, configured metadata, known lifecycle dates, populated content, direct prerequisites, blockers, and dependents. The accessible task/relationship list provides a textual alternative. Nodes support arrow keys and Home/End navigation, Enter/Space selection, and Escape to the viewport controls. Fit graph, Zoom in/out, Reset zoom, and native diagram scrolling require neither dragging nor wheel gestures.

Shared search and filters, including Status, apply in both views. Matching tasks are visually distinct from prerequisite context nodes, and a task selected outside the filters is explicitly marked as temporarily revealed. Focus mode begins with direct prerequisites/dependents; upstream and downstream paths are opt-in, cycle-safe expansions. Use **Show on board** in the inspector and **Show in graph** on a card to navigate between views. Graph-launched editing opens the existing Kanban editor and uses the same persistence transaction. Column sorts and collapse controls remain Kanban-only. Dependency-unblocked is factual, not Ready; there is no automatic execution.

Refresh from Markdown and subsequent successful task mutations update the same snapshot used by both views. The graph preserves selection when possible and caches topology-based layout. Layout runs in a same-origin module worker, terminated on completion, view exit, replacement, or error. Failed graph loads show Retry/Return to Kanban and never create a second mutation path. Failed Markdown refresh clears the graph rather than presenting stale data.

The [pinned Dagre bundle and licence inventory](vendor/README.md) is served locally only when graph layout is needed. No consumer build step, CDN, or framework is required. Graph routes are allowlisted; CSP adds only `worker-src 'self'`.

Task changes use hash-based revisions, an exclusive workspace lock, same-directory atomic replacement, and HTTP 409 conflict handling. Each source also keeps a `project-kanban-id-sequence` comment outside its task table so deleted IDs are not reused. Before first use, projects with historical deletions must initialize that marker above their highest-ever allocated ID; the active table alone cannot reveal deleted IDs.

The isolated [`examples/synthetic-browser-project/`](../../../examples/synthetic-browser-project/) contains fictional data for browser and UX testing. Run `node examples/synthetic-browser-project/serve.mjs` from the repository root; the local server writes only within that fixture.

See the repository [installation guide](../../../docs/installation.md) and [documentation standards](../../../docs/documentation-standards.md).

## Local checks

```sh
node --test .github/extensions/project-kanban/*.test.mjs .github/extensions/project-kanban/adapters/trade-mstr-v1/*.test.mjs
```
