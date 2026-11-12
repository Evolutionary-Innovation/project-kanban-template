# Project Kanban Template v3.0.0 Release Plan

## Status

Candidate preparation is in progress. Do not create the `v3.0.0` tag or publish a GitHub Release until validation is complete and the candidate is reviewed.

## Release scope

The first post-inversion release includes the generic runtime and UX work completed after the published `v2.0.0` release:

- RM-003: deterministic dependency suggestions.
- RM-004: reconcile generic extension behavior across consumers.
- RM-005: release and consumer synchronization governance.
- RM-007: dependency graph UX improvements.
- RM-008: task creation and editing UX, including first-class Acceptance Criteria.
- RM-009: sorting and filtering UX improvements.
- TD-02 through TD-05: portable tests, repository-agnostic workspace-root discovery, workspace-scoped write locks, and isolation of project-specific legacy conversion.
- Responsive search/filter controls, footer and graph-toolbar improvements, task inspector and card refinements, lifecycle-date behavior, and the read-only planning advisor already present in the runtime.

The planning advisor remains an optional capability dependent on an experimental host API; the release must not imply it is supported unless that capability is tested on the exact host/SDK tuple.

RM-001 additional-host validation, RM-002/RM-006 future ideas, and TD-01 lock-recovery research are not completed release scope. Template examples, synthetic fixtures, and Template-only tests are not consumer runtime payload.

## Semver decision

Use **v3.0.0**. Published `v2.0.0` included configured legacy-format parsing and migration. The current runtime no longer parses or converts non-canonical task documents; `legacyAdapter` is retained only as a validated no-op. Since `v2.1.1` was tag-only and no deprecation release was published, this removal is incompatible with the published runtime contract. The user approved the major-version path and explicitly rejected restoring legacy parsing.

`v2.2.0` and `v2.3.0` were not published; neither tag nor release may be created or reused.

## Compatibility statement

The release supports:

- Canonical Markdown task tables using `## Kanban tasks` and `project-kanban-schema:1`.
- `project-kanban.config.json` with `configVersion: 1`.
- Optional first-class Acceptance Criteria; older schema-v1 tables without the column remain readable and gain it on a normalizing write.
- Configured date fields, statuses, priorities, sources, task ID prefixes, and historical aliases via `legacyIdPrefixes`.
- The existing Markdown write transaction, exclusive workspace lock, revision checks, atomic replacement, and conflict detection.

The release does not parse or migrate legacy/non-canonical task formats. A `legacyAdapter` configuration field may remain for compatibility but has no parsing or conversion behavior. Such documents must be converted to canonical schema-v1 tables with a project-owned utility before upgrading.

Host support is limited to VS Code 1.144.0 x64 on Linux, build `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`, and the capabilities verified on the exact release candidate. The Copilot SDK version was not independently exposed in the existing evidence; claim SDK 1.0.27 only if candidate validation verifies it. Other hosts are unvalidated and have no compatibility guarantee.

## Migration guidance

### Consumers already using canonical schema-v1 tables

No task-table schema or configuration version bump is required. Existing tables may omit Acceptance Criteria; reads return a blank value and the column is added on a normalizing write. Do not invent historical criteria or completion dates. Preserve consumer configuration, task rows, ID-sequence markers, task IDs, dependencies, and project documentation during runtime adoption.

### Consumers using legacy or non-canonical task documents

1. Inventory every configured source and confirm whether it contains the canonical heading, schema marker, and required configured columns.
2. Before upgrading, make a recoverable copy and use an explicit migration utility owned by the project whose document format is being converted. Do not rely on `legacyAdapter` or normal board CRUD to infer or rewrite legacy formats.
3. Convert each source to a canonical schema-v1 task table. Preserve task IDs, historical prefixes, references, narrative content, dates, source ownership, and ID high-water markers. Keep `legacyIdPrefixes` where required for historical IDs; it is independent of parsing.
4. Validate task counts, IDs, order, dependency links, dates, and source hashes against the pre-migration copy. Test the converted documents with the v3 candidate in a disposable workspace before adoption.
5. Keep the archived source and converter in the owning project. Remove the no-op `legacyAdapter` config key only as a separate reviewed cleanup.

Completion Date is not backfilled for historical tasks with unknown dates. A transition into the configured completion status sets/replaces the date; reopening retains the stored date.

### Trade-MSTR adoption gate

Trade-MSTR adoption begins only from the published v3.0.0 release. Create `feature/adopt-kanban-template-v3.0.0` from `dev`, perform Phase 1 only, preserve its config and Markdown data, and stop for review before Phases 2 or 3. Confirm its three configured source documents are canonical before sync. Its `legacyAdapter` keys do not provide conversion; preserve `legacyIdPrefixes: ["TD"]` and validate the historical `TD-20` record and references. Add the previously approved blank Acceptance Criteria column to all three tables only in the separately approved consumer migration.

## Candidate validation and release gate

Candidate commit: **pending the release-documentation commit**.

Validation completed against the current runtime tree:

| Check | Result |
|---|---|
| Generic extension, Template integration, and disposable consumer smoke suites | **Passed: 104/104 tests**, 0 failures. Command: `KANBAN_CONSUMER_ROOT=/home/andy/Development/Projects/trade-mstr node --test .github/extensions/project-kanban/*.test.mjs .github/extensions/project-kanban/template-integration/*.test.mjs .github/extensions/project-kanban/consumer-integration/*.test.mjs`. |
| Synthetic browser fixture | **Passed:** board loaded 60 fictional tasks; Dependencies rendered an SVG with 61 nodes including the unresolved-reference placeholder; no browser console errors. Visited 1440, 1024, 768, and 390 CSS-pixel viewport widths. The accepted UI/UX is treated as final. |
| Synthetic fixture preservation | Config and the three task-source SHA-256 values were captured before the browser check; verify those values again before candidate review. |
| Markdown/runtime safety | The 104-test run includes CRUD, lock/revision/conflict, atomic persistence, schema, lifecycle, graph, and adapter-contract coverage. |
| Diff whitespace validation | `git diff --check` passed for the release-documentation changes. |
| Release identity | Published GitHub Release remains `v2.0.0`; tags `v2.2.0`, `v2.3.0`, and `v3.0.0` are absent. Current runtime commit is `e1ce371ae77632be6d35bc8b598cf47a0c1e4157`. |

The documented VS Code host baseline is 1.144.0 x64 on Linux, build `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`; the SDK version was not independently exposed. The existing host evidence is from candidate `190aefb22133ba84891f46e67b0cb25c1842a280`, not this release candidate. Do not claim SDK 1.0.27 or imply host validation against the final candidate unless confirmed during release review.

Before review, run the exact validation command from a clean detached worktree at the selected candidate commit; verify synthetic fixture hashes are unchanged; recalculate and compare all payload hashes in this document; and record the selected commit and worktree state. Do not revisit accepted UI/UX findings.

Do not tag or publish until candidate validation is complete and the candidate has been reviewed. Any failed gate requires a corrected candidate and rerunning affected validation. Create an annotated immutable `v3.0.0` tag and GitHub Release only after explicit review approval.

## Release-notes draft

> **Project Kanban Template v3.0.0**
>
> **Status:** Draft; not published.
> **Commit:** `<validated candidate commit>`
>
> This major release makes the Project Kanban Template the authoritative generic implementation and adds task-entry, search/filter, sorting, collapse, responsive board/graph, inspector, and dependency-suggestion improvements. Markdown remains the source of truth. Task-table schema v1 and `configVersion: 1` remain supported for canonical sources.
>
> **Breaking change:** legacy-format parsing and automatic migration have been removed. The `legacyAdapter` config field is a no-op and does not enable parsing. Convert non-canonical task documents to canonical schema-v1 tables with a project-owned utility before upgrading. Historical ID aliases remain supported through `legacyIdPrefixes`.
>
> **Acceptance Criteria:** optional first-class field; older schema-v1 tables without the column remain readable. No criteria or historical completion dates are inferred.
>
> **Host compatibility:** `<exact host, build, operating system, SDK version, and verified capabilities from candidate evidence>`. All unvalidated hosts are unsupported for compatibility guarantees. Planning advice remains optional/experimental unless separately validated.
>
> **Migration:** see the migration guidance in this plan and the final release notes.
>
> **Validation:** `<candidate-specific test and browser results>`.
>
> **Consumer runtime payload:** use only the exact paths and SHA-256 hashes listed below. Do not copy the Template repository, project configuration, examples, fixtures, or Template-only tests.

## Consumer payload inventory

The runtime payload consists of 16 extension modules/assets, Dagre, and both required license notices. `vendor/README.md` is included as supporting provenance documentation, not executable runtime code. Do not sync the extension README, tests, fixtures, project configuration, or example task data.

| Path | SHA-256 |
|---|---|
| `.github/extensions/project-kanban/extension.mjs` | `1e1270e13974ed4319a26669aaae3eae1c6c0e5d6f05790fd199868dd77de1a8` |
| `.github/extensions/project-kanban/workspace-root.mjs` | `336cdfcd91b081c72f0521b52bab5ffa99b911375f7147ab8766bc104395208c` |
| `.github/extensions/project-kanban/planning-context.mjs` | `c36477133db9e3eb172c0c3c2400eeaef8d40318635c7827bd6489844f7c56e9` |
| `.github/extensions/project-kanban/board-server.mjs` | `acd5b8803ec44a3653d2c685a80f34436680de0b8ac7bb0ded17a3ae24b5dafa` |
| `.github/extensions/project-kanban/board-storage.mjs` | `c15ac921e170f6f8e20b33c25d779a676a8f7fc0064e64e7de0345bcc1681d30` |
| `.github/extensions/project-kanban/board-config.mjs` | `41a38ab4b8952d65d0d2136a4137d900e613f0f4b8121d7956d49d9ca3da4bb8` |
| `.github/extensions/project-kanban/board-data.mjs` | `0ea92deedb5805310b8772998f91b3a951fffa8efa683910787fa24f39f32482` |
| `.github/extensions/project-kanban/board-dependencies.mjs` | `94243c0b17ed7bb0773f2d8222f19e3a90b07d7422bf36826616fbc3dacc0ce9` |
| `.github/extensions/project-kanban/board-page.html` | `8ef58410ac83dc1db93cf03be165886a94bb5aa66c746e3df363ea2182fd07a4` |
| `.github/extensions/project-kanban/board.css` | `c90c936f09de1bf8b8f455e492e1c38aba16c296a74353f9535dff6d84da296f` |
| `.github/extensions/project-kanban/board-client.js` | `0dd2690b18a15ae3b2e62b306a7a3e6888a55bebff6503d3af960eb85d702bae` |
| `.github/extensions/project-kanban/board-client-interactions.mjs` | `897270386d0108c07ddab67fedb83e9e07dacdf598654c840f9d9a322d0fb957` |
| `.github/extensions/project-kanban/board-view.mjs` | `1bbf8fe9641d4121db449d8ebcee6a001738f4506d0c14802612c88e586de6a8` |
| `.github/extensions/project-kanban/board-graph-client.js` | `553a5e59918797ac2d0fa4227d177c6d16e0a1f545c97620475eca87ef5498b3` |
| `.github/extensions/project-kanban/board-graph.mjs` | `5def685710f4e14d7758f2e1b0b5722683a3c66a396a3486b783f53b0c590336` |
| `.github/extensions/project-kanban/board-graph-worker.mjs` | `c5262a5e888a1e5a05f588e10baf8f91c0ab82013500dc7b2b054623ace820c3` |
| `.github/extensions/project-kanban/vendor/dagre-3.1.3.mjs` | `b0ddaf4af1417bec9bd89373a3a3987f081727d6cc6d95fc40dbf85a19bdf3b0` |
| `.github/extensions/project-kanban/vendor/dagre-LICENSE` | `6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015` |
| `.github/extensions/project-kanban/vendor/graphlib-LICENSE` | `6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015` |
| `.github/extensions/project-kanban/vendor/README.md` | `aeee73765fdf274457b6e29594f6329431da285d426a6d274e9482ac93c7b94a` |
