# Project Kanban canvas

The workspace canvas reads the Markdown sources listed in the repository-root `project-kanban.config.json`. Markdown remains authoritative; the canvas renders configured statuses as columns and persists mutations to each task's owning source.

The common task fields are ID, Title, Status, Priority, Order, Area, Category, and Details. A source may configure additional fields. New projects should use canonical `## Kanban tasks` tables with the configured schema marker. Legacy Markdown inference is available only through an explicit adapter.

The canvas supports drag-and-drop, keyboard reordering, create, edit, confirmed delete, and refresh. Task changes use hash-based revisions, an exclusive workspace lock, same-directory atomic replacement, and HTTP 409 conflict handling.

See the repository [installation guide](../../../docs/installation.md) and [documentation standards](../../../docs/documentation-standards.md).

## Local checks

```sh
node --test .github/extensions/project-kanban/*.test.mjs .github/extensions/project-kanban/adapters/trade-mstr-v1/*.test.mjs
```
