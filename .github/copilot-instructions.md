# Version 2.2

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

Use Sequential Thinking when:

- Multiple plausible root causes exist.
- Architecture decisions are required.
- Significant trade-offs must be evaluated.
- The correct implementation approach is unclear.
- Root cause remains uncertain after initial investigation.

During reasoning:

- Explicitly separate observations, assumptions and conclusions.
- Consider alternative explanations and approaches.
- Prefer evidence and verification over intuition.

Avoid extensive sequential analysis when:

- Logs identify a likely fault location.
- Failing tests identify the cause.
- A schema mismatch is evident.
- A validator, type, import, route, unit or configuration problem has been isolated.
- A minimal, low-risk fix is apparent.

In these situations prefer:

observe → patch → test → verify

over extended investigation.

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

Documentation effort must be proportional to the change.

Major feature work, architectural changes and new workflows
require detailed documentation updates.

Routine bug fixes, test fixes, validation fixes and
configuration fixes should only update documentation when:

- behaviour changes intentionally
- architecture changes
- a new limitation is discovered
- future work must be tracked

Do not create documentation updates merely because code changed.

Before significant architectural, infrastructure, security,
data-model or workflow changes review:

- docs/architecture.md
- docs/decisions.md

Before roadmap or task planning work review:

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

## Project Planning Documentation Generated During Agent Interactions

For every roadmap item, task, initiative, RM, RA, TD, etc or project code:

1. All chat specific planning documents created during execution must be stored under:

   docs/<task-code>/

   Examples:
   docs/rm-090/
   docs/rm-071/
   docs/ra-002/
   docs/td-050/

2. Planning documents include, but are not limited to:
   - plan.md
   - design.md
   - implementation.md
   - deployment.md
   - validation.md
   - phase documents
   - migration plans
   - architecture notes
   - decision records specific to the task

3. Documentation review must be proportional to the change.

   Required for:
   - New feature development
   - Architecture work
   - Deployment work
   - Multi-file refactoring
   - Roadmap planning
   - Technical debt initiatives

   Optional for:
   - Localised bug fixes
   - Validation fixes
   - Build fixes
   - Test fixes
   - Configuration fixes

   For isolated defects, review only the documents directly relevant
   to the affected functionality.

4. Do not rely solely on conversational history or memory when a task folder exists.

5. If a task folder exists but has not been reviewed during the
   current session:

   Required before:
   - planning new feature work
   - architecture work
   - roadmap updates
   - phase completion decisions
   - deployment work

   Optional for:
   - localised bug fixes
   - validation fixes
   - build fixes
   - configuration fixes
   - test fixes

   For isolated defects, review only the documents directly related
   to the affected functionality.

6. If the user references:
   - "the plan"
   - "the roadmap"
   - a task code (RM-090, RA-002, etc.)
   - a project phase
   - a migration or deployment effort

   first review the corresponding docs/<task-code>/ documents before responding.

7. Documentation in the task folder overrides conversational summaries when conflicts exist.

8. Always update the relevant planning documents in the task folder to reflect new decisions, changes, or progress.

---

## Phase Awareness

When a task contains defined phases (A-E, Phase 1-5, etc.):

- Read the phase plan before continuing work.
- Track progress against the documented phases.
- Report status using the phase structure defined in the task documents.
- Do not infer phase structure solely from chat history.
- Update the phase plan as progress is made or changes occur.

## Phase Reconstruction

When a task references phases
(A-E, Phase 1-5, etc.):

1. Read the phase plan before reporting status.
2. Determine current phase from documented progress.
3. Track and report progress using the documented phase structure.
4. Never infer phase status from partial conversation history.

---

## Session Recovery

When resuming an existing task after a new chat, checkpoint restore,
or loss of context:

1. Read the task folder before taking any action.
2. Reconstruct task state from:
   - plan.md
   - phase documents
   - implementation notes
   - validation notes
   - roadmap status
3. Do not rely on conversational memory for task state.
4. Treat the task folder as the authoritative recovery source.

---

## Investigation Loops

If the same blocker has been analysed repeatedly
without producing:

- new evidence
- code changes
- configuration changes
- test results

then:

1. Stop repeating analysis.
2. State the missing evidence explicitly.
3. Obtain the evidence or request it.
4. Do not create additional roadmap or documentation updates
   unless new evidence exists.

A blocker is considered analysed when:

- a root cause has been identified, or
- a specific hypothesis can be tested directly.

Do not continue investigation solely to increase confidence when a low-risk validation path exists.

Prefer proving or disproving hypotheses through implementation and testing.

Prefer moving to implementation and testing once sufficient evidence is available.

## Investigation Budget

Investigations must be proportional to risk.

### Low Risk

Examples:

- Bug fixes
- Validation fixes
- Unit mismatches
- Type errors
- Build issues
- Configuration issues
- Test failures

Approach:

- Identify likely root cause.
- Inspect only the files directly involved.
- Implement the smallest safe fix.
- Validate using focused tests.
- Stop once the fix has been verified.

Maximum initial scope:

- One root-cause hypothesis.
- Files directly involved in execution path.
- Focused test execution.

Expand scope only if evidence contradicts the current hypothesis.

### Medium Risk

Examples:

- Multi-component feature changes
- Refactoring
- API changes

Broader investigation is permitted.

### High Risk

Examples:

- Architecture changes
- Security-sensitive changes
- Infrastructure changes
- Data model changes

Comprehensive investigation is encouraged.

Avoid continuing investigation once:

- Root cause has been identified.
- Supporting evidence exists.
- A minimal safe fix is available.
- Verification can be performed through testing.

At that point move to implementation.

## Bug Fix Fast Path

When:

- Production logs identify a likely cause.
- A failing test identifies the cause.
- A schema mismatch is evident.
- A validation rule is failing.
- A type error identifies the location.
- A unit mismatch is evident.
- A configuration defect has been isolated.

The preferred workflow is:

1. Confirm the evidence.
2. Implement the smallest safe fix.
3. Run targeted validation.
4. Verify the result.
5. Stop.

Do not broaden the investigation unless:

- The fix fails.
- Contradictory evidence appears.
- Additional root causes are identified.
- The change becomes architectural in nature.

Prefer restoring correct behaviour over continued root-cause exploration once sufficient evidence exists.

---

## Canvas Management

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

## Task Completion Bias

The objective is to complete work safely and efficiently.

Do not maximise analysis for its own sake.

When a likely root cause has been identified:

1. Implement the smallest safe fix.
2. Run the minimum validation required.
3. Verify the result.
4. Stop investigating unless contradictory evidence appears.

Prefer:

- fixing over theorising
- testing over speculation
- delivery over additional analysis

Do not broaden scope without evidence.

## Analysis Termination

Analysis should terminate when:

- A root cause has been identified.
- Supporting evidence exists.
- A low-risk fix exists.
- Validation can prove the outcome.

Further investigation requires a specific unanswered question.

Do not continue analysing solely to:

- Increase confidence.
- Gather additional supporting evidence.
- Re-read previously reviewed documentation.
- Revisit resolved hypotheses.
- Explore unrelated components.

Implementation and validation are preferred over additional analysis when sufficient evidence exists.

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

Sufficient evidence is sufficient.

Once evidence supports a likely conclusion and a low-risk
validation path exists:

- Prefer implementation over additional analysis.
- Prefer testing over further investigation.
- Prefer verification over confidence-seeking.

Do not continue gathering evidence only to increase confidence
when the result can be validated directly.

---

# Docker Storage Hygiene Policy

## Objective

Prevent Docker, BuildKit and containerd artefacts from silently filling the Linux root partition during development work.

The workstation root volume is only 59 GB and Docker build activity has repeatedly filled it above 95% utilisation. Docker hygiene is therefore a mandatory part of all build, validation and deployment workflows.

---

## Always Safe Cleanup

After completing any Docker build, validation, smoke test, CI simulation, ECR push or image generation workflow, execute:

```bash
docker builder prune -a -f
```

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
