# Release and Consumer Synchronisation Governance

## Purpose and ownership

The Template is the authoritative home for generic Project Kanban behavior. Consumers adopt reviewed, versioned releases; they do not become parallel implementation branches.

| Responsibility | Template owns | Consumer owns |
|---|---|---|
| Generic implementation | Extension runtime, shared interfaces, configuration and schema-v1 contracts | No permanent generic runtime fork |
| Tests | Generic contracts, Template integration tests, fixtures, synthetic browser project, reusable disposable consumer-smoke harness | Consumer-specific integration checks and their execution evidence |
| Project content | Template examples and documentation about generic behavior | Project configuration, source paths, task data, roadmap/debt/audit content, project documentation, domain integrations |
| Release | Architecture, ADRs, release tags, release notes, compatibility statements, runtime payload inventory | Consumed version/commit, local deviations, sync date, consumer approval |
| Migration history | Generic migration guidance, if applicable | Archived project-specific migration artifacts and project-owned conversions |

The reusable smoke-test harness is Template-owned; a consumer owns its project-specific smoke procedure, results, and any additional domain checks. The consumer's configuration and Markdown remain authoritative and are never replaced as part of a runtime sync.

## Versioning and compatibility

Template runtime releases use `vMAJOR.MINOR.PATCH`:

| Level | Use |
|---|---|
| MAJOR | Incompatible runtime, action/API, configuration, task-table, or supported-host contract change; include an upgrade path. |
| MINOR | Backward-compatible user-facing capability or configuration addition. |
| PATCH | Backward-compatible defect correction, hardening, or release-relevant documentation correction. |

Version numbers describe different contracts and must not be conflated:

| Version | Meaning | Current value |
|---|---|---|
| Extension release | Versioned runtime behavior and its documented compatibility contract | Latest published release `v2.0.0`; `v2.1.1` is tag-only |
| Task-table schema | Markdown table marker and parser contract | Schema v1 (`project-kanban-schema:1`) |
| Configuration | Shape accepted by `project-kanban.config.json` | `configVersion: 1` |
| Consumer compatibility | Schema/config versions and host/capabilities explicitly supported by a release | Declared in each release's notes |

Schema and configuration versions evolve independently of the extension release. A backward-compatible optional configuration addition may keep `configVersion` unchanged. Schema v1 includes optional first-class Acceptance Criteria; older v1 tables without that column remain readable and gain it on their next normalizing write. An incompatible task-table or configuration change requires an explicit version change and migration guidance; a runtime release must state which schema/config versions it accepts. Consumers must not infer compatibility from a matching extension directory or a successful parse alone.

The root README intentionally has no fixed release number. Git tags are immutable source pins; a published GitHub Release attached to a tag is the canonical release record and carries the release notes. Do not move or reuse an existing tag. A tag without a corresponding GitHub Release is tag-only, not a published release.

### Initial release baseline

The repository has a `v2.1.1` Git tag, while the latest published GitHub Release is `v2.0.0`. The `v2.1.1` tag is not retroactively treated as a published release. The first post-inversion release candidate is `v3.0.0`: the current runtime no longer parses or migrates legacy-format task documents, behavior that was present in the published `v2.0.0` runtime. This is a breaking runtime change under the versioning policy. The proposed release must include explicit migration guidance and pass the release checklist below. The earlier `v2.2.0` and `v2.3.0` proposals were not published and must not be tagged or reused. RM-005 documents governance only and does not create a tag or publish a release.

## Host support policy

Support is specific to the host product/version and capabilities actually verified; use of a shared SDK is not evidence that another host works.

| Host scope | Current assessment |
|---|---|
| VS Code 1.144.0 x64 on Linux (build `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`) | Verified against candidate commit `190aefb22133ba84891f46e67b0cb25c1842a280` for canvas loading, board refresh, and normal board actions. The synthetic browser fixture loaded all 60 fictional records with no console errors and unchanged fixture hashes. The Copilot SDK version was not independently exposed. |
| Any other host or host/version combination | Not yet validated and unsupported for compatibility guarantees until explicitly verified. |

Before a release claims a host, validate extension discovery and canvas opening, workspace-root resolution, board refresh, and the core task mutation path using disposable task data. Verify locking, revisions, conflict reporting, and persistence behavior through the applicable automated tests. Record the host product/build, SDK version when available, operating system, release commit, tested capabilities, and results. Optional capabilities such as the experimental planning query must be listed separately; their absence must not be presented as verified support.

RM-001 tracks additional-host validation. It remains open until that work is complete, but it does not block a release whose compatibility statement is explicitly limited to the currently verified host. A release must never imply support for an unverified host.

## Authoritative release process

| Stage | Entry requirements | Exit requirements |
|---|---|---|
| Implementation | Work is Template-owned, scoped, reviewed, and does not modify consumer task data | Changes and directly related documentation are complete; relevant tests are added or updated |
| Validation | Candidate commit is identified | Mandatory checklist passes against the exact candidate commit; failures are fixed or the candidate is rejected |
| Release candidate | Validation evidence and compatibility statement are ready | Candidate commit, version, host scope, and known limitations are recorded; any preview tag is a prerelease and is never moved |
| Final tag | Candidate is approved and the worktree is clean | An annotated `vMAJOR.MINOR.PATCH` tag points to the validated commit; tag protection is enabled where supported and the tag is treated as immutable |
| GitHub Release | Final tag and release notes are reviewed | A non-draft GitHub Release is published from that tag with the exact source commit and compatibility statement |
| Consumer adoption | Published release is selected by the consumer owner | Consumer diff, validation, approval, sync commit, and provenance record are complete |

If a preview is distributed, use a distinct prerelease tag such as `v3.0.0-rc.1`; never use a final version tag for a candidate. Do not publish from an unreviewed working tree or an untagged branch snapshot.

### Mandatory release checklist

- [ ] Generic contract tests pass.
- [ ] Template integration tests pass, including the independent configuration and task-table validation.
- [ ] Consumer smoke validation uses a disposable copy; no live consumer task document is written.
- [ ] Synthetic browser-project validation uses only the fictional fixture; its sources remain unchanged outside the intended test.
- [ ] Board loads and refreshes; task tables retain the configured marker, required columns, valid IDs, and valid configured values.
- [ ] Lifecycle behavior is checked through normal board operations when the release changes lifecycle behavior; completion dates are not manually supplied during a status transition.
- [ ] Documentation links, host claims, known limitations, and release notes match the implementation.
- [ ] Version references are consistent: release tag is the version authority; task schema and configuration versions are reported separately.
- [ ] The exact supported host/build and verified capabilities are recorded; all unverified hosts are explicitly marked not yet validated/unsupported for compatibility guarantees.
- [ ] The proposed tag is unused, annotated, and points to the exact validated commit; tag protection is enabled where supported, and the release notes include that commit hash.
- [ ] The board is refreshed after any task lifecycle updates, and no unrelated task-data or consumer files are included.
- [ ] `git diff --check` passes and the final release contents contain no credentials or unintended artifacts.

Release notes must include the version and commit hash, a concise change summary, compatibility (task schema/config versions and host scope), migration or adoption notes, validation results, and known limitations. List the exact generic runtime payload paths intended for consumer adoption; do not require consumers to copy the whole Template repository.

## Consumer synchronisation procedure

1. **Select a release:** use a published GitHub Release and its immutable tag, never `main`, an untagged snapshot, or a consumer's independently maintained patch as the source of truth.
2. **Review the exact diff:** compare the consumer's recorded Template commit with the selected release commit. Review additions, removals, behavior changes, dependencies, licenses, and the release's runtime payload inventory.
3. **Apply only the runtime payload:** sync the generic extension modules and served assets in the release's explicit payload list, plus required vendored runtime assets and license notices, into the consumer's extension location. The exact file list in the release notes is authoritative; copying the entire Template repository or extension directory is not.
4. **Preserve consumer-owned material:** never sync over `project-kanban.config.json`, configured Markdown sources, task rows, ID sequence markers, project instructions/docs, domain integrations, archived migration artifacts, or consumer-specific tests. Template examples, synthetic fixtures, and Template-only tests are not consumer runtime payload.
5. **Validate in isolation:** run Template generic/integration tests for the release and the consumer's smoke/integration checks on a disposable copy. Refresh the board and verify the consumer's config and task sources remain unchanged. Review any local adaptation separately; do not hide it in the upstream diff.
6. **Approve and record:** obtain Template-side release approval and consumer-side diff/validation approval. Commit the sync as a focused consumer change, then update the consumer's single provenance record.

The Template provides the reusable smoke-test harness; the consumer remains responsible for confirming its own configuration, source paths, project integrations, and acceptance of the update.

## Rollback

Rollback restores runtime behavior without restoring or rewriting project task data.

| Situation | Procedure |
|---|---|
| Failed or defective release | Do not move or reuse its tag. Edit the GitHub Release description to mark it withdrawn/superseded with the reason, then publish a corrected higher version if needed. |
| Failed consumer sync | Revert the focused sync commit, or restore only the recorded runtime payload paths to the previously consumed commit. Preserve consumer config, Markdown, task rows, ID sequence markers, and unrelated work. |
| Runtime regression after adoption | Prefer a Template-first fix and corrected release. If service must be restored immediately, temporarily return only the runtime payload to the prior pinned release and record the deviation. |
| Documentation error | Correct the Template documentation and issue a release-note erratum; roll back runtime files only if behavior is also defective. |
| Consumer adoption issue | If project-specific, fix and document it in the consumer. If generic, report and fix it in the Template; revert only the affected runtime payload if necessary. |

Never force-move a release tag, reset a consumer branch to discard work, or restore task data as a side effect of runtime rollback. Confirm the resulting board refresh and task-source hashes after rollback.

## Emergency fixes and divergence

Template-first fixes are the default. A consumer-only runtime hotfix is permitted only when an urgent project operation cannot wait for an upstream release. Keep it to the smallest necessary runtime change; do not use it to add project configuration, alter task data, or establish a second generic implementation.

For each exception, record the affected files, reason, owner, consumer commit, prior Template pin, and an upstream issue/patch reference in the consumer provenance record. Submit the generic fix upstream and reconcile the deviation with the next applicable Template release. A deviation may not remain after that next release is adopted; unresolved divergence blocks subsequent synchronization. No long-lived consumer fork is supported.

Deprecations and removals must be announced in release notes with an upgrade path. Where feasible, provide at least one minor-release notice before removal; a breaking removal requires a major release and explicit migration guidance.

## Provenance

| Repository | Canonical record |
|---|---|
| Template | Immutable tag, tagged commit hash, and GitHub Release notes. The release record includes supported host/capabilities, schema/config versions, validation results, runtime payload paths, and known deviations/limitations. |
| Consumer | One consumer-owned `docs/project-kanban-upstream.md` record containing Template repository, consumed tag and commit, consumer sync commit, sync date, validation evidence, and every local deviation with rationale and upstream status. Keep this file outside the synced runtime payload. |

The provenance record is metadata about code adoption; it must not duplicate task state or become a second source of project configuration.

## ADR record

The rationale for the authority/synchronization boundary and workspace identity/lock contract is recorded in [Architectural Decisions](decisions.md#adr-16-template-authority-and-release-governance).
