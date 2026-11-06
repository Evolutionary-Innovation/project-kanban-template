# Project Kanban canvas

The workspace canvas reads the Markdown sources listed in the repository-root `project-kanban.config.json`. Markdown remains authoritative; the canvas renders configured statuses as columns and persists mutations to each task's owning source.

The common task fields are ID, Title, Status, Priority, Order, Area, Category, and Details. A source may configure additional fields. New projects should use canonical `## Kanban tasks` tables with the configured schema marker. Legacy Markdown inference is available only through an explicit adapter.

The canvas supports drag-and-drop, keyboard reordering, create, edit, confirmed delete, and refresh. Search covers titles, details, and configured extra fields. Checkbox filters support multiple values for source, status, priority, category, area, and dependency state: selections within one filter use OR, while filter groups combine with AND. Removable filter chips make active selections visible. Filters and independent per-column view sorts keep tasks in their original status columns. Cards can be collapsed individually or as a group for the current canvas session.

Filter selections are shared by Kanban and Dependencies and remain in memory for the open canvas session. Saved views and analytics-based sort options are deferred; neither changes Markdown or canonical order.

Cards display `ID: Title`, removing configured category/source prefixes and duplicate IDs for presentation only; Markdown titles are not rewritten. Category and Area badges sit below the title. Details and configured content fields render as separate sections using their configured labels.

Lifecycle dates are independent `createdDate` and `completionDate` date fields configured per source. When configured, Created Date is populated on creation; historical unknown dates remain blank. A status transition into `completionStatus` always replaces Completion Date with the current date, even if the edit supplies a blank or stale date. A transition out of `completionStatus` retains the stored date, including an unknown historical blank. Manual corrections remain supported when status is not changing. Active cards show `Added`; completed cards show `Completed`; a reopened task with a retained date shows `Last completed`. Lifecycle fields can be sorted in the view. Existing projects keep schema v1 by adding the desired fields to each source config and table header.

The sticky status footer shows visible/total counts and refresh time, with source paths and shortened revision hashes available in a disclosure. View controls do not change Markdown or canonical order. Reordering is disabled when search or filters hide cards, or when the column is sorted by anything other than Manual. The task Status control can still move a card to the end of another column.

## Dependency overview

Kanban remains the default and primary editing view. The **Dependencies** button opens a read-only whole-project SVG graph built from the existing snapshot, including isolated tasks and unresolved-reference placeholders. Edges run prerequisite to dependent. Stronger arrows identify existing blockers; dashed arrows/nodes identify unresolved references. Cycle warnings identify affected tasks without pretending every edge between warned nodes belongs to a cycle.

Click a compact node to inspect its full title, configured metadata, known lifecycle dates, populated content, direct prerequisites, blockers, and dependents. Double-click opens the existing task editor; Shift+double-click focuses the node's neighbourhood. Left drag pans, Shift+drag zooms to a selection, and Shift+wheel zooms around the pointer. Right-click or Shift+F10/the context-menu key opens the accessible graph action menu. Nodes also support arrow keys and Home/End navigation, Enter/Space selection, and Escape to the viewport controls. Fit graph, Zoom in/out, Reset zoom, native scrolling, and the accessible task/relationship list remain available.

Shared search and multi-select filters apply in both views. Values within a filter use OR logic; filter groups use AND. Removable chips expose individual active filter values. Matching tasks are visually distinct from prerequisite context nodes, and a task selected outside the filters is explicitly marked as temporarily revealed. Focus mode begins with direct prerequisites/dependents; upstream and downstream paths are opt-in, cycle-safe expansions. Use **Show on board** in the inspector and **Show in graph** on a card to navigate between views. Graph-launched editing opens the existing Kanban editor and uses the same persistence transaction. Column sorts and collapse controls remain Kanban-only. Dependency readiness is advisory only and does not authorize or trigger execution.

The board footer and graph inspector show derived workflow intelligence: dependency-ready and blocked counts, cycle/unresolved warnings, and unique downstream impact. The graph highlights the longest unweighted dependency chain, excluding cycle tasks. It is not a schedule critical path because task durations are not configured. Readiness is advisory only and does not change task status or trigger execution.

The board also provides a review panel for deterministic dependency suggestions found in configured narrative fields. Suggestions use exact task IDs paired with explicit relationship phrases and remain outside canonical graph calculations until approved. Approval uses the existing cycle-checked `Depends On` edit; dismissals are saved in the current browser only.

## Planning advisor

The read-only **Suggest Next Work** panel asks the current Copilot session for advice from a fresh snapshot of all tasks, canonical dependencies, workflow state, and project documents. Root `AGENTS.md` is included when available, with explicit-goal precedence over root `README.md`, `docs/roadmap.md`, then `docs/architecture.md`; architecture remains descriptive unless it explicitly states a goal. Explicit goals include their source and line, while descriptions are not promoted to goals. The current view is metadata and does not filter the planning task set. The context can be refreshed, copied, or downloaded as JSON.

The result keeps a concise recommended next task visible and provides expanded reasoning, assumptions, uncertainty, a suggested first step, evidence, risks, confidence, and every supported distinct delivery route. Routes are coherent multi-task progressions toward an outcome, normally three to five tasks; a two-task route is accepted when only a limited progression is supported, and the planner must not pad a route. Each responsive route card contains the route's outcome, goal alignment, trade-offs, confidence, risks, stopping point, and its own ordered task steps with contribution, transition rationale, expected benefit, unlocks, and confidence. Cards flow into side-by-side columns when space permits and stack on narrow screens. Route order is planning judgement, not a dependency: it does not create `Depends On` entries or affect graph edges, blockers, readiness, or workflow analytics. Recorded prerequisites are shown separately from practical enablement and strategic ordering.

Planning does not create or edit tasks/dependencies, execute work, plan milestones, select agents, or persist the response. The extension retains the `CopilotSession` returned by `joinSession()` and uses its experimental no-tools query API for the active conversation; unsupported hosts and invalid responses produce visible errors rather than falling back to another workflow.

Refresh from Markdown and subsequent successful task mutations update the same snapshot used by both views. The graph preserves selection when possible and caches topology-based layout. Layout runs in a same-origin module worker, terminated on completion, view exit, replacement, or error. Failed graph loads show Retry/Return to Kanban and never create a second mutation path. Failed Markdown refresh clears the graph rather than presenting stale data.

The [pinned Dagre bundle and licence inventory](vendor/README.md) is served locally only when graph layout is needed. No consumer build step, CDN, or framework is required. Graph routes are allowlisted; CSP adds only `worker-src 'self'`.

Task changes use hash-based revisions, an exclusive workspace lock, same-directory atomic replacement, and HTTP 409 conflict handling. Each source also keeps a `project-kanban-id-sequence` comment outside its task table so deleted IDs are not reused. Before first use, projects with historical deletions must initialize that marker above their highest-ever allocated ID; the active table alone cannot reveal deleted IDs.

The isolated [`examples/synthetic-browser-project/`](../../../examples/synthetic-browser-project/) contains fictional data for browser and UX testing. Run `node examples/synthetic-browser-project/serve.mjs` from the repository root; the local server writes only within that fixture.

See the repository [installation guide](../../../docs/installation.md) and [documentation standards](../../../docs/documentation-standards.md).

## Local checks

Run from the installed extension directory. The same command works when the extension lives under a differently named consumer directory:

```sh
node --test *.test.mjs
```

The generic contract suite uses generated temporary workspaces and does not read repository task registers or Template example-project fixtures. From the Template repository root, run example-project integration tests separately:

```sh
node --test .github/extensions/project-kanban/template-integration/*.test.mjs
```

For a consumer integration smoke test, set `KANBAN_CONSUMER_ROOT` to a consumer checkout. The test copies its config and configured source documents into a temporary workspace before writing:

```sh
KANBAN_CONSUMER_ROOT=/path/to/consumer node --test .github/extensions/project-kanban/consumer-integration/*.test.mjs
```

The extension reads configured schema-v1 task tables only. It does not infer or convert historical formats; any required migration belongs in an explicit project-owned utility.
