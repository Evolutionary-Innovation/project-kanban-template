# Project Kanban Template v1

A GitHub repository template for a small, Markdown-backed Kanban canvas. Copy it into a project rather than installing a shared runtime dependency.

## What it provides

- One validated `project-kanban.config.json` for board labels, sources, task IDs, statuses, priorities, and source-specific extra fields.
- A workspace-scoped Copilot canvas with drag/drop, keyboard reordering, create, edit, delete, refresh, priority colors, and category badges.
- A sticky status footer, in-column search, combined filters, session-only card collapse, and independent view-only column sorting.
- Configurable Created Date and Completion Date lifecycle fields, latest-completion tracking, manual corrections, and date sorting.
- Scannable cards with `ID: Title` titles, lifecycle metadata, and separately labeled Details/configured fields.
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

After publishing this repository, enable **Template repository** in GitHub settings.
