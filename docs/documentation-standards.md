# Documentation Standards

## Source of truth

Project state is maintained in Markdown. Kanban cards, reports, and other generated views must be reproducible from their source documents. Canvas edits update the corresponding canonical task row; do not track task state only in extension memory.

Preserve prose, evidence, and historical context when adding structured data. Use links rather than copying the same explanation or ownership into multiple documents.

## Document responsibilities

| Document | Responsibility |
|---|---|
| `roadmap.md` | Planned work, current work, completed milestones, and future ideas |
| `technical-debt.md` | Known limitations, severity/priority, recommended fix, and rationale |
| `repository-audit.md` | Audit scope, findings, evidence, and actionable cleanup or investigation work |
| `architecture.md` | Current components, boundaries, and data flows |
| `decisions.md` | Significant decisions, alternatives, rationale, and consequences |

Use the starters in [`templates/`](templates/). Projects may use fewer documents when the corresponding domain does not exist.

## Kanban task tables

The canvas reads documents configured in `project-kanban.config.json`. Each configured source must contain a `## Kanban tasks` section, the exact configured schema marker, and these columns:

| Column | Meaning |
|---|---|
| ID | Stable, source-prefixed task identifier |
| Title | Short, actionable summary |
| Status | One configured workflow state; determines the board column |
| Priority | One configured priority; determines the color tone |
| Order | Non-negative integer; sorts tasks within a status |
| Area | Workstream or domain |
| Category | Human-readable source/work type badge |
| Details | Supporting context, not a replacement for audit evidence |

Sources may add only fields needed by that project's task type. The technical-debt example uses Limitation, Recommended Fix, and Rationale. Keep field keys and labels aligned with config.

Use configured status and priority values exactly. IDs are stable and must not be reused after deletion. Order values should be increasing within a status; the canvas assigns new values automatically. Do not move one task's source ownership by hand.

## Narratives and audit evidence

Keep the audit's scope, observations, and evidence in prose. Convert distinct actionable recommendations into task rows and link duplicate recommendations to their canonical task owner. A task row is a navigable work record, not a replacement for the evidence that supports it.

## Decisions and maintenance

Record significant architectural, persistence, security, or schema decisions in `decisions.md`. Each decision should include Status, Observations, Assumptions, Alternatives considered, Decision, and Consequences.

When code changes affect documented behavior, update the affected document in the same change. If no documentation update is appropriate, state why in the completion summary.
