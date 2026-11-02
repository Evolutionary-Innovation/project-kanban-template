# Synthetic browser test project

This isolated project contains fictional roadmap, technical-debt, and audit-style
records for browser and UX testing. Nothing in these files is a real project
commitment, technical-debt finding, or repository-audit observation.

All new browser and UX tests should use this project rather than the template's
canonical task registers. To run it locally from the repository root:

```sh
node examples/synthetic-browser-project/serve.mjs
```

The server prints its loopback URL and writes only the Markdown files in this
fixture. Stop it with Ctrl+C. The optional `PORT` environment variable selects a
specific local port.

Titles use the fixture's `ID: Title` convention. Synthetic Created Date and
Completion Date values exercise lifecycle display, sorting, and completion
behavior; selected records intentionally have unknown dates. The board
populates Created Date when a task is created and replaces Completion Date on
each transition into the configured completion status.

The dependency graph includes a 23-task cross-source chain, broad branches,
multi-prerequisite merges, a completed prerequisite, and an isolated task.
Completed tasks depend only on completed prerequisites; `RM-017` is dependency
ready while still incomplete. `RM-001`/`RM-002` form a pre-existing cycle, and
`RM-019` references the unresolved `TD-999`.
