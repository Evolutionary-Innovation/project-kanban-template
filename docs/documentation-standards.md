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
| Title | Short, actionable summary, conventionally written as `<ID>: <title>` in board-facing records |
| Status | One configured workflow state; determines the board column |
| Priority | One configured priority; determines the color tone |
| Order | Non-negative integer; sorts tasks within a status |
| Area | Workstream or domain |
| Category | Human-readable source/work type badge |
| Details | Supporting context, not a replacement for audit evidence |
| Evidence | Optional source evidence for the task |
| Limitation | Optional description of a constraint or defect |
| Recommended Fix | Optional proposed remediation |
| Rationale | Optional explanation of the recommendation |
| Recommendations | Optional follow-up guidance retained for existing project schemas |
| Depends On | Optional comma-separated IDs of prerequisite tasks across configured sources |
| Execution Type | Optional configured execution mode; descriptive metadata only |
| Created Date | Optional, unknown for historical rows unless verified |
| Completion Date | Optional date of the most recent completion |

The default template config uses the same columns across Roadmap, Technical Debt, and Research/Audit. Fields after Category are optional; projects may configure only the fields they use, but each source in one project should share its configured field contract. `Blocked By` is derived from `Depends On` and is not stored as a separate column. Keep field keys and labels aligned with config.

Store the title text as it should read on the card; do not prepend a category or source label or append a duplicate task ID. The board displays the title verbatim and omits the source ID label when the title already begins with `<ID>: `.

Use configured status and priority values exactly. IDs are stable and must not be reused after deletion. Order values should be increasing within a status; the canvas assigns new values automatically. Do not move one task's source ownership by hand.

The extension stores each source's next task ID in a `<!-- project-kanban-id-sequence:PREFIX:N -->` comment outside the task table. Keep the comment when editing Markdown manually. On first initialization, the extension can only use active task rows; if older IDs have already been deleted, set `N` above the highest ID ever allocated before the first board write.

Lifecycle dates are configured independently as `createdDate` and `completionDate` extra fields with type `date` on each source. Existing projects keep schema v1 by adding desired fields to each source config and table header. When configured, `createdDate` is filled on task creation; do not invent dates for historical records. `completionDate` is set on creation in the configured completion status or on every transition into it, so the latest completion wins; it remains unchanged when reopened and can be manually corrected. The board displays `Added` for active tasks and `Completed` for completed tasks, omitting unknown dates; a reopened task also shows its retained `Last completed` date.

Card presentation uses this hierarchy: display-only `ID: Title`, one Category badge, populated configured content sections, dependency relationships, then a subtle lifecycle footer. The renderer removes configured source/category prefixes and duplicate IDs from the displayed title without rewriting the Markdown title. It does not show redundant Status, Priority, Area, source-filename, or second-ID labels; priority remains indicated by the card border.

Details and configured populated fields are rendered independently using their configured labels. Empty fields remain omitted. Dependency sections follow content sections and remain visible when the card is collapsed. Lifecycle dates follow relationships and also remain visible when collapsed; display only known dates. Collapse hides Details and configured content fields, retaining the title, category, dependency summary, and lifecycle date.

`Execution Type` remains editable, searchable metadata but is not part of the compact card summary.

`Depends On` values are comma-separated stable task IDs matching configured source prefixes. IDs must be unique within the field and cannot refer to the task itself. Unresolved IDs are allowed so work can be staged before its prerequisite is created; they remain visible as unresolved blockers. New dependency edits that would create a cycle are rejected. `Blocked By` is derived from unresolved or not-yet-complete prerequisites using the configured completion status. Existing cycles are surfaced for repair rather than silently rewritten. The board's graph projection is derived from these links, with each resolved edge directed from prerequisite to dependent.

`Execution Type` is optional, configured-choice metadata. It must not be interpreted as a model/provider selection, a claim, or an instruction to execute work automatically.

## Board views

Search covers task IDs, titles, details, configured fields, and dependency references. Search results remain in their original status columns. Source, priority, category, area, and dependency-state filters combine with search; each column can use an independent view-only sort. These controls do not write Markdown or change canonical `Order`. Search, filters, sorts, and collapsed-card state are held in memory for the open canvas session.

Manual drag and keyboard reordering are disabled while search or filters hide tasks, or while that column uses a non-manual sort. Clear the view filters and select Manual order to reorder. A task's Status control remains available to move it to the end of another status column.

The sticky board status footer reports the current visible/total task counts and refresh time. Source paths and shortened revision hashes remain available in its disclosure; the full revision hashes continue to protect writes.

Canonical schema-v1 tables may be read even when they predate configured optional columns. Missing values are treated as blank. The first subsequent mutation normalizes that source table to its configured column order within the existing locked, revision-checked, atomic write; it does not infer historical values or rewrite surrounding narrative.

## Narratives and audit evidence

Keep the audit's scope, observations, and evidence in prose. Convert distinct actionable recommendations into task rows and link duplicate recommendations to their canonical task owner. A task row is a navigable work record, not a replacement for the evidence that supports it.

## Decisions and maintenance

Record significant architectural, persistence, security, or schema decisions in `decisions.md`. Each decision should include Status, Observations, Assumptions, Alternatives considered, Decision, and Consequences.

When code changes affect documented behavior, update the affected document in the same change. If no documentation update is appropriate, state why in the completion summary.
