# Installation and Use

## Create a project from this template

1. Publish this repository to GitHub and enable **Template repository** in its repository settings.
2. Use **Use this template** to create a new project repository.
3. Review `AGENTS.md`, `copilot-instructions.md`, and `docs/documentation-standards.md`.
4. Edit `project-kanban.config.json` for the project's name, source documents, IDs, statuses, priorities, and extra fields.
5. Create each configured Markdown source with a `## Kanban tasks` section, the configured schema marker, and the required columns.
6. Open the repository in a Copilot host that loads workspace extensions. The extension is located at `.github/extensions/project-kanban/extension.mjs`.

The extension reads and writes only the configured workspace-relative Markdown files. It stores no task database or private board state.

## Install the portable global instructions

`copilot-instructions.md` is intentionally project-independent, but a repository file cannot apply itself to every workspace. Copy or merge its contents into the user/global Copilot instructions supported by the host when cross-project behavior is desired. Keep project-specific architecture, task conventions, and implementation rules in `AGENTS.md`.

## Configure a new source

Add a source entry with a unique key, relative path, ID prefix and width, category/tone, and any source-specific extra fields. Create the Markdown file and table before opening the board. The config validator rejects paths outside the workspace and invalid or duplicate values.

Use a legacy adapter only when one is explicitly implemented and named in the config. The bundled Trade-MSTR v1 adapter exists for its historical headings and marker; new projects should author canonical tables directly.

For Trade-MSTR v1 documents, set `legacyAdapter` consistently on all three source entries and set `schemaMarker` to `<!-- trade-mstr-kanban-schema:1 -->`. If a legacy source contains IDs allocated by another source (for example audit tasks with `TD-` IDs), declare those prefixes in that source's `legacyIdPrefixes`; new IDs still use the source's primary `idPrefix`.

## Validate locally

No package installation is required. With Node.js available, run:

```sh
node --test .github/extensions/project-kanban/*.test.mjs .github/extensions/project-kanban/adapters/trade-mstr-v1/*.test.mjs
```

The `examples/independent-project/` fixture demonstrates a project with different statuses, sources, prefixes, and task fields.

## Enable GitHub template mode

After pushing this repository to GitHub, open repository **Settings → General** and enable **Template repository**. This local project scaffold is not published or marked as a template automatically.
