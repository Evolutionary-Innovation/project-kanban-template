# Architecture

## System overview

Project Kanban is a workspace-scoped Copilot canvas with a local HTTP board UI. Configured Markdown documents remain authoritative for task records; the browser receives a parsed snapshot and sends validated CRUD or move actions back to the extension.

## Components and boundaries

| Component | Responsibility | Owns |
|---|---|---|
| `project-kanban.config.json` | Validates project labels, sources, workflow values, ID prefixes, and extra fields | Project-specific board configuration |
| `board-data.mjs` | Parses and validates schema-v1 task tables and builds canonical status columns | Markdown-to-task mapping and row edits |
| `legacy-adapters.mjs` | Routes only explicitly configured legacy sources to their adapter | Legacy-format compatibility |
| `board-storage.mjs` | Reads snapshots and performs validated, revision-checked, locked single-source writes | Persistence transaction and conflict behavior |
| `board-server.mjs` | Serves the browser assets and same-origin JSON mutation routes | Local HTTP boundary |
| `board-client.js` and `board-view.mjs` | Render cards, project search/filter/sort views, and send user actions | Ephemeral browser view state |
| `extension.mjs` | Registers SDK canvas actions and opens/closes per-instance local servers | Copilot host integration |

## Data flow

Opening the canvas reads each configured source, parses its schema-v1 table, and returns tasks, configured columns, source paths, SHA-256 revisions, and a generation time. The client projects that snapshot into columns. Search and filters select matching tasks within their original status columns; each column can sort its view independently, including by configured lifecycle dates. Cards show titles as stored, avoid repeating an ID already at the start of a title, render Details and configured non-date fields as separate labeled sections, and keep status and lifecycle metadata visible when details are collapsed. View state and collapsed-card IDs are held in memory and do not write Markdown.

CRUD and status/order changes go through the local HTTP server or SDK action. Storage validates the request, takes the exclusive workspace lock, rereads every source, compares all expected revisions, applies one row-level change to the owning source, and atomically replaces that file. `createdDate` and `completionDate` are independent optional schema-v1 date extra fields. When configured, creation sets `createdDate` if absent; creation in or transition into the configured completion status sets or replaces `completionDate`, while reopening retains it. Both remain manually editable. Historical unknown dates stay blank. A source-local ID high-water marker is initialized or advanced in the same write, outside the task table. A stale revision or held lock is surfaced as HTTP 409. Narrative text and other source documents are not rewritten.

The generic parser handles only canonical schema-v1 task tables. Legacy inference is isolated in explicitly selected adapters.

## Persistence and external systems

Markdown task tables are the task source of truth. No task database or browser view-state file is maintained. Writes use workspace-relative source validation, an exclusive lock, revision hashes, Markdown cell escaping, same-directory temporary files, atomic rename, and original file modes. The per-source `project-kanban-id-sequence` comment retains the next ID after deletion; it is validated and updated in the same transaction as the task row. External Markdown changes require refresh rather than force overwrite.

The browser-only synthetic test project under [`examples/synthetic-browser-project/`](../examples/synthetic-browser-project/) supplies fictional UX data and a local server rooted at that fixture. UX testing must not mutate the template's actual task registers.

## Constraints

- Preserve schema v1 task tables, configured statuses/priorities/source ownership, and stable task IDs.
- Do not bypass the existing transaction, revision checks, lock, validation, atomic replacement, or conflict handling.
- Keep view sorting separate from canonical Markdown `Order`. Disable manual reorder when filters/search hide tasks or a column uses a non-manual sort.
- Keep search/filter/collapse/sorting generic over configured source fields, without hard-coded project labels.
- Keep lifecycle dates as configured `date` extra fields and define the project's completion status in config. Upgrading an existing project requires adding the fields it wants to support to each source config and task-table header; leave historical unknown dates blank rather than inferring them.
- A source's ID sequence marker prevents reuse after it is established. When first initialized, it can only infer a safe next value from active rows; projects with pre-existing deletions must bootstrap it above the highest ID ever allocated because Markdown cannot reveal deleted history.
- Keep the independent example configuration and explicit legacy adapter compatible.
