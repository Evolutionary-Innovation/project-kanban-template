# Project Kanban Template v1

A GitHub repository template for a small, Markdown-backed Kanban canvas. Copy it into a project rather than installing a shared runtime dependency.

## What it provides

- One validated `project-kanban.config.json` for board labels, sources, task IDs, statuses, priorities, and source-specific extra fields.
- A workspace-scoped Copilot canvas with drag/drop, keyboard reordering, create, edit, delete, refresh, priority colors, and category badges.
- Markdown as the only task source of truth.
- Revision checks, exclusive write locking, atomic file replacement, file-mode preservation, validation, and HTTP 409 conflict handling.
- Example roadmap, technical-debt register, and repository audit documents.
- An independent example project with different source paths, statuses, priorities, prefixes, and fields.
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

After publishing this repository, enable **Template repository** in GitHub settings.
