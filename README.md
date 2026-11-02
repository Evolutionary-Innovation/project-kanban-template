# Project Kanban Template v2.1.0

A GitHub repository template for a Markdown-backed project-management canvas. Copy it into a project rather than installing a shared runtime dependency.

## What it provides

- One validated `project-kanban.config.json` for board labels, sources, task IDs, statuses, priorities, and source-specific extra fields.
- A workspace-scoped Copilot canvas with drag/drop, keyboard reordering, create, edit, delete, refresh, priority colors, and category badges.
- A sticky status footer, shared search, multi-select filters with removable chips, session-only card collapse, and independent view-only column sorting.
- Configurable Created Date and Completion Date lifecycle fields, latest-completion tracking, manual corrections, and date sorting.
- Scannable cards with `ID: Title` titles, lifecycle metadata, and separately labeled Details/configured fields.
- Cross-source `Depends On` links with derived blocker state, cycle validation, dependency-aware search/filters, and graph-ready data.
- A secondary dependency graph with shared filters, focus/expansion, cross-view navigation, unresolved/cycle warnings, derived dependency readiness, downstream impact, and the longest unweighted dependency chain.
- Configured `Execution Type` choices as passive metadata; the board does not launch agents or trigger work from status changes.
- Markdown as the only task source of truth.
- Revision checks, exclusive write locking, atomic file replacement, file-mode preservation, validation, and HTTP 409 conflict handling.
- Example roadmap, technical-debt register, and repository audit documents.
- An independent example project with different source paths, statuses, priorities, prefixes, and fields.
- An isolated synthetic browser project with 60 fictional records for UX testing; its local server writes only to fixture documents.
- A Trade-MSTR v1 legacy adapter kept outside the generic parser. The Trade-MSTR checkout is not modified by this template.

## Start here

1. Use GitHub's **Use this template** action to create a project repository, or copy this repository locally.
2. Edit `project-kanban.config.json` and the Markdown source documents.
3. Keep the required task columns and schema marker aligned with the configuration.
4. Read [installation instructions](docs/installation.md), [documentation standards](docs/documentation-standards.md), and project-specific [AGENTS.md](AGENTS.md).
5. Run the tests:

   ```sh
   node --test .github/extensions/project-kanban/*.test.mjs .github/extensions/project-kanban/adapters/trade-mstr-v1/*.test.mjs
   ```

To try the board with representative browser-test data, run `node examples/synthetic-browser-project/serve.mjs` and open the loopback URL it prints. The fixture records are fictional and do not alter the template's actual task registers.

Kanban remains the default editing interface. Choose **Dependencies** for a read-only graph overview, including isolated tasks. Shared search and multi-select filters apply in both views; selections within one filter use OR, and filter groups use AND. Removable chips expose individual active filter values. Matching tasks remain distinct from prerequisite context. Click a node to inspect it, double-click to edit through the existing task editor, or Shift+double-click to focus its neighbourhood; expand upstream/downstream paths from the inspector or context menu. Drag to pan, Shift+drag to zoom to a selection, and Shift+wheel to zoom around the pointer. Right-click or Shift+F10 opens the accessible graph context menu. The graph inspector shows unique downstream impact, and the graph highlights the longest unweighted chain with cycle tasks excluded. This is structural information, not a duration-based critical path.

Dependency readiness is derived from completion and dependency state, is advisory only, and never changes status or authorizes execution. Graph-launched edits use the existing Kanban editor and persistence transaction. No task automation is introduced.

The graph uses a pinned, locally served MIT-licensed Dagre distribution in a same-origin layout worker; opening the board requires no package installation or CDN access. See the [vendor inventory and update procedure](.github/extensions/project-kanban/vendor/README.md).

After publishing this repository, enable **Template repository** in GitHub settings.
