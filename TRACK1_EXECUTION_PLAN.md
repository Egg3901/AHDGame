# Track 1: total system analysis rework

Status: in progress. This is the execution record for the owner's 2026-09-24
note, not a declaration that reset readiness has passed.

## Source and base

- Original note: `/root/misc/archive/total-system-analysis-rework-2026-09-24.jpeg`, read on 2026-09-25. The supplied transcription agrees with it.
- Source branch: `origin/development` fetched on 2026-09-25.
- Exact base: `028cb9265e76555efa5d73b611cea0f409c3446b`.
- Worktree: `/root/projects/AHDGame/worktrees/track1-fixer` on
  `track1/total-system-analysis-rework`.
- The main checkout contains another agent's uncommitted PostHog/Sentry work.
  It must remain untouched. All Track 1 edits occur in this worktree.
- Issue #2159 selects `1991-default` for the reset. The owner also requires
  2027 defects to be fixed in this Track. A profile change invalidates the
  1991-specific launch evidence and requires a new qualification.

## Completion contract

The deliverable is one PR against `development`. It must link affected issues,
contain the implementation and its evidence, pass `npm run verify`,
`npm run verify:build`, Semgrep custom rules, and dependency review, and leave
only the exact-release final validation campaign. The PR must never claim a
reset or issue is validated from source inspection or a completed turn count
alone. GitHub issues stay open until the final validation pass; the parallel
ledger records implementation and evidence progress meanwhile.

The internal ledger is `TRACK1_RESET_READINESS_LEDGER.md` and its structured
source `TRACK1_RESET_READINESS_LEDGER.json`. Each #2159 checklist subitem has
an entry with owner/status, proof, blockers, and a final-validation gate.
Implementation-complete and validated are distinct states. The ledger is
independent of GitHub closure, and final validation reconciles it with every
child issue and the parent tracker in one pass.

## Sequence

1. **Freeze the scope and protect concurrent work.** Enumerate all open PRs,
   open issues, #2159 children and dependencies, and worktrees in every
   affected repository. Use `git worktree list` for each repository and
   `node /root/bin/worktree-status.js`; classify locked, mergeable,
   active-feature, or prunable before changes. Record each PR and worktree in
   `TRACK1_PR_WORKTREE_INVENTORY.md`. Never move/remove locked or dirty work.
   Never leave two checkouts at the same base commit for the same task. The
   accidental clean duplicate `fix/track-1-total-system-analysis-20260925`
   was removed with ordinary `git worktree remove`; this is the sole Track 1
   checkout.
2. **Resolve branch inventory.** Review each PR's diff and CI. Merge only
   beneficial work into `development` with a recorded explanation; close
   superseded/abandoned PRs and remove only their proven clean worktrees with
   recorded reasons. Rebase/conflict resolution must preserve other agents'
   work. Refresh this branch from `development` after every upstream merge.
   Dirty worktrees require a documented commit-or-discard decision before
   removal. Patch-id equivalence matters: `fix/issue-1975-budget-invariant`
   has no unique content and `fix/issue-2059-year-effects` has one commit with
   content already on development, yet both remain dirty and are protected.
3. **Make the reset blockers executable.** Resolve #2159's seed integrity,
   economy/banking, elections, telemetry, performance, and 1991 crisis gates.
   Repair the 2027 seed, currency, party, population, and political integrity
   defects as implementation work even though final launch qualification uses
   the selected 1991 profile.
   Use issue-specific acceptance criteria, deterministic tests, and portable
   rules modules. Every changed turn phase needs projected fat reads, a
   round-trip budget check, and before/after bytes and round trips.
4. **Resolve the remaining open issues.** `TRACK1_ISSUE_AUDIT.md` maps every
   open issue to implementation, proof, dependency, and closure criteria.
   Fix code defects, make explicit decisions for non-code issues, and keep
   issue comments and parent counts current. Balance changes use the
   deterministic `scripts/sim/` report requirement before merge.
5. **Freeze release candidate inputs.** Pin SHA, effective world-entity
   manifest, feature flags, economy tier, labour mode, NPP version, calendar,
   products, crisis configuration, schema/calculation versions, and actor
   configuration. Verify sandbox targeting and existing-world normalization.
6. **Run non-worldsim gates first.** Targeted tests and deterministic harness
   matrices cover rule boundaries, settlement retries, election qualification,
   counterfactual crises, telemetry attribution, and reset tooling. Run full
   `verify`, `verify:build`, Semgrep, dependency review, and scoped turn profiling.
   Record failures and rerun only the affected gate after a fix.
7. **Qualify and rehearse.** On sandbox Mongo, run bootstrap conformance,
   founding and normal turns, an operational reset/restore rehearsal, and the
   minimum multi-seed simulation campaign below. Inspect complete time series
   and issue-owned guardrails. Resolve every unexplained finding in code or
   record an owner-approved waiver with impact, mitigation, monitoring, and
   rollback conditions.
8. **Final replay and accounting.** After the final code/configuration change,
   run the exact-SHA release replay. Attach sanitized reports and source
   revisions. Update every touched issue with source/test evidence and
   remaining criteria. Close children and #2159 only after _all_ applicable
   final gates pass and update parent counts in the same pass. The single PR
   then becomes reviewable as a complete release candidate.

## Worldsim budget

The #2159 acceptance criteria are a floor. A literal single world run cannot
meet its three-seed early-world and ten-year matrices plus post-change replay.
"Single final validating worldsim run" therefore means one final **campaign**
on a frozen SHA, with multiple required deterministic worlds; it is not a
waiver of the issue's sample size. A changed release SHA invalidates that
campaign.

| Stage                                               |                         New world starts | Coverage and reuse                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic rules/integration and replay fixtures |                                        0 | Exercise edge cases, products, crises, election paths, and accounting before sandbox worlds.                                                                                                                                                              |
| Initial 1991 qualification                          |                                        3 | Three seeds: autonomous control, synthetic political actors, economy/banking stress. Retain five-year checkpoints, then continue all three to 480 year-advancing turns. This satisfies both the five-year and ten-year matrices without duplicate starts. |
| Horizon extension                                   |      0 if the synthetic run can continue | Continue the synthetic-actor world from 1991 through 2027. Add a second horizon seed only for seed-sensitive timing or materially divergent outcomes.                                                                                                     |
| Sandbox reset rehearsal/bootstrap                   | 0 if combined with a qualification start | Capture pre-turn baseline, founding, ten normal turns, surface smoke tests, backup/restore, abort and rollback proof.                                                                                                                                     |
| 2027 repair probe                                   |                                1 minimum | Fresh bootstrap and short election/currency/population replay to prove 2027 defects are fixed. This is implementation evidence, not a change to the 1991 launch profile.                                                                                  |
| Exact-SHA release replay                            |                                        3 | Fresh bootstrap plus three five-year seed treatments after the final change. This is the final validation campaign, with complete retained telemetry and sanitized reports.                                                                               |

Baseline budget: **seven fresh world starts plus one horizon continuation** and
one rehearsal/restore operation. Conditional extra starts require a named
finding and updated ledger. No worldsim is used as an exploratory substitute
for a targeted test. This budget is provisional until the worker's ability to
resume a pinned world and retain complete time series is verified.

## Stop conditions for a launch claim

Any unexplained seed integrity error, money conservation failure, unresolved
settlement, candidate-less election, missing crisis family, stale/misattributed
telemetry, phase budget regression, failed restore, or missing owner-approved
waiver blocks the final validation decision. A queued or incomplete horizon
run is insufficient.
