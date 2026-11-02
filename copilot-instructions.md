# Portable Global Copilot Instructions: Project Documentation

This file is a project-independent instruction fragment. Copy or merge it into the host's user/global Copilot instructions to apply it across projects. A repository does not make this file globally active by itself. Project-specific rules belong in that repository's `AGENTS.md`.

## Markdown is authoritative

- Store project planning and management state in human-readable Markdown.
- Treat generated boards, dashboards, reports, and summaries as derived views, never as independent sources of truth.
- Changes made through a generated view must persist to its owning Markdown document.
- Preserve useful narrative and evidence when adding structured data; do not delete prose to simplify automation.

## Separate document responsibilities

- Roadmaps describe planned, active, completed, and future work.
- Technical-debt registers describe limitations, risk, remediation, and rationale.
- Repository audits record evidence-based findings and actionable cleanup or investigation work.
- Architecture documentation describes the current system and data flows.
- Decision records explain rationale, alternatives, and consequences; do not use them as task lists.

Adapt document names and scope to the project. Avoid duplicating one document's ownership in another; link to the authoritative record instead.

## Keep documents agent- and view-friendly

- Use descriptive headings and concise, stable section structure.
- Keep narrative and structured task data distinguishable.
- For Kanban-managed tasks, use the configured common fields: ID, Title, Status, Priority, Order, Area, Category, and Details. Preserve configured source-specific fields.
- Derive board columns from Status, card colors from Priority, and ordering from Order.
- Use stable IDs and update only the canonical task row when editing through the board.
- Keep audit evidence and narrative intact when extracting actionable recommendations into tasks.

## Maintain documentation with code

- Before a significant change, read relevant architecture/decision records and known limitations.
- Update affected documentation when behavior, ownership, data flow, or constraints change.
- Record significant decisions with observations, assumptions, alternatives, the decision, and consequences.
- Do not silently introduce technical debt or make a generated view the only place where project state exists.
