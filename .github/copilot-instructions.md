# Global Engineering Principles

These rules apply to all projects unless explicitly overridden.

---

## Primary Goals

Prioritise:

1. Maintainability
2. Correctness
3. Simplicity
4. Educational value
5. Development speed

Never sacrifice maintainability, correctness or simplicity solely to increase velocity.

---

## MCP Usage

### Serena

When exploring or modifying a codebase:

- Prefer Serena for symbol navigation, references, dependency analysis and architecture discovery.
- Use semantic exploration before broad file inspection.
- Fall back to manual file reading only when necessary.

### Context7

Before using framework or library documentation:

- Determine the version used by the project.
- Prefer documentation matching the installed version.
- Use latest-version documentation only when no project version is available or explicitly requested.
- Highlight important version differences when relevant.

### Sequential Thinking

For non-trivial design, architecture, debugging or planning tasks:

- Explicitly separate observations, assumptions and conclusions.
- Consider alternative explanations and approaches.
- Prefer evidence and verification over intuition.

---

## Architecture

- Every module, component, service and folder should have a clear responsibility.
- Keep state ownership explicit and singular.
- Avoid duplicated business logic.
- Prefer pure functions for business logic where practical.
- Keep modules focused and cohesive.
- Avoid unnecessary abstractions.
- Introduce complexity only when justified.

Before adding code ask:

- Which domain owns this behaviour?
- Does an implementation already exist?
- Would this increase coupling?
- Is there a simpler solution?

Architecture should make future change easier, not harder.

---

## Documentation

Documentation is part of the deliverable.

Before significant changes review:

- docs/architecture.md
- docs/decisions.md
- docs/roadmap.md
- docs/technical-debt.md

After significant changes review whether updates are required for:

- docs/architecture.md
- docs/decisions.md
- docs/roadmap.md
- docs/technical-debt.md
- docs/repository-audit.md

Document ownership:

- architecture.md documents HOW the system works.
- decisions.md documents WHY the system works that way.
- roadmap.md tracks planned work and completed milestones.
- technical-debt.md tracks known limitations and future cleanup.
- repository-audit.md tracks unused code, dependencies and housekeeping items.

If a change introduces:

- a new architectural rule
- a design constraint
- an ownership boundary
- an invariant
- a data flow change
- a caching strategy
- a state-management approach
- a significant engineering principle

record it as a new ADR in docs/decisions.md.

If no documentation updates are required, explicitly state this in the completion summary.

---

# Project Documentation Standard

## Purpose

All project planning and management information must be stored in markdown documents that can act as both:

1. Human readers.
2. AI agents and generated views.

Markdown documentation is the authoritative source of truth.

Generated artifacts such as:

- Kanban boards
- Dashboards
- Roadmaps
- Reports
- Progress summaries
- Knowledge graphs

should be derived from documentation rather than acting as separate sources of truth.

---

## Source Of Truth Principle

Project state must be stored in markdown documents.

Generated views may be recreated at any time.

Changes made through generated views should persist back to the underlying markdown.

---

## Separation Of Concerns

Documentation should separate:

### Structured Data

Examples:

- Tasks
- Technical debt
- Risks
- Roadmap items
- Research items

### Narrative Content

Examples:

- Architecture descriptions
- ADRs
- Design rationale
- Lessons learned
- Planning discussions

Narrative content should never be discarded purely to support automation.

---

# Required Documents

## roadmap.md

Contains:

- Current work
- Planned work
- Future ideas
- Delivery priorities

Must contain a canonical task table.

Example:

| ID    | Title       | Status  | Priority | Order | Area      | Category | Details |
| ----- | ----------- | ------- | -------- | ----- | --------- | -------- | ------- |
| RM-01 | Returns Tab | Planned | High     | 10    | Analytics | Feature  | ...     |
| RM-02 | Volatility  | Planned | Medium   | 20    | Analytics | Feature  | ...     |

Status values:

- Complete
- In Progress
- Planned
- Research
- Future Ideas

Priority values:

- High
- Medium
- Low

Narrative planning notes and rationale may follow the table.

---

## technical-debt.md

Contains:

- Known limitations
- Technical risks
- Refactoring opportunities
- Infrastructure concerns

Must contain a canonical task table.

Example:

| ID    | Title         | Status  | Priority | Order | Area           | Category | Limitation | Recommended fix | Rationale | Details |
| ----- | ------------- | ------- | -------- | ----- | -------------- | -------- | ---------- | --------------- | --------- | ------- |
| TD-01 | Missing tests | Planned | High     | 10    | Technical Debt | Testing  | ...        | ...             | ...       | ...     |

Narrative explanations and remediation details should be stored below the table.

---

## repository-audit.md

Contains:

- Audit findings
- Repository cleanup opportunities
- Technical investigations

Actionable findings should be represented as work items using the common schema.

Category should normally be:

- Research
- Audit

May contain a canonical task table.

Example:

| ID    | Title        | Status  | Priority | Order | Area         | Category | Details |
| ----- | ------------ | ------- | -------- | ----- | ------------ | -------- | ------- |
| KB-01 | Example task | Planned | High     | 10    | Example Area | Feature  | ...     |

---

## architecture.md

Contains:

- System overview
- Component descriptions
- Data flow
- Interfaces
- Architectural decisions

Should not duplicate roadmap or task information.

Architecture describes how the system works.

Roadmap describes what should be built.

---

## decisions.md

Contains:

- ADRs
- Technical decisions
- Tradeoffs
- Rejected alternatives

Should explain why decisions were made.

Should not contain implementation tasks.

---

## Categories

Recommended values:

- Feature
- Technical Debt
- Research
- Audit
- Infrastructure
- Documentation

---

## Documentation Design Principles

Documentation should be structured so that future AI agents can generate:

- Kanban boards
- Dashboards
- Reports
- Status summaries
- Progress tracking views

without requiring major reorganisation of the source documents.

Markdown remains the canonical source of truth.

---

# AI Agent Requirements

When generating project canvases:

1. Read authoritative project documents.
2. Use the common task schema.
3. Preserve narrative content.
4. Generate Kanban columns from Status values.
5. Support Status and Order persistence.
6. Never store project state only inside the canvas.
7. Treat markdown as the canonical project database.

## Kanban State Management

Before starting implementation work, the agent must:

1. Identify all roadmap (RM-###), technical debt (TD-##), audit (RA-###), or other tracked tasks that will be affected.

2. Move affected tasks from:
   - Planned → In Progress

3. Commit implementation work.

4. Once implementation, validation, build, lint, and tests pass:
   - Move tasks from In Progress → Complete

5. Update cross-referenced debt items and roadmap entries.

---

Tasks must never move directly from:

Planned → Complete

unless:

- the task required documentation-only changes
- no implementation work was performed

---

For multi-task initiatives:

Example:

RM-049
RM-050
RM-051
RM-052

All affected tasks should be moved to In Progress before implementation begins.

Any unfinished tasks must remain In Progress when work stops.

## Completion Date Lifecycle

When a project configures `completionStatus` and a `completionDate` field:

- Never complete or reopen a task by directly editing its Markdown row.
- Use lifecycle-aware board operations, including the board status control or the `moveTask` / `editTask` action or API.
- After completion, refresh the board and verify that Status is Complete and Completion Date is populated with the current date.
- Verify that reopening preserves the existing Completion Date and recommpletion replaces it with the current date.
- Do not supply or clear Completion Date in the same mutation as a status transition; status transitions own lifecycle-date changes.
- A task is not successfully complete until the refreshed board reflects the expected status and lifecycle date.

---

## Task Dependency Capture

When creating or modifying tasks:

1. Assess prerequisite relationships described in task content.
2. Use `Depends On` only for actual blockers.
3. Review deterministic dependency suggestions before approving them.
4. Do not rely solely on narrative references; approved relationships must be written to `Depends On`.
5. Refresh the board and verify the resulting graph relationships.
6. If a candidate is uncertain, leave it unapproved and report the uncertainty.

Suggestions are review-only and do not affect graph edges, blocker state, workflow analytics, downstream impact, longest-chain calculations, or readiness until approved.

---

When reporting progress, always include:

### Started

Tasks moved to In Progress

### Completed

Tasks moved to Complete

### Deferred

Tasks left Planned

### Blocked

Tasks unable to proceed

---

## Architectural Decisions

Record significant decisions.

Examples:

- architecture
- state ownership
- persistence
- caching
- API design
- security
- testing strategy
- major dependency selection

Record:

- observations
- assumptions
- alternatives considered
- decision taken
- consequences

Record rationale, not merely implementation.

---

## Technical Debt

Technical debt must be intentional.

When accepting debt:

- Explain why it exists.
- Record the preferred future solution.
- Record the cost of keeping it.

Never introduce technical debt silently.

---

## Dependency Governance

Every dependency increases maintenance cost.

Before adding dependencies:

- Explain why they are needed.
- Verify an existing dependency cannot solve the problem.
- Consider maintenance, security and runtime impact.

Prefer removing dependencies over adding them.

Record significant dependency decisions.

---

## Security

- Never commit secrets.
- Never commit credentials.
- Never commit infrastructure state files.
- Prefer least privilege.
- Treat logs as potentially sensitive.

---

## Refactoring

Prefer evolution over rewrites.

Before major refactoring:

- Verify the problem exists.
- Consider simpler alternatives.
- Explain expected benefits.

Do not silently diverge from documented architecture.

---

## Change Scope

Implement the smallest change that satisfies the requirement.

Prefer:

- solving today's problem
- incremental evolution
- preserving flexibility

Avoid:

- speculative architecture
- premature abstraction
- future-proofing without evidence

---

## Testing

New functionality should be accompanied by appropriate automated tests.

Preferred test levels:

- Unit tests for calculations, validation and business rules.
- Integration tests where components interact.
- End-to-end tests for critical user journeys.

For non-trivial changes:

- Explain what changed.
- Explain how it was verified.
- Explain why tests were not added if applicable.

Test behaviour, not implementation.

---

## Evidence Before Conclusions

Treat proposals as hypotheses.

Distinguish:

- observations
- assumptions
- conclusions

Prefer:

- measurement over speculation
- verification over confidence
- evidence over opinion

Ask:

- What evidence supports this?
- What evidence rejects this?
- What evidence do we currently have?

---

## AI Behaviour

Treat AI output as a proposal, not a fact.

- Challenge poor design choices.
- Explain trade-offs.
- Prefer learning and understanding over blind code generation.
- Avoid unnecessary abstraction.
- Validate recommendations against evidence and project guidance.

Project-specific rules belong in AGENTS.md.

---
