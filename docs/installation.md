# Installation and Use

## Create a project from this template

1. Publish this repository to GitHub and enable **Template repository** in its repository settings.
2. Use **Use this template** to create a new project repository.
3. Review `AGENTS.md`, `copilot-instructions.md`, and `docs/documentation-standards.md`.
4. Edit `project-kanban.config.json` for the project's name, source documents, IDs, statuses, priorities, and extra fields.
5. Create each configured Markdown source with a `## Kanban tasks` section, the configured schema marker, and the required columns.
6. Open the repository in a Copilot host that loads workspace extensions. The extension is located at `.github/extensions/project-kanban/extension.mjs`.

## Host support and releases

The currently verified host is the VS Code Copilot SDK canvas host exercised in this workspace. The exact host build was not captured during this assessment and must be recorded when validating a release candidate. Any other host or host/version combination is not yet validated and has no compatibility guarantee until explicitly tested and listed in a release. Support is never inferred from SDK similarity.

The first authoritative release may be scoped to the verified host; additional-host work tracked by RM-001 and RA-001 remains open and does not block that limited scope. See the [release and consumer synchronisation contract](release-governance.md) for versioning, validation, adoption, and rollback.

The extension reads and writes only the configured workspace-relative Markdown files. It stores no task database or private board state.

At canvas open, the extension uses the Copilot session working directory when the host supplies it. Otherwise, it searches up from the extension's real location for a unique `project-kanban.config.json`, within a bounded depth of 64 directories. Missing, invalid, or ambiguous configuration is reported explicitly; the extension does not fall back to the process working directory. Alternate extension nesting is supported.

## Install the portable global instructions

`copilot-instructions.md` is intentionally project-independent, but a repository file cannot apply itself to every workspace. Copy or merge its contents into the user/global Copilot instructions supported by the host when cross-project behavior is desired. Keep project-specific architecture, task conventions, and implementation rules in `AGENTS.md`.

## Configure a new source

Add a source entry with a unique key, relative path, ID prefix and width, category/tone, and any source-specific extra fields. Create the Markdown file and table before opening the board. The config validator rejects paths outside the workspace and invalid or duplicate values.

The shared runtime reads only configured schema-v1 task tables and never infers or converts historical formats. Keep any required one-time conversion in an explicit utility owned by the project whose documents need conversion. A source may list historical ID prefixes in `legacyIdPrefixes`; those aliases affect task-ID validation but do not change the prefix used for newly allocated IDs.

## Validate locally

No package installation is required. With Node.js available, run:

```sh
node --test .github/extensions/project-kanban/*.test.mjs
```

The `examples/independent-project/` fixture demonstrates a project with different statuses, sources, prefixes, and task fields.

The `examples/synthetic-browser-project/` fixture contains fictional roadmap, debt, and audit-style rows for board UX testing. Run `node examples/synthetic-browser-project/serve.mjs` from the repository root to open it in a browser. All new browser and UX checks should use this isolated workspace; its server persists only to the fixture documents.

## Enable GitHub template mode

After pushing this repository to GitHub, open repository **Settings → General** and enable **Template repository**. This local project scaffold is not published or marked as a template automatically.
