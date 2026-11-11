# Project Kanban Template: Agent Guidance

## Project scope

This repository is a reusable GitHub template. Keep the canvas generic and small; project-specific task labels, source paths, ID prefixes, statuses, priorities, and extra fields belong in `project-kanban.config.json`, not in the core modules.

## Documentation ownership

- `docs/architecture.md` describes how this template and its extension work.
- `docs/decisions.md` records why significant design choices were made.
- `docs/roadmap.md` tracks planned and completed work.
- `docs/technical-debt.md` records limitations and remediation.
- `docs/repository-audit.md` records evidence-based findings and actionable audit work.
- `docs/documentation-standards.md` defines document responsibilities and task-table rules.

Before significant changes, review relevant documents. After changes, update affected documentation and explain when no update is needed. Use templates from `docs/templates/` when starting documents.

## Markdown task invariants

- Markdown files are authoritative; the canvas is a generated view/editor.
- Preserve narrative content when creating or updating task tables.
- Use the exact configured schema marker and standard task columns.
- Status values and priority names must come from `project-kanban.config.json`.
- Acceptance Criteria is an optional first-class task field. Write concise, observable outcomes when useful; leave it blank rather than inventing criteria for historical or unsuitable tasks.
- Do not add a source-specific parser to the generic core. Legacy Markdown inference must be an explicit, reviewed adapter.
- Preserve stable task IDs, per-status order, and source ownership.

## Persistence and security

All task writes must use the existing storage transaction. Do not bypass source validation, workspace-relative path checks, revision hashes, the exclusive lock, atomic replacement, file-mode preservation, or HTTP 409 conflict behavior. Validate config, actions, and HTTP inputs; keep user-provided text in text nodes and Markdown-escape table cells.

Do not add dependencies or a framework without a documented need and an architectural decision. Test the default and independent example configurations.
