# TRACK1 PR + Worktree Inventory

Snapshot: 2026-09-24 23:23:50 UTC, corrected 2026-09-25 after a fresh
`origin/development` divergence check and removal of the duplicate Track 1
worktree. The original Muse inventory is retained below with factual
corrections; proposed dispositions are not completed actions.
Base commit (track1-fixer HEAD): 028cb9265e76555efa5d73b611cea0f409c3446b
(`Merge pull request #2373 from Egg3901/update/bloc-intorg-gameplay`).
AHDGame main-checkout HEAD at snapshot: dd91af6c18f2471031b757bd28976876c5ccf6c2
`[fix/admin-funded-ipo-reversal]` (i.e. NOT on the base commit; the worktree
`track-1-total-system-analysis` and this worktree `track1-fixer` were two
checkouts pinned at the base commit. The former was clean and has now been
removed with ordinary `git worktree remove`. Never leave duplicate checkouts
of the same base for one task.

Worker: Muse Code powered by Meta Muse Spark (external provider worker,
acting as the assigned "Muse Spark 1.3 contributor"), read-only except for
this file. No GitHub mutation, no worktree mutation, no builds/tests.

Scope constraint honored: only this file written
(`TRACK1_PR_WORKTREE_INVENTORY.md` at the AHDGame repo top level, inside
worktree `track1-fixer`). The #2291 patch is committed but partial;
`src/` and tests were not touched. File is left UNCOMMITTED per task
("Do not commit"); supervisor checkpoints it.

## Evidence sources (all read-only)

1. `git -C <repo> worktree list` (plain) per repo: AHDGame, a-house-divided,
   LSGD-ops-dash, adhd-bot.
2. `git -C /root/projects/AHDGame worktree list --porcelain` (lock reasons).
3. `node /root/bin/worktree-status.js` (full output captured; covers
   LSGD-ops-dash, a-house-divided, adhd-bot plus out-of-scope repos, but
   does NOT list AHDGame worktrees, so AHDGame was classified manually).
4. `gh pr list --state open --limit 100` per repo
   (Egg3901/AHDGame, Egg3901/a-house-divided, Egg3901/LSGD-ops-dash,
   Egg3901/adhd-bot) with number/title/head/base/updatedAt/author, plus
   `gh repo view --json defaultBranchRef` per repo.
5. `git status --porcelain` per checkout (dirty detection).
6. Corrected divergence counts below use `git rev-list --count
origin/development..<HEAD>` per AHDGame worktree. The original Muse pass
   used a stale local `development` for some rows and overstated unique commits.
   Raw divergence is not patch uniqueness; the owner's `git cherry` check also
   found that the one commit on `fix/issue-2059-year-effects` is patch-equivalent
   to content already in `development`.

The tables below began as a Muse snapshot and include proposed dispositions.
The dated execution record at the end of this document supersedes snapshot
language where an action has since completed. No locked worktree was touched.

Default branches: AHDGame `development`, a-house-divided `master`,
LSGD-ops-dash `main`, adhd-bot `main`. Cross-repo dispositions respect each
repo's own base branch. No cross-repo merge into AHDGame `development` is
recommended for any non-AHDGame work.

Classification legend: locked = another session holds it, never touch.
active-feature = unique commits and/or dirty, owner/supervisor decides.
mergeable = 0 unique commits vs base, clean, safe to remove after a
fresh check. prunable = git itself flags it (stale admin files).
dirty = uncommitted changes present (blocks any removal/rebase until the
owner commits or discards).

## A. Open PRs

### A1. Egg3901/AHDGame (default -> base: `development`) — 6 open

| #    | Title                                                                 | head -> base                                            | Updated    | Disposition + reason/evidence                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2377 | docs: audited execution plan for the dead-weight consolidation report | docs/dead-weight-consolidation-plan -> development      | 2026-09-24 | PROPOSE merge into `development` after reviewing the current PR commit and CI. Its branch has **1** commit beyond fresh `origin/development`; its worktree is dirty with additional unpublished edits, so distinguish the PR head from that work. |
| 2267 | chore(deps): bump @commitlint/cli 20.5.3 -> 21.2.2                    | dependabot/.../commitlint/cli-21.2.2 -> development     | 2026-09-21 | PROPOSE merge into `development` after `verify` (shared scheduler). Routine dependabot. No worktree.                                                                                                                                              |
| 2266 | chore(deps): bump react-simple-maps 3.0.0 -> 5.0.5                    | dependabot/.../react-simple-maps-5.0.5 -> development   | 2026-09-21 | PROPOSE merge into `development` after `verify`; note major bump (3.x -> 5.x), needs test evidence. No worktree.                                                                                                                                  |
| 2265 | chore(deps): bump @vitest/coverage-v8 4.1.11 -> 5.0.0                 | dependabot/.../coverage-v8-5.0.0 -> development         | 2026-09-21 | PROPOSE merge into `development` after `verify`. Major bump, test-infra only. No worktree.                                                                                                                                                        |
| 2264 | chore(deps): bump typescript 6.0.2 -> 7.0.2                           | dependabot/.../typescript-7.0.2 -> development          | 2026-09-21 | PROPOSE merge into `development` after typecheck via scheduler; major compiler bump, highest-risk of the five. No worktree.                                                                                                                       |
| 2263 | chore(deps): bump the next-ecosystem group (3 updates)                | dependabot/.../next-ecosystem-c3a2f73f6e -> development | 2026-09-21 | PROPOSE merge into `development` after `verify:build` via scheduler (Next ecosystem). No worktree.                                                                                                                                                |

**AHDGame PR execution update, 2026-09-25:** #2263 was merged into
`development` as squash commit `2f827b5d798519e58501be6eb5e9a2d7130300b9`.
It updates existing React, React DOM, and eslint-config-next versions. #2267
was merged as squash commit `385b9506e5b8863595335e85a65441ca20fb6469`;
it updates the existing commitlint CLI. Their PR checks were green, including
build for #2263, and neither had a worktree. These execution entries supersede
the earlier proposals in the snapshot table. The Track 1 branch must refresh
from the new development head before its final PR.

#2264 was **closed and its branch deleted as abandoned**. Its isolated
TypeScript 7 update failed lint and verify, so it was unsafe to merge into a
production-bound reset branch. #2265 was **closed and its branch deleted as
abandoned**: `@vitest/coverage-v8@5.0.0` declares an exact `vitest@5.0.0`
peer in its PR lockfile, while the repository still uses Vitest 4.1.11. Both
PRs received a GitHub comment with the reason. Neither had a local worktree.

#2266 was subsequently **merged** as `088cc9ba629b1d41713154afb0148c827147842a`
after refreshed CI passed lint, format, typecheck, build, all four test shards,
Semgrep, CodeQL, dependency review, and PR-title validation. As of the fresh
2026-09-25 PR query, #2377 is the only AHDGame PR from this snapshot still
open; its worktree is dirty with another agent's active implementation and
has not been modified by Track 1.

### A2. Egg3901/a-house-divided (default: `master`) — 13 open, ALL dependabot

| #    | head -> base                                   | Updated    | Disposition + reason/evidence                                                                         |
| ---- | ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 4451 | next-ecosystem-5ace068e80 -> `development`     | 2026-09-21 | PROPOSE merge into ITS OWN base (`development`), never into AHDGame. Needs build check via scheduler. |
| 4448 | typescript-tooling-baee414eea -> `development` | 2026-09-21 | PROPOSE merge into its own `development`. Low risk.                                                   |
| 4447 | js-yaml-4.3.2 -> `master`                      | 2026-09-13 | PROPOSE merge into its own `master`. Dev-dep patch.                                                   |
| 4446 | next-16.3.4 -> `master`                        | 2026-09-11 | PROPOSE merge into its own `master` after build check. Minor Next bump.                               |
| 4445 | vitest-4.1.11 -> `master`                      | 2026-09-11 | PROPOSE merge into its own `master`. Dev-dep patch.                                                   |
| 4444 | smol-toml-1.8.0 -> `master`                    | 2026-09-11 | PROPOSE merge into its own `master`. Dev-dep minor.                                                   |
| 4443 | baseline-browser-mapping-2.11.22 -> `master`   | 2026-09-10 | PROPOSE merge into its own `master`. Transitive dep.                                                  |
| 4442 | browserslist-4.28.9 -> `master`                | 2026-09-07 | PROPOSE merge into its own `master`. Transitive dep.                                                  |
| 4441 | @humanfs/node-0.16.8 -> `master`               | 2026-09-03 | PROPOSE merge into its own `master`. Dev-dep patch.                                                   |
| 4440 | fast-uri-3.1.7 -> `master`                     | 2026-09-03 | PROPOSE merge into its own `master`. Dev-dep patch.                                                   |
| 4435 | knip-6.32.2 -> `development`                   | 2026-08-24 | PROPOSE merge into its own `development`.                                                             |
| 4434 | @aws-sdk/client-s3-3.1111.0 -> `development`   | 2026-08-24 | PROPOSE merge into its own `development`.                                                             |
| 4422 | happy-dom-20.11.2 -> `development`             | 2026-08-17 | PROPOSE merge into its own `development`. Test dep.                                                   |

Note: this repo is the private sync-source of record (do NOT develop here).
Local worktrees `2159-market-evidence` / `2159-money-topology` (26 unique
commits each vs `master`) have NO open PR; if that work is meant to land,
it needs a PR against this repo's own branch, not AHDGame.

### A3. Egg3901/LSGD-ops-dash (default/base: `main`) — 8 open

| #   | Title                                                          | head -> base                                  | Updated    | Disposition + reason/evidence                                                                                                                                                                                |
| --- | -------------------------------------------------------------- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 168 | fix(tickets): restore public receipts and read-only triage     | fix/restore-ticket-receipts -> main           | 2026-09-23 | PROPOSE merge into its own `main` after review; matches active-feature worktree `ops-restore-ticket-receipts` (94 unique commits). Blocked on owner verification, NOT on lock (that worktree is not locked). |
| 167 | fix(tickets): keep automatic triage read-only by default       | fix/ticket-triage-read-only -> main           | 2026-09-22 | PROPOSE merge into its own `main` after review; matches worktree `ops-ticket-triage-read-only` (75 unique). Not locked.                                                                                      |
| 162 | feat(ops): expose Paseo reliability signals                    | feat/paseo-reliability -> main                | 2026-09-22 | BLOCKED by lock: worktree `paseo-reliability` is LOCKED (active session). Final desired disposition: merge into its own `main`. Do not touch until unlocked.                                                 |
| 137 | feat(worldsim): forward pinned AHDGame source identity         | feat/worldsim-source-pin -> main              | 2026-09-17 | PROPOSE merge into its own `main`; worktree `worldsim-source-pin` (54 unique) is active, not locked. Cross-repo note: references AHDGame source identity but still merges here, not into AHDGame.            |
| 122 | fix(downloads): publish AHDClient 2.0.5                        | release/ahdclient-2.0.5-portal -> main        | 2026-09-06 | PROPOSE merge into its own `main` (release); worktree `ahdclient-2.0.5-portal` (40 unique) active, not locked.                                                                                               |
| 43  | Add consumer-demand-rework report                              | feature/consumer-demand-rework-report -> main | 2026-07-21 | STALE (2 months). PROPOSE close-or-rebase decision by owner; no matching local worktree found. Do not merge blind.                                                                                           |
| 34  | feat(knowledge): upgrade ops-knowledge MCP into a living brain | feat/knowledge-living-brain -> main           | 2026-07-05 | STALE. PROPOSE close-or-rebase decision by owner; no matching local worktree found.                                                                                                                          |
| 4   | Redesign ops lander page                                       | claude/ops-lander-redesign-VsQjQ -> main      | 2026-06-05 | STALE (nearly 4 months). PROPOSE close (abandoned) unless owner claims it; no matching local worktree found.                                                                                                 |

### A4. Egg3901/adhd-bot (default: `main`) — 0 open PRs

No open PRs. All 10 local worktree branches (see C1) are un-pushed or
PR-less local work; any landing needs a new PR against adhd-bot `main`,
never against AHDGame.

## B. AHDGame worktrees (39 entries, incl. 3 outside the repo dir)

Format: path | branch | unique vs `development` | state | proposed disposition.

Main checkout + sibling checkouts:

| Path                                                  | Branch                                         | Unique | State                                                                      | Disposition                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| /root/projects/AHDGame                                | fix/admin-funded-ipo-reversal                  | 3      | DIRTY (PostHog/Sentry integration owned by another agent) = active-feature | BLOCKED (dirty + active). Final: merge into `development` via PR after its owner commits + verify; do not delete.                |
| /root/projects/AHDGame-buildfix                       | fix/production-build-cache                     | 11     | clean per head check = active-feature                                      | PROPOSE merge into `development` via PR after verify; then remove worktree. Blocked on validation, not on lock.                  |
| /root/projects/AHDGame-turn-perf                      | perf/turn-bond-ledger-batching                 | 27     | clean = active-feature                                                     | PROPOSE merge into `development` via PR (perf work, needs round-trip numbers per AGENTS.md).                                     |
| /root/projects/AHDGame-turn-perf-next                 | perf/turn-bond-reserve-next                    | 23     | clean = active-feature                                                     | Review stack order and merge into `development` after the prior bond-ledger work; delete only if its patch is proven superseded. |
| /root/projects/worktrees/ahd-ipo-production           | promote/admin-funded-ipo-20260924              | 27     | active-feature (promote branch)                                            | PROPOSE promote-merge per permanent-branch policy (merge commit, never squash) after staging gate. Blocked on pipeline order.    |
| /root/projects/worktrees/ahd-regional-bill-production | promote/replay-rejected-regional-bill-20260924 | 27     | active-feature (promote branch)                                            | Same promote policy as above.                                                                                                    |
| /root/worktrees/AHDGame-ticket-close-dual-delivery    | fix/ticket-close-dual-delivery                 | 13     | LOCKED ("ticket close dual delivery implementation")                       | BLOCKED by lock. Final: merge into `development` via PR. Never touch while locked.                                               |

Nested `worktrees/` (32 entries at snapshot):

| Worktree dir                     | Branch                                       | Unique                | State                                                                                                                                            | Disposition                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dead-weight-plan                 | docs/dead-weight-consolidation-plan          | 1                     | DIRTY (audit md + src)                                                                                                                           | BLOCKED (dirty). Final: merge reviewed PR #2377; reconcile unpublished edits separately before removing the worktree.                                                                                                                                       |
| issue-1343-party-tier-realism    | fix/issue-1343-party-tier-realism            | 1                     | LOCKED ("active mechanics issue 1343...")                                                                                                        | BLOCKED by lock. Final: merge into `development`.                                                                                                                                                                                                           |
| issue-1343-production            | promote/ticket-1343-production-20260923      | 11                    | active-feature, not locked                                                                                                                       | PROPOSE promote-merge per pipeline order (staging snapshot first). Blocked on gate, not lock.                                                                                                                                                               |
| issue-1343-staging-snapshot      | promote/issue-1343-staging-snapshot-20260923 | 3                     | LOCKED ("Ticket 1343 staging snapshot...")                                                                                                       | BLOCKED by lock. Final: merge staging->main waypoint per policy.                                                                                                                                                                                            |
| muse-1672                        | fix/issue-1672-atomic-money-flows            | 55                    | active-feature                                                                                                                                   | PROPOSE merge into `development` via PR after verify. Largest delta in inventory.                                                                                                                                                                           |
| muse-1724d                       | feat/issue-1724-fourth-dynamic-action        | 2                     | DIRTY (WatchlistPanel + 3 untracked logs)                                                                                                        | BLOCKED (dirty). Final: merge into `development`; discard *.log scratch first.                                                                                                                                                                              |
| muse-1968-pair-review            | review/issue-1968-pair                       | 14                    | active-feature (review branch)                                                                                                                   | Owner decision: merge into `development` if review accepted, else delete. Cannot infer; flagged, not defaulted.                                                                                                                                             |
| muse-1975-budget-invariant       | fix/issue-1975-budget-invariant              | 0                     | DIRTY (8 modified source files and 7 untracked Muse logs); branch content itself is already on development                                       | BLOCKED (dirty). Preserve and review the 8-file source diff for #1975; merge worthwhile source through Track 1, then delete this worktree only after a written discard decision for any remainder. Logs can be discarded after useful evidence is archived. |
| muse-1976-review                 | review/issue-1976                            | 1                     | active-feature                                                                                                                                   | Same review-branch decision as 1968.                                                                                                                                                                                                                        |
| muse-1980-review                 | review/issue-1980                            | 1                     | active-feature                                                                                                                                   | Same review-branch decision.                                                                                                                                                                                                                                |
| muse-1982-review                 | review/issue-1982                            | 1                     | active-feature                                                                                                                                   | Same review-branch decision.                                                                                                                                                                                                                                |
| muse-2059-year-effects           | fix/issue-2059-year-effects                  | 1 raw, 0 patch-unique | DIRTY (`treasuryTurn.test.ts` plus `muse.log`); `git cherry origin/development` marks the committed change as already present under another hash | Final: **delete as superseded** after the uncommitted test diff is reviewed and either incorporated into Track 1 or explicitly discarded as redundant, with a reason; do not force-remove.                                                                  |
| muse-2060-election-cycle         | fix/issue-2060-election-cycle                | 1                     | active-feature, clean                                                                                                                            | PROPOSE merge into `development` via PR.                                                                                                                                                                                                                    |
| muse-588                         | refactor/issue-588-sector-turn               | 2                     | untracked `muse-1.3` only                                                                                                                        | BLOCKED (untracked content, uninspected). Final: merge into `development` after owner checks the untracked file.                                                                                                                                            |
| muse-968-consumer-alert          | feat/issue-968-corporate-noholder-alert      | 3                     | active-feature, clean                                                                                                                            | PROPOSE merge into `development` via PR.                                                                                                                                                                                                                    |
| npp-bounded-directives           | npp-bounded-directives                       | 6                     | active-feature                                                                                                                                   | PROPOSE merge into `development` via PR.                                                                                                                                                                                                                    |
| player-qol-round3                | feat/uk-concurrent-cabinet-round3            | 0                     | DIRTY (layout.json + cabinet routes) but 0 unique commits                                                                                        | BLOCKED (dirty). Final: commit-then-PR, or discard-then-delete.                                                                                                                                                                                             |
| player-qol-round3-ci             | fix/uk-pm-seat-round3                        | 2                     | active-feature, clean                                                                                                                            | PROPOSE merge into `development` via PR (likely pairs with round3).                                                                                                                                                                                         |
| private-privatization-vote       | fix/private-privatization-vote               | 1                     | active-feature, clean                                                                                                                            | PROPOSE merge into `development` via PR.                                                                                                                                                                                                                    |
| research-2087-2089               | (detached HEAD 811e9e80)                     | n/a                   | detached, clean                                                                                                                                  | PROPOSE delete worktree after owner confirms research notes are captured elsewhere; detached head is not a merge candidate.                                                                                                                                 |
| resolve-open-issues-20260922     | [development] prunable                       | n/a                   | PRUNABLE at snapshot; directory GONE by ~23:35 UTC (a concurrent session already removed it)                                                     | No action. Already cleaned by someone else; not by this worker.                                                                                                                                                                                             |
| review-1672-military             | review/issue-1672-military                   | 32                    | active-feature                                                                                                                                   | Review-branch decision (merge-or-delete by owner).                                                                                                                                                                                                          |
| review-968-consumer-alert        | review/issue-968-consumer-alert              | 3                     | active-feature                                                                                                                                   | Review-branch decision (merge-or-delete by owner).                                                                                                                                                                                                          |
| short-turn-candidate-20260920    | verify/short-turn-candidate-20260920         | 20                    | active-feature (verify branch)                                                                                                                   | Owner decision: promote if it is the accepted candidate, else delete.                                                                                                                                                                                       |
| sim-c3-all-20260917              | sim/c3-all-20260917                          | 14                    | active-feature (sim snapshot)                                                                                                                    | PROPOSE keep-or-archive decision by owner; sim snapshots are not development merges. Suggested: dated archive, then delete worktree.                                                                                                                        |
| sim-c3-uk-20260917               | sim/c3-uk-20260917                           | 5                     | active-feature (sim snapshot)                                                                                                                    | Same as sim-c3-all.                                                                                                                                                                                                                                         |
| sim-held-runtime-worker-20260918 | ops/held-runtime-worker-20260918             | 2                     | LOCKED ("active systemd held-runtime worldsim worker")                                                                                           | BLOCKED by lock. Final: keep (it backs a live worker). Never remove.                                                                                                                                                                                        |
| ticket-filing                    | fix/ticket-filing-context                    | 0                     | DIRTY (discord-bot route + ticket types + untracked src/lib/tickets/)                                                                            | BLOCKED (dirty). Final: commit-then-PR into `development`, or discard-then-delete.                                                                                                                                                                          |
| ticket-receipt-api               | feat/ticket-receipt-api                      | 1                     | active-feature, clean                                                                                                                            | PROPOSE merge into `development` via PR.                                                                                                                                                                                                                    |
| track-1-total-system-analysis    | fix/track-1-total-system-analysis-20260925   | 0                     | merged/clean duplicate                                                                                                                           | **DELETED** with `git worktree remove` after a fresh clean-state and zero-unique-commit check. It was my accidental duplicate of `track1-fixer`; no work was discarded.                                                                                     |
| track1-fixer (THIS worktree)     | track1/total-system-analysis-rework          | 0 at base             | DIRTY by design: Track 1 plan, ledger, inventory, #2337 work, and Muse #2291 work in progress                                                    | Final: one Track 1 PR into `development`; this is the sole Track 1 checkout.                                                                                                                                                                                |
| worldsim-readiness-20260922      | fix/worldsim-readiness-20260922              | 0                     | DIRTY (5 modified sim files) but 0 unique commits                                                                                                | BLOCKED (dirty). Final: commit-then-PR, or discard-then-delete.                                                                                                                                                                                             |

**Patch-equivalence decision for two 2026-09-17 Muse trees:** discard their
uncommitted copies and delete the clean worktrees as superseded. The eight
modified source files in `muse-1975-budget-invariant` implement the
authoritative-year wiring already committed to development in `ef33488f2a`
with year-boundary tests. Five of the eight resulting files are byte-identical
to this fresh checkout; the remaining three contain the same wiring plus
newer unrelated development changes. The uncommitted
`muse-2059-year-effects/src/lib/turn/treasuryTurn.test.ts` is byte-identical
to the current development file, and `git cherry origin/development` marks
its one branch commit patch-equivalent. Neither tree is locked or used by a
process. Their untracked `muse*.log` files are stale worker logs, not source
or required simulation evidence. This is a recorded discard decision, not a
force-removal; recheck status immediately before ordinary removal.

**Execution, 2026-09-24 UTC:** both worktrees were checked again, the
patch-equivalent tracked copies were restored in those two worktrees only,
and stale local Muse logs were removed. Each then passed a clean-status check
and was removed with ordinary `git worktree remove`. No branch with unique
content was deleted.

Orphaned dirs (NOT registered worktrees, `git status` fails inside):

- `worktrees/ipo-partial-float-ticket-1349/`: contains ONLY `tsconfig.tsbuildinfo`
  (3.4 MB, 2026-09-23). Stray build artifact. PROPOSE delete after one-line
  owner ack. Not a git worktree; safe, but not mine to remove.
- `worktrees/resolve-open-issues-20260922/`: already gone (see table).

## C. Other-repo worktrees

### C1. adhd-bot (10 entries) — worktree-status.js: 2 locked, rest active-feature

Locked (do not touch; final disposition once unlocked noted):

- /root/projects/worktrees/adhd-bot-receipt-retry
  (`fix/retry-ticket-receipt-link`): BLOCKED by lock. Final: PR to adhd-bot
  `main`, then remove.
- /root/worktrees/adhd-bot-ticket-close-dual-delivery
  (`fix/ticket-close-dual-delivery`): BLOCKED by lock. Final: PR to adhd-bot
  `main`, then remove.

Active-feature (leave alone; each needs its own PR to adhd-bot `main`):

- main checkout /root/projects/adhd-bot (`feat/ticket-resolution-delivery`):
  DIRTY (ask.ts, api-base, env, roles, api-base test + 2 untracked).
  BLOCKED (dirty). Final: PR to `main`.
- worktrees/ticket-filing (`fix/ticket-filing-prompts`, 3 unique): DIRTY.
  BLOCKED (dirty). Final: PR to `main`.
- worktrees/ticket-log-receipt-fix (`fix/ticket-log-receipt`, 3 unique):
  clean. PROPOSE PR to `main`.
- worktrees/ticket-receipt-channel (`feat/ticket-receipt-channel`, 2 unique):
  clean. PROPOSE PR to `main`.
- /root/projects/worktrees/adhd-bot-close-ticket-without-receipt
  (`fix/cleanup-legacy-closed-ticket`, 42 unique): PROPOSE PR to `main`.
- /root/projects/worktrees/adhd-bot-ticket-receipts
  (`fix/all-ticket-receipts`, 1 unique): PROPOSE PR to `main`.
- /root/projects/worktrees/adhd-bot-visible-receipts
  (`fix/visible-ticket-receipts`, 38 unique): PROPOSE PR to `main`.
- /root/worktrees/adhd-bot-ticket-close-cacheless-overwrite
  (`fix/ticket-close-cacheless-overwrite`, 40 unique): PROPOSE PR to `main`.

Zero open adhd-bot PRs, so every "PROPOSE PR" above means OPEN a new PR
against adhd-bot `main` (supervisor/owner action, not mine).

### C2. a-house-divided (4 registered + 3 orphaned dirs)

Registered:

- Main checkout (`master`): DIRTY (capacityCapture files, attack routes,
  nppCorporateAttacks + untracked SEED_DIAGNOSTIC_PLAN.md). BLOCKED (dirty).
  No disposition beyond owner commit/discard; private sync-source repo.
- worktrees/2159-market-evidence (`audit/2159-market-evidence`, 26 unique):
  active-feature. No open PR. Final: PR against own branch if the work is
  wanted, else keep/delete per owner. Not AHDGame-bound.
- worktrees/2159-money-topology (`design/2159-money-topology`, 26 unique):
  same as above.
- worktrees/cs_f3357a95 (`code-agent/ticket-1344-repair-cs-f3357a95`):
  LOCKED. BLOCKED by lock. Never touch.

Orphaned dirs (present on disk, ABSENT from `git worktree list`, admin link
broken or never registered; same dirty signature as the main checkout, so
they look like stale copies, but unverified — do not delete):

- worktrees/crt-countdown/, worktrees/feat/, worktrees/landing-crisis-showcase/
  — PROPOSE owner verifies they carry no unique work, then plain `rm -rf`
  (they are not worktrees, so `git worktree remove` does not apply).

### C3. LSGD-ops-dash (33 entries) — per worktree-status.js + own list

Locked (13 per worktree-status.js; 10 in-scope for this task, 3 in
grand-century/savant-trading out of scope but reported for completeness):

- /root/deploy/lsgd-ops-v3.13, v3.14, v3.16-rc, v3.16-rc2, v3.16-rc4, v3.16-rc5
  (all detached HEAD): LOCKED. These are deploy checkouts; final disposition:
  keep while serving, retire via deploy process, never `git worktree remove`
  by hand. BLOCKED by lock in all cases.
- worktrees/live-world-intelligence (`feat/live-world-intelligence`): LOCKED.
  Final: PR to ops-dash `main`. BLOCKED.
- worktrees/ops-availability-guard (`fix/ops-availability-guard`): LOCKED.
  Final: PR to `main`. BLOCKED.
- worktrees/paseo-reliability (`feat/paseo-reliability`, pairs with PR #162):
  LOCKED. Final: merge PR #162. BLOCKED.
- worktrees/ticket-tracker-status-sync-20260923
  (`fix/support-tracker-status-sync`): LOCKED. Final: PR to `main`. BLOCKED.

Mergeable per worktree-status.js (0 unique commits vs `main`, safe cleanup
candidates — supervisor to confirm clean, then `git worktree remove`):

- canonical-ticket-stage, discord-terminal-workflow,
  preserve-resolution-delivery, public-receipt-context, receipt-layout
  (NOTE: receipt-layout worktree is DIRTY: tickets-page.js + test — dirty
  overrides mergeable, so it is BLOCKED until the dirt is committed or
  discarded), supersede-old-resolution-updates, ticket-resolution-receipts,
  ticket-robustness (NOTE: also DIRTY: mcp-catalog, support-server/tracker,
  server.js, ticket-receipt.js — same override, BLOCKED).

**Execution update, 2026-09-25:** after fetching `origin/main`, a fresh
status and `origin/main..HEAD` check showed zero uncommitted changes and zero
unique commits for canonical-ticket-stage, discord-terminal-workflow,
preserve-resolution-delivery, public-receipt-context,
supersede-old-resolution-updates, and ticket-resolution-receipts. Each was
**deleted** with ordinary `git worktree remove`. These were already merged
content; no patch was discarded. `receipt-layout` and `ticket-robustness`
remain dirty and were not touched.

Active-feature with unique commits (leave alone; PR to ops-dash `main`
where a PR exists, else owner decision):

- /root/deploy/lsgd-ops-v3.15 + v3.16-rc3 (detached, diverged, NOT locked):
  deploy snapshots; retire via deploy process, not by hand.
- worktrees/ahd-reels-publish (`feat/ahd-feature-reels`, 143 unique),
  ahdclient-2.0.5-portal (40, pairs PR #122),
  public-ticket-receipt-route (129), ticket-status-view-ux (1),
  worldsim-source-pin (54, pairs PR #137),
  /root/projects/worktrees/ops-dashboard-v4 (`fix/retire-code-feature`, 142),
  /root/projects/worktrees/ops-player-tickets (`feat/player-ticket-stats`, 1),
  /root/worktrees/ops-market-politics (`fix/mongo-reconnect-race`, 74),
  /root/worktrees/ops-restore-ticket-receipts (94, pairs PR #168),
  /root/worktrees/ops-ticket-triage-read-only (75, pairs PR #167).
- Main checkout /root/projects/LSGD-ops-dash: DIRTY
  (config/dashboard.yaml, mcp/support-server.js). BLOCKED (dirty).

## D. Validation owed (shared scheduler, NOT run here)

Per the host execution contract, no full typecheck/test/verify/build or sim
was run. Owed before any merge in this inventory:

- AHDGame: `npm run verify` + `verify:build` for every merge-proposed branch
  (esp. muse-1672 with 55 unique commits, typescript-7.0.2 PR #2264,
  next-ecosystem PR #2263), enqueued via
  `/root/bin/lakeside-check-queue enqueue --workdir <registered-worktree>
--label <label> --priority normal -- npm run <verify|verify:build>`.
  -World simulations (if any balance-adjacent branch needs one): worldsim
  `simJobs` queue, 03:00-08:00 America/New_York claim window only.
- Focused checks run by this worker: NONE (read-only inventory; `git worktree
list`, `git status --porcelain`, `git rev-list --count`, `gh pr list`,
  `gh repo view`, `node /root/bin/worktree-status.js` are evidence commands,
  not validation).

## E. Handoff state

- Changed file: `TRACK1_PR_WORKTREE_INVENTORY.md` only (new, untracked).
  No commit (per task). Supervisor checkpoints, then merges/rebases or
  abandons per worktree lifecycle; this worktree also holds another agent's
  uncommitted #2291 work, so it must NOT be removed casually.
- Counts: open PRs 6 (AHDGame) + 13 (a-house-divided) + 8 (LSGD-ops-dash) +
  0 (adhd-bot) = 27. Worktree entries: 39 (AHDGame) + 4 registered + 3
  orphaned (a-house-divided) + 33 (LSGD-ops-dash) + 10 (adhd-bot) = 89.
- Volatile observation: `resolve-open-issues-20260922` was prunable at
  snapshot and removed by a concurrent session ~10 min later. Re-run
  `git worktree list` fresh before acting on anything above.

## F. Executed dispositions after the Muse snapshot

These are actions, not proposed dispositions. The original snapshot above is
retained to preserve the enumeration and predecision state.

| Item                                                                                                                                                                                                       | Final disposition                                                                                     | Reason and evidence                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate `track-1-total-system-analysis` checkout                                                                                                                                                         | Deleted with ordinary `git worktree remove`; redundant local branch deleted with safe `git branch -d` | Same `028cb9265e` base as `track1-fixer`, clean, zero unique commits. Never leave two checkouts of the same commit for one task.                                                                                                                |
| AHDGame PR #2263                                                                                                                                                                                           | Merged to `development` as `2f827b5d798519e58501be6eb5e9a2d7130300b9`                                 | React, React DOM and eslint-config-next dependency update; required checks green.                                                                                                                                                               |
| AHDGame PR #2267                                                                                                                                                                                           | Merged to `development` as `385b9506e5b8863595335e85a65441ca20fb6469`                                 | Commitlint CLI dependency update; required checks green.                                                                                                                                                                                        |
| AHDGame PR #2266                                                                                                                                                                                           | Merged to `development` as `088cc9ba629b1d41713154afb0148c827147842a`                                 | react-simple-maps v5 update; refreshed CI checks, including build, typecheck and all test shards, green.                                                                                                                                        |
| AHDGame PR #2264                                                                                                                                                                                           | Closed and remote branch deleted                                                                      | TypeScript 7 update failed verify/lint against this repo; cannot merge broken toolchain.                                                                                                                                                        |
| AHDGame PR #2265                                                                                                                                                                                           | Closed and remote branch deleted                                                                      | Coverage-v8 5 lockfile requires Vitest 5 while the repo uses Vitest 4.1.11; incompatible peer version.                                                                                                                                          |
| `muse-1975-budget-invariant`                                                                                                                                                                               | Deleted after explicit discard of duplicate uncommitted source and stale logs                         | Eight source edits already implemented on development in `ef33488f2a` or superseded by later changes; zero patch-unique commits. Clean status checked before ordinary removal.                                                                  |
| `muse-2059-year-effects`                                                                                                                                                                                   | Deleted after explicit discard of duplicate uncommitted test and stale log                            | Test file byte-identical to development; branch commit patch-equivalent by `git cherry`. Clean status checked before ordinary removal.                                                                                                          |
| Six clean ops worktrees: `canonical-ticket-stage`, `discord-terminal-workflow`, `preserve-resolution-delivery`, `public-receipt-context`, `supersede-old-resolution-updates`, `ticket-resolution-receipts` | Deleted with ordinary `git worktree remove`                                                           | Fresh `origin/main` contained their content; each was clean with zero unique commits.                                                                                                                                                           |
| `muse-1976-review`                                                                                                                                                                                         | DELETED as superseded by merged PR #1976 (`273d27d6b98a796a497046667d764cd96eb9f8fe`)                 | The production fix is byte-identical to development. The branch's only test difference is older untyped fixture code; development has improved typed tests.                                                                                     |
| `muse-1980-review`                                                                                                                                                                                         | DELETED as superseded by merged PR #1980 (`6f9cf949ba5761a3a87552ae63f8cf628b04ded6`)                 | Development contains the ring-fenced bank/escrow metrics plus later vital-signs diagnostics absent from this stale review checkout. The branch carries no unpublished uncommitted work.                                                         |
| `muse-1982-review`                                                                                                                                                                                         | DELETED as superseded by merged PR #1982 (`3d1d15a9dcad02f7348badd91419927a4b8d22ff`)                 | Development contains the Fundraise rules/UI tests; this old review checkout differs on subsequently evolved code. The branch carries no unpublished uncommitted work.                                                                           |
| `muse-2060-election-cycle`                                                                                                                                                                                 | DELETED as superseded by merged PR #2061 (`acf5e0c04279550b90e4a84a50c81f5f089e7a95`)                 | The merged PR covers exactly the same 18 paths as this old clean Muse checkout and closes issue #2060. Development's later code is authoritative.                                                                                               |
| `muse-1968-pair-review`                                                                                                                                                                                    | DELETED clean checkout; branch ref retained as historical provenance                                  | PR #1968 was explicitly closed as superseded: issue #1470 was resolved by merged PRs #1475/#1476 with an owner waiver, while this 14-commit draft failed required typecheck/verify. The branch's unique patches are not silently force-deleted. |
| `review-968-consumer-alert`                                                                                                                                                                                | DELETED duplicate clean checkout; branch ref retained until #968 patch disposition                    | Its tree is byte-identical to `muse-968-consumer-alert` despite a different final commit hash (`git diff --stat` is empty). Keep one checkout for the still-unmerged alert work, not two.                                                       |
| Orphan directory `ipo-partial-float-ticket-1349`                                                                                                                                                           | DELETED build artifact directory                                                                      | It was not a registered worktree and contained only a 3.4-MB `tsconfig.tsbuildinfo`; there was no source or uncommitted checkout work to retain.                                                                                                |

**Detached `research-2087-2089`: integrated and DELETED.** Its clean HEAD
`811e9e807cdc30215304aa8318e02e311a4c66f0` holds a unique 163-line
investigation report absent from development. The report was copied byte for
byte into Track 1 at
`scripts/sim/reports/issue-2087-2089-investigation.md`, retaining its pinned
source revision and explicit caveat that the sandbox observations were not
rerun. The copy was byte-verified, committed in `9a082b5c3e`, and the clean
detached checkout was removed normally. Its unique evidence was retained.

`AHDGame-turn-perf-next` ends at PR #2356's merged commit, but that PR targeted
`main`, not `development`. It is **not** a reason to delete the checkout as
already merged to the requested base. `AHDGame-turn-perf` adds five later
performance commits on top of its production ancestry (index-fund ledger and
quote batching, indexes, phase telemetry). These need selective integration
and before/after bytes/round trips into Track 1 rather than merging production
ancestry wholesale. Both checkouts are clean and remain active-feature until
their patches have a tested `development` disposition.

**Ops PR #4: CLOSED and remote branch DELETED, 2026-09-25.** Its June
`LANDING_PAGE` CSS redesign is superseded by the v4 workbench/nav rebuild on
ops `main` (`17804fc`, `21b09a1`, `c72c36d`). A written reason was posted
on the PR before closure. It had no local worktree.

**Ops PR #34: CLOSED and remote branch DELETED, 2026-09-25.** The prior mixed
commit `4b009d4` is an ancestor of current ops `origin/main`, and current
main contains all named knowledge MCP tools, versioned saves, catalog,
backfill/review scripts, and tests from the PR. Merging the old branch would
reapply stale copies over newer ops changes. A written reason was posted on
the PR. It had no local worktree.

**Ops PR #43: CLOSED and remote branch DELETED, 2026-09-25.** Its July
static consumer-demand report predates the September #2087-#2089 diagnosis
and cannot serve as final-source evidence for current clearing and scarcity
behavior. The CodeQL job failed without retained steps. Track 1 preserved
the later research report and will generate current pinned comparisons.
A written abandonment/supersession reason was posted on the PR. It had no
local worktree.

**`muse-588`: DELETED after discarding a stale worker-status file.**
Its only untracked file, `muse-1.3`, is a 45-byte `finished_at`/`exit_code`
record, not source or simulation evidence. The branch's two source commits
are the sector-turn decomposition and typecheck fix delivered by merged PR
#1942 (`669ad490219b25db82c55c13760ad2b80f5b5ae0`), which covers the
same changed paths; issue #588 is closed. Only that log was discarded, then
clean status was checked and the checkout removed normally. The branch ref is
preserved; no force deletion.

**a-house-divided PRs #4441 and #4440: MERGED to their own `master`,
2026-09-25.** The existing dev dependency patch updates for `@humanfs/node`
and `fast-uri` had green checks and clean merge states. They landed as
`39c471013732eab309cd7071eb60c249212c3b0e` and
`b9a006840559d2bec35377062c2a7ad5905f8eff` respectively. They had
no local worktrees and do not change AHDGame's `development` base.

**Concurrent worktree update, 2026-09-25 00:47 UTC.** Read-only status
shows `worldsim-readiness-20260922` has expanded far beyond the original five
modified sim files: it now has uncommitted changes across `scripts/sim/`,
bootstrap/seed, country, currency, budget, and turn modules, plus new 1991
successor and 2027 regional population source/report files. It is active
feature work for several #2159 blockers, not a prunable checkout. Track 1
must review and integrate its final committed result before qualifying the
release. Its uncommitted contents, branch, and worktree remain untouched.

**Preservation checkpoint, 2026-09-25 00:53 UTC.** The previously dirty
`worldsim-readiness-20260922` tree had no process in its checkout and no file
edits in the preceding three hours. Its 65 modified and 93 untracked files
passed `git diff --check`; no credential-like filenames were staged. They were
committed in that tree as `afcb2681a6cd6366fb107d720cba9e31d64d214f`
(`chore: preserve reset readiness seed and sim work`). ESLint and Prettier
completed on all 158 staged files in the precommit hook; commitlint checked
the final conventional title separately. The tree is now clean. The checkpoint was amended before push to remove a literal local connection string from its handoff note. This is a
**commit** decision for real source work, not a merge or validation claim:
its branch remains active-feature until the patch is reviewed, tested, and
merged into Track 1/development, then the checkout can be removed normally.

**Dynamic inventory update, 2026-09-25 00:45 UTC.** Fresh `git worktree list`
shows 30 AHDGame checkouts after the removals above, including new clean-base
`banking-hub-tables` and `discord-event-cards` feature worktrees created by
other sessions. They are active-feature, not duplicate Track 1 checkouts, and
are reserved for the agents working in them. Fresh PR enumeration finds only
AHDGame #2377 still open; its committed head has green checks, but its
associated worktree has unpublished edits and is still active. A new Ops PR
#186 (`feat/posthog-key-portal` -> `main`) is active; its checks did not start
because GitHub reports an Actions billing/spending gate. Its author's local
verification is recorded in the PR, but this does not substitute for the
repository checks or justify touching the active agent's branch. The current
Ops open set is #186, #168, #167, #162, #137, and #122. This new surface must
receive final merge-or-delete decisions after its owners finish.

**AHDGame PR #2377: MERGED into `development`, 2026-09-25.** Its merge
commit is `311334422141a8f2374dce525f32a44e5b305ba5`. It contributes
measured dead-weight groundwork: production turn-budget evidence, the
existing fund-bid index in reset seeds, corporation helper relocation, and
fund sale-input reuse. All PR checks were green; a disposition explanation
was posted before merge. The `dead-weight-plan` worktree is clean but a
profiling process currently has its cwd there, so it remains protected until
that process exits. Track 1 must rebase and reconcile the fund code overlap.
This PR starts the audited workstream; it does not complete all packages.

**Ops PR #122: CLOSED as superseded; checkout DELETED normally,
2026-09-25.** Ops `main` now binds the latest AHDClient release dynamically
and tests the 2.0.5 asset shape. It already handles `.gz` and `.sig` MIME
types. Reapplying the old PR would restore a stale hard-coded 2.0.5 page.
The clean `ahdclient-2.0.5-portal` checkout had no process in it and was
removed with ordinary `git worktree remove`. Its unique local branch ref is
preserved as provenance; no force deletion was used. The PR received a
written reason before closure and its remote branch was deleted.

**Ops PR #137: REBASED and verified locally, still OPEN.** The source-pin
feature remains needed for the exact-SHA #2159 campaign. Its clean worktree
was rebased onto current Ops `main`; the one source conflict preserved both
the existing experiment-report response and new pin validator. The zod
commit became empty because `main` already declares it. Focused worldsim
source/mode tests passed 13/13, Ops unit tests passed 14/14, syntax and diff
checks passed. The refreshed remote PR changes three MCP files. Full
`npm test` is queued as `20260925T012554Z-1021d2c9`. GitHub test and
analysis jobs failed in two seconds with no steps, matching the repo's
Actions billing/spending gate; Semgrep is pending. It cannot be merged under
the Ops contributor CI rule until required checks actually run and pass.

**Dynamic reuse of `dead-weight-plan`, 2026-09-25 01:29 UTC.** After PR
#2377 merged, another agent repurposed this registered checkout onto
`perf/dead-weight-expiry-projection` at `61036b34d5fe4b08a4821002ca8af89252461a88`
and left ten modified performance source/test files. The profiler process has
ended, but the worktree is now DIRTY active-feature work, not a clean merged
checkout. Track 1 did not remove, clean, reset, or stage it. The new patch
requires a commit-or-discard decision, review, and merge-or-delete disposition
before the final inventory pass.

**Ops PR #167: REBASED and focused-tested, still OPEN.** This one-commit
read-only triage gate was rebased onto current Ops `main` in its clean,
unlocked worktree and pushed. `node --check` and its focused opt-in test
passed using the main Ops dependency install through `NODE_PATH` (the
isolated worktree has none); diff check passed. Hosted test, analysis, and
Semgrep jobs ended without any steps after the refreshed push, matching the
same account-level Actions gate. PR #168 contains an equivalent read-only
gate but remains a larger conflicting delivery branch; #167 is retained as
the small production-safety unit until one lands. The Ops open set is now
#186 (renamed to the credentials portal), #168, #167, #162, and #137.

**Ops PR #168: REBASED and focused-tested, still OPEN.** Its clean, unlocked
checkout had no owner process. A Muse Spark 1.3 contributor resolved the
in-progress rebase onto Ops `main` `57e2b29`, preserving the newer main
support/ticket pages plus the PR's receipt delivery, separate channel/DM
markers, and warm-dashboard behavior. The rebased head
`8c53bc65fdee1695d80c0c6b57084fd88cdc25ab` was pushed with an explicit
lease against old head `28f4606c88b99359b4ebc496e9233c9e56fa7dae`.
Focused syntax, diff, and 72 tests passed. Its full tracked suite is queued
as `20260925T015507Z-0e175e70`; hosted checks are still subject to the
account billing/spending gate. The clean worktree was moved, not duplicated,
from `/root/worktrees/ops-restore-ticket-receipts` to
`/root/projects/LSGD-ops-dash/worktrees/ops-restore-ticket-receipts` so the
shared check scheduler can run there. This is a needed merge candidate, not
a completed merge. A progress comment records the remaining gates on the PR.

**Ops full-suite results, 2026-09-25 02:08 UTC.** PR #137 passed its complete
tracked suite **560/560** in the rebased source-pin worktree; PR #168 passed
**559/559** in the rebased receipt worktree. The first runs failed only because
the isolated installs lacked the locked MCP SDK and/or built `better-sqlite3`
native binding. After `npm ci --ignore-scripts` for #137 and
`npm rebuild better-sqlite3` in both existing worktrees, the reruns passed
without tracked source changes. These are local test results, not substitutes
for the still-zero-step hosted Semgrep/test/analysis gates. Both PRs remain
open, and the exact local result/job IDs were posted to each PR.

**Dynamic AHDGame PR snapshot, 2026-09-25 02:13 UTC.** The open set is now
#2380 (draft analytics/Sentry, targeted at `main`), #2381 (draft next
dead-weight package, targeted at `development`), and #2382 (Track 3
integrations, targeted at `development`). #2381 follows merged #2379 and its
worktree has new unique performance commits plus uncommitted work; it remains
active-feature and protected. #2382 is another agent's active feature branch.
#2380 remains a draft by its author's rollout note pending privacy/consent
review; its clean separate analytics worktree and the unrelated dirty main
checkout remain untouched. Each needs its own final merge-or-delete decision,
and #2380's base must be reconciled with the owner's `development` rule.

The remaining rows above require final decisions and execution; this document
does not mark them complete.

**AHDGame PR #2379: MERGED into `development`, 2026-09-25.** Merge commit
`5c4552f4cb29b6d47917f9beaa6f99f3c9993b59` contains projected
transaction-expiry reads and shared settings snapshots for equity liquidity
and bond-reserve passes. All hosted checks passed on head
`4ae339b03a39463630cc515803e00e8688fa349a`; a contribution and evidence
explanation was posted before merge. A matched before/after turn profile is
still required for the wider dead-weight workstream. Immediately before a
normal worktree removal, `dead-weight-plan` gained a new uncommitted
17-line edit to `DEAD_WEIGHT_PLAN_AUDIT.md` from its active owner. Git refused
removal without force, as intended. This checkout is now DIRTY and must stay
until its owner commits or explicitly discards the new document edit; Track 1
did not touch that content.

**Fresh AHDGame PR snapshot, 2026-09-25 01:34 UTC.** PR #2378 has merged into
`development` as `66ccb07926980085f556ec60fd620f19ee50d464` and contributes
the banking hub table interface. Its feature worktree remains owned by the
other agent; no cleanup is attempted. PR #2379 is a new dead-weight follow-up
on `perf/dead-weight-expiry-projection`: it projects transaction expiry config
and reuses fund transaction settings, with focused tests and a matched turn
replay still being completed by its owner. Its `dead-weight-plan` worktree is
dirty active-feature work; do not remove it. PR #2380 is the separate active
PostHog/Sentry integration targeted at `main`; its worktree and the original
main checkout are outside Track 1 editing ownership. Both new PRs require a
final merge-or-delete disposition after their active owners finish and checks
settle. No content from them is silently treated as already in this branch.

**AHDGame PR #2382: MERGED into `development`, 2026-09-25.** All hosted
checks were green on clean head `09095d53061c997fc445b1a180da69dc7ecf67f6`.
The merge commit is `cc06acd25cf259f9f9ede8076ac57552867ebae8`.
It contributes the scoped read-only API/MCP/CDN/key-introspection surface and
bounded singleplayer CDN mirror without a production rollout. A contribution
and evidence explanation was posted before merge. The `track3-integrations`
checkout was clean, unlocked, and process-free at the removal check and was
**DELETED** with ordinary `git worktree remove`. Its branch ref remains as
provenance; no force removal or branch deletion was used.

**Bot upstream PR surface, 2026-09-25 02:20 UTC.** The initial bot query
covered `Egg3901/adhd-bot` (the owner's fork), which still has no open PRs.
The local bot checkout's `origin` is the writable upstream
`arle-bina/adhd-bot`; it has five older open PRs: #122 supporter sync, #45
URL/stockpick links, #41 market registration/chart repair, #40 market command,
and #36 country/watchlist/autocomplete. All five were enumerated before any
disposition. Most conflict with current upstream `main`, and none has hosted
checks. The game-side supporter, government, and autocomplete routes exist in
AHDGame; the matching `/api/discord-bot/market` route does not. A read-only
Muse patch/content audit is in progress to distinguish useful work from
abandoned or superseded PRs. No bot PR, branch, or worktree has been mutated.

**Bot upstream content audit, 2026-09-25 02:28 UTC.** A read-only Muse Spark
1.3 contributor compared all five open PR patches with upstream `origin/main`
`b5f5638` and the owner's older fork `main` `116d7038`. #122 is unique
supporter-role synchronization and #45 fixes still-live URL/stockpick bugs;
both are **MERGE candidates** requiring rebase, game API compatibility checks,
and verification. #40 is **DELETE as superseded**: its default-export command
would not register in the current loader, its chart dependency is gone
upstream, and the owner's fork has an evolved `/market` command. #41 is
**DELETE after preserving its unique candlestick chart fix** in the fork's
still-broken chart generator; its registration half is superseded. #36 is
**DELETE after preserving its unique watchlist work**, subject to confirming
the game API contract; country and autocomplete are superseded. These are
patch-content decisions, not completed remote dispositions. No bot checkout
or PR was mutated by the audit. The full evidence is in
`/tmp/track1-muse-bot-origin-pr-audit-retry.log`.

**Bot upstream PR #40: CLOSED as superseded, 2026-09-25.** The disposition
reason above was posted on the PR before closing it. Its source branch is
retained for provenance; no dirty or locked worktree was removed.

**Bot PR #45 implementation checkout.** The PR's unique source commit
`ecd59e72c` was fetched into an isolated, clean
`/root/projects/adhd-bot/worktrees/track1-bot-pr45` checkout. A Muse Spark
1.3 contributor is rebasing and testing it against fresh upstream `main`.
This checkout is classified active-feature until its PR merges or is closed;
it is not a duplicate of any existing bot checkout. All existing locked and
dirty bot checkouts remain untouched.

**Bot PR #122 implementation checkout.** Its unique source commit
`79b3c4894` was fetched into the isolated, clean
`/root/projects/adhd-bot/worktrees/track1-bot-pr122` checkout, also
classified active-feature. A second Muse Spark 1.3 contributor is checking
the game-side supporter feed contract, rebasing the command onto upstream
`main`, and running bot checks. No existing bot checkout was repurposed.

**Bot upstream PRs #41 and #36: CLOSED as superseded/abandoned, 2026-09-25.**
The old chart stack targeted by #41 is absent upstream; its registration fix
already exists in the owner fork. Its unique candlestick hunk was preserved in
`/root/misc/archive/adhd-bot-pr41-preserved-2026-09-25.patch`. #36's country
and autocomplete pieces have evolved upstream replacements; its watchlist
command lacks a matching game-side bot API and was abandoned in this old
form. The full #36 patch was preserved at
`/root/misc/archive/adhd-bot-pr36-preserved-2026-09-25.patch`. Each PR has a
posted disposition explanation. No locked or dirty checkout was removed.

**Bot upstream PR #45: MERGED, 2026-09-25.** A Muse Spark 1.3 contributor
rebased its live link-normalization and stockpick fixes onto upstream `main`
`2d81bab42`, keeping the newer embed layout. Its final source was pushed with
an exact force-with-lease and merged as `c975e1cfdb7a261e2210a8b86e6562b7e055fdc6`.
Full local lint, typecheck, test, and build passed on the pushed head; 52
focused URL/embed tests passed. The merge explanation and evidence were
posted on the PR. Its clean, unlocked, process-free checkout was removed with
ordinary `git worktree remove` after repairing an interrupted background
removal; no unique work or ignored cache was retained.

**Bot upstream PR #122: REBASED merge candidate.** A Muse Spark 1.3
contributor reconciled its supporter feed with the game API's three tiers,
added a role-mapping test, and rebased the branch onto upstream `main` after
#45 merged. The shared baseline test typing and lint repairs are already in
that base and were dropped as patch-equivalent. The clean isolated #122
checkout was pushed to the fork at `b49a96c81` with an exact force-with-lease;
the PR has a progress/evidence comment. It remains active-feature while final
post-rebase gates run and has not yet merged. Bot deployment additionally
needs command registration and the existing configured supporter role IDs.

**Ops PR #137: MERGED, 2026-09-25.** The pinned AHDGame source identity for
worldsim jobs landed on Ops `main` as
`dd7bff3126b885654a83de9e9a68011285464cee`. Local full tracked tests
passed 560/560; the three changed files had zero findings under local
Semgrep secrets and Ops rules. The owner approved proceeding despite hosted
private Actions jobs ending before execution. The contribution, evidence,
and CI limitation were posted on the PR. Its clean unlocked worktree was
removed normally.

**Ops PR #168: MERGED, 2026-09-25.** Public receipt delivery, distinct
channel/DM markers, dashboard behavior, and read-only triage landed on Ops
`main` as `ea36a029e79aa5856395cf29bbb796356b4e3be3`. Local full
tracked tests passed 559/559; all 18 changed files had zero local Semgrep
findings. The owner approved the same hosted-CI exception. Its clean
unlocked worktree was removed normally.

**Ops PR #167: CLOSED as superseded, 2026-09-25.** Its exact read-only
triage behavior and explicit opt-in test are now in Ops `main` via #168;
the narrow branch has no remaining unique behavior to merge. The reason was
posted on #167, and its clean unlocked worktree was removed normally. All
three removed Ops worktrees had no owner process and no uncommitted files at
the removal check.

**AHDGame #1672 review checkout: DELETED as superseded, 2026-09-25.** A
read-only Muse Spark 1.3 audit compared `review/issue-1672-military` with
`fix/issue-1672-atomic-money-flows`. The review branch diverged at
`c71d35def5` and had one later tip, `7d30dd304f`; `git cherry` marks that
tip patch-equivalent to the active branch. It added no unique production
behavior. After a fresh clean/unlocked/process-free check, its checkout was
removed with ordinary `git worktree remove`; the branch ref remains for
provenance. The main #1672 branch remains a MERGE candidate with 55 unique
commits and unresolved verification/rebase work, not a prunable tree.

**AHDGame Campaign 3 snapshot checkouts: DELETE as superseded, 2026-09-25.**
`sim-c3-all-20260917` and `sim-c3-uk-20260917` are clean, unlocked and
process-free. `git cherry origin/development` finds exactly one patch-unique
commit common to both: `94523e4794`, which only rewraps the return expression
and ternary formatting in `cabinetEligibility.ts` without changing behavior.
The simulation snapshots are historical evidence, not candidate source; their
other commits are patch-equivalent to development. Both worktrees were removed
with ordinary `git worktree remove` after the clean/lock/process check. The
branch refs remain for provenance. This is a written discard decision for the
formatting-only patch, not an automated removal of unreviewed unique behavior.

**AHDGame #1672 source review, 2026-09-25.** A separate read-only Muse Spark
1.3 review found the active `muse-1672` branch clean with 55 patch-unique
commits, 253 changed files and about 86,000 added lines from its merge base.
Its crash-safe money-flow primitive and several independent spend modules are
valuable, but the branch as a whole has unverified WIP boundaries, conflicts
with Track 1 fund/Euro settlement work, and still leaves Euro conversion,
treasury, privatization and fund wind-up paths outside #1672's acceptance.
Disposition decision: **extract and merge verified slices into Track 1, then
delete the superseded source checkout only after every retained slice is
accounted for**. A wholesale merge or immediate deletion would each discard
required review. The source worktree stays active until extraction is complete.

**New AHDGame PRs since the first inventory, 2026-09-25.** #2385
`fix(mcp): harden public API bridge protocol handling` was fully green and
merged into `development` as `2f52a77d63abdfadc34dd2c5b5cb4f02fd976a84`.
It adds parse/protocol/disconnect/argument guards and focused stdio tests to
the read-only bridge from #2382; the merge reason was posted on the PR. Its
source `track3-integrations` worktree passed a fresh clean/lock/process check
and was removed with ordinary `git worktree remove` after the merge. #2384 is
the `staging` to `main` production promotion and is
currently conflicting; #2386 is the `main` into `staging` ancestry repair
intended to unblock it, with CI still running. These are active promotion
steps, not feature-branch cleanup targets; resolve their gate and sequence
before their final PR/worktree disposition.

The #2386 ancestry repair merged into `staging` as
`156d3f7949a0a7052d961d786ab557c902d963f8`, leaving #2384 mergeable
but awaiting its promotion gate. New draft #2387 targets `development` with
public API auth/CDN hardening and has an active owner. Its disposition is a
merge after review and green gates or a documented supersession if another
branch carries the same behavior; no active source worktree is pruned.

**AHDGame short-turn candidate: DELETE as superseded, 2026-09-25.** A
read-only Muse Spark 1.3 audit of all 20 commits in
`verify/short-turn-candidate-20260920` compared each behavior with current
development and Track 1. The 19 patch-unique hashes are historical work that
landed through squash PRs #2180, #2186, #2189, #2201, #2209, #2210, #2255,
#2274 and #2283; the twentieth is patch-equivalent by `git cherry`. No
behavior remains to extract. The worktree is clean, unlocked and process-free.
It was removed with ordinary `git worktree remove`; the branch ref remains a
dated candidate artifact for release provenance.

**Legacy private game repo Dependabot PRs: CLOSED as abandoned, 2026-09-25.**
The remaining 11 open dependency PRs in `Egg3901/a-house-divided` were
#4451, #4448, #4447, #4446, #4445, #4444, #4443, #4442, #4435, #4434 and
#4422. Each received a closure comment and was closed. That private repo is
retained for internal sync/ops assets; `Egg3901/AHDGame` is the live public
game and Railway deploy source. Merging dependency bumps into stale private
`master`/`development` would not update the runtime. Public dependency needs
must be evaluated against the public repo's current package and lockfile;
this disposition does not assert those versions have all been adopted. No
private checkout, dirty file, or locked worktree was touched.

**Fresh PR inventory, 2026-09-25 04:19 UTC.** The original snapshot above is
historical. A fresh `gh pr list` found #2380, #2381, #2384, #2388, #2389,
#2390, and #2391 still open. #2387 has merged into `development` as
`6360845ec34141570a0be3ba55e5d3bd55efc6aa`; #2390 promotes it together
with #2385 to staging. The new rows require these dispositions:

| PR    | Current classification                                      | Required disposition and reason                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2388 | Draft, active owner feature; base `main`                    | Merge to its base after the owner completes the staging worker rehearsal and deployment prerequisites, or close only if the dedicated worker is abandoned. It adds a production start command and runbook, not a Track 1 source branch. CI was green at the snapshot; no Track 1 checkout is removed.                |
| #2389 | Active staging repair; base `staging`                       | Merge to staging after its green CI and verify Railway can build with the cache mount. It fixes the `EBUSY` failure caused by removing the mount directory and must precede the staging promotion.                                                                                                                   |
| #2390 | Active promotion; base `staging`                            | Merge with a merge commit after #2389 and staging deployment health. It promotes already merged #2385/#2387; its source is `development`, so no independent feature checkout exists.                                                                                                                                 |
| #2391 | Active security fix, currently conflicting with development | Rebase/review the concurrent vote, API-key, barrier, forex, blackjack, and privacy repairs, then merge only after full gates and the real-Mongo race proof. It touches Track 1 transfer/forex surfaces and needs integration rather than a blind merge; no source checkout will be pruned while the owner is active. |

#2380/#2381/#2384 remain active dispositions from the earlier updates. No
locked or dirty checkout was touched to make this inventory update.

**Promotion follow-up, 2026-09-25:** #2389 merged to `staging` as
`a9f1261b8d54ac0aac71b3c3e051ce517aee4af2` after its full CI went
green; it preserves the Railway cache mount while clearing its contents.
#2390 then merged to `staging` as merge commit
`6bf2fbaf5dd5ebe835990831acad5ca365867d68`, promoting the already
reviewed #2385/#2387 source. Staging deployment health and the subsequent
#2384 production promotion remain separate release gates; this record does
not claim they passed.

**Old #1672 bond-sale patch: DISCARD as superseded, 2026-09-25.** The
source `muse-1672` commit `4670f10cbe` was initially extracted into Track 1
as `108c84d656`, then supervisor review found it failed same-key recovery
after a holder claim or a market quote change. Development already contained
merged PR #2288 (`4b5f615115cf1181fadd1afb2cbfd5586aba3f50`), which
persists sale intents with frozen terms and a recovery queue. The duplicate
extraction was reverted as `0108ff94f2`; its Muse follow-up was stopped
before any new source edits. This is a disposition for the bond-sale slice,
not for the still-active 55-commit source checkout: other unique flow
families there still need individual accounting.

**AHDGame `muse-968-consumer-alert`: MERGED useful slice, checkout removed,
2026-09-25.** Development already carried the corporate no-holder median
calculation. Source commit `aaa733686e` cherry-picked only duplicate median
tests, so that redundant cherry-pick was reverted as `c1bded4388`. Its two
alert-rule commits landed in Track 1 as `60abe0511f` and `f958dc75bc`, and
`7a1dd68c33` connected the alert to the admin snapshot API and deterministic
economic report. Focused tests and scoped lint/format passed. The source
checkout was clean, unlocked and process-free at removal, and ordinary
`git worktree remove` succeeded. The branch ref remains as provenance.

**AHDGame promotion #2384: MERGED, 2026-09-25.** The `staging` to `main`
promotion merged as `d24b542a7c35ea3e9cdd337f82fda885be91c216` after
#2389 and #2390. #2388's owner retargeted its still-draft dedicated-worker
PR from `main` to `development`; its final disposition remains outstanding.

**Bot PR #122: MERGED, 2026-09-25.** Existing `feat/sync-supporters` merged
into `arle-bina/adhd-bot` `main` as `39570e0f291b44893cc6b50866baba979f3ac3f5`.
It adds admin-only dry-run-first supporter role reconciliation. Track 1
follow-up `8040673bb` corrected unchanged-role previews, missing-role errors,
and swallowed Discord role failures. Exact head passed lint, typecheck, build,
and 343/343 tests. Ordinary `git worktree remove` deleted tracked source after
its patch became ancestor of upstream `main`; the detached background removal
left only `README.md`, `CHANGELOG.md`, and an ignored `.npm` cache (2 MB) with
no `.git` file. Those verified residuals were removed and stale worktree
metadata pruned without a force option. No bot deployment or command
registration was performed.

**AHDGame `muse-1672`: ACTIVE unique source, 2026-09-25.** A read-only Muse
Spark 1.3 audit classified all 55 commits against current development and
Track 1; see `TRACK1_1672_SOURCE_AUDIT.txt`. The clean source checkout remains
the only converged reference for seven extraction slices. Its final
merge-or-delete disposition is contingent on extracting and verifying every
unique slice in Track 1; it is not safe to prune yet. Bond sale, forex turn
fills, and queued fund redemptions have explicit superseding implementations
recorded in that audit.

**AHDGame `player-qol-round3-ci`: DELETE as superseded, 2026-09-25.** Its two
commits implement #2046's UK PM Commons-seat repair, already closed by merged
PR #2048 (`7b78045227`). The development implementation has the same
eligibility guard plus a stronger sequential cabinet-clear path that avoids
erasing office rows before restoration, and retains an NPP-seat regression
missing from this source. Its checkout was clean and unlocked before ordinary
`git worktree remove`; the branch ref remains for provenance.

**AHDGame `player-qol-round3`: DISCARD uncommitted duplicate after review,
2026-09-25.** This old zero-unique-commit checkout contains a 35-path draft of
#2049's UK dual ministry work (26 modified and ten untracked source files).
Merged PR #2068 (`2c421aa7f7`) closes #2049 with the full role-slot index,
shared action pool, survivor lifecycle, distinct-person
voting, migration, and 64 focused tests. Its 39-file reviewed merge replaces
the draft's helper/migration/rules layout and adds vote, office, and turn
coverage absent from the draft. The issue's complete contract is in
development. Decision: discard the stale draft's tracked modifications and
untracked source files, then remove its checkout normally after a fresh clean
check. No unique branch commit is being deleted. This is a written discard
decision for real uncommitted work, not a claim of byte identity. The exact ten
untracked files were checked against an allowlist and deleted; the tracked
draft was restored in this worktree only. A fresh status was clean before
ordinary `git worktree remove`.

**AHDGame PR #2391: MERGED into `development`, 2026-09-25.** The security
repair was rebased over #2387 and merged as `67eda32bb6eea5d108784cb3087938ccb292d08e`.
Its exact head `a26860b8fd` passed all four test shards, verify, build,
lint, format, typecheck, Semgrep, CodeQL, and dependency review. Legacy
share-order/offer test fixtures were updated to isolate the new transfer
clock. The clean source `redteam-sept25` checkout was removed normally after
its patch was proven on development; no vulnerability issue was opened.

**AHDGame PR #2380: MERGED into `development`, 2026-09-25.** Consent-gated
PostHog analytics and the existing Sentry SaaS connection merged as
`f005b9ecfb19529c055595491ab5835b5e69af04` after all exact-head CI,
security, build, test, and singleplayer smoke checks passed. No key or player
data was committed, and no production deployment/configuration changed. The
clean, unlocked `analytics-sentry` source checkout was removed normally after
patch equivalence was checked. The dirty main AHDGame checkout belonging to
the other active integration agent was never touched. Staging consent and
Sentry delivery checks remain rollout gates.

**AHDGame PR #2388: MERGED into `development`, 2026-09-25.** Dedicated worker
start command and measured cutover runbook merged as
`2bb4ee173fc1bc5efd4006bc03b361e6534ad5a9` after exact-head CI and
startup guards. The `infra-scaling` source worktree is LOCKED by its active
owner and was not moved or removed. Staging two-turn worker rehearsal and
Railway configuration are later operational gates, not claims made here.

**AHDGame PR #2392: MERGED into `development`, 2026-09-25.** The central-bank
rate snapshot for corporation turn merged as
`346f0cdde97ee3e237d78fa1f153da7038a14b6a` after 34 focused tests
and all hosted CI checks. The measured same-snapshot 1991 replay reduced
`corporationTurn` from 1,477 to 1,407 Mongo round trips and 32.9 to 25.6 MB
BSON; attribution of the full phase delta is limited by replay variation.
The `turn-perf` source and its baseline checkout are LOCKED by the active
performance session, so both remain in place. No locked checkout was touched.

**Open AHDGame PR remainder, 2026-09-25:** #2381 is the sole open PR. It is
an active draft on `perf/dead-weight-next` with WP3/WP7 measurements and CI
still in progress; its `dead-weight-plan` checkout is dirty. Its final
merge-or-delete decision requires the owner session to finish its source and
checks, and Track 1 must then incorporate or discard it before final PR.

**AHDGame `track3-edge-auth-review`: DISCARD uncommitted superseded patch,
2026-09-25.** The branch commit is already an ancestor of development. Its
nine dirty source files are the pre-merge #2387 hardening draft: seven are
byte-identical to merged commit `6360845ec3`; the remaining CDN route and
test lack the merged version's catch for a stream failure after headers and
its regression. The merged version is strictly stronger. Decision: discard
the nine old working copies, verify clean status, and remove the unlocked
worktree normally. This was done after a fresh clean check. No unpublished fix
or patch-unique branch commit was lost.

**AHDGame `track3-auth`: DELETE patch-equivalent clean checkout, 2026-09-25.**
Its one scoped-key introspection commit `361e1e7f31` is patch-equivalent to
development's `8e3eab59ea` (`git cherry` reports `-`), and development also
contains the later rate-limit isolation `09095d5306`. The source checkout is
clean, unlocked, and process-free. Decision: remove it normally; its branch
ref stays as provenance.

**AHDGame `track3-auth-cdn-hardening`: DELETE redundant clean checkout,
2026-09-25.** It is an unlocked, process-free checkout of the old development
commit `6360845ec3`; fresh origin/development already contains that commit
and four later merged PRs. Fresh status showed no changes. Decision: remove
the redundant checkout normally, keeping Track 1 as the only task checkout.

**AHDGame `track3-cdn`: DELETE redundant clean checkout, 2026-09-25.** Its
catalog tip `33e9a85318` is patch-equivalent to merged development
`e6888643e6` (`git cherry` reports `-`), and later #2387 hardened that
catalog. Its three patch-unique ancestor commits are IPO reversal/org
migration work already carried by the protected active main checkout branch
`fix/admin-funded-ipo-reversal`; they are not CDN work and are not deleted
or discarded. Fresh worktree status is clean, it is unlocked and process-free.
Decision: remove only this redundant checkout normally, retaining both the
CDN and protected IPO branch refs.

**AHDGame `track3-mcp-hardening`: DELETE superseded clean checkout,
2026-09-25.** Its one patch-unique commit `f5a8500c5c` is an earlier MCP
JSON-RPC hardening draft. Merged PR #2385 (`2f52a77d63`) contains that
handler and tests plus stricter finite-ID and `jsonrpc: "2.0"` validation and
12 additional regression-test lines absent from this source. A direct
two-file diff confirms the source has no extra handler behavior beyond the
merged version. The checkout is clean, unlocked, and process-free. Decision:
remove it normally as superseded, retaining the branch ref for provenance.

**AHDGame release cache and promotion checkouts: DELETE superseded clean
checkouts, 2026-09-25.** `fix-staging-build-cache` (`94eca6f2a1`), detached
`staging-build-cache-release` (`82bfd685ec`), and
`promote-staging-to-main` (`3894576908`) are unlocked, process-free, and have
clean working trees. The cache repair landed in staging through #2389, in
production through #2384, and its exact production script plus build hook
were carried into Track 1 development as `48beb50c96`. The promotion source
has already merged through #2390 and #2384. These checkouts add no remaining
source work; their release commits remain available from remote history and
the named branch refs. Decision: remove all three normally. This also keeps
one checkout per commit where the old release checkouts would duplicate
merged history.

**AHDGame `AHDGame-buildfix`: DELETE superseded clean production cache
checkout, 2026-09-25.** Its earlier observability and ticket ancestors are
already on production `main`; `git cherry origin/main` identifies only the
old cache-clearing commit `66340238ba` and its note `e18e94f169` as distinct
patches. The old script removes `.next/cache` itself, which fails when that
path is the Railway cache mount. Staging #2389 and the production promotion
#2384 replaced it with a mount-preserving script; Track 1 carries that exact
repair into development as `48beb50c96`. No older cache behavior should be
merged. Fresh status is clean, the checkout is unlocked and has no owner
process. Decision: remove it normally while retaining its branch ref.

**AHDGame `ticket-receipt-api`: DELETE abandoned clean API prototype,
2026-09-25.** Its sole unique commit `49cd126cb5` widens the ticket schema
and close request to a structured receipt, a `resolved` pending state, and
caller-supplied `resolutionDelivered`. The live bot #122 and ops #168 use the
existing string resolution plus explicit `resolution-delivered` acknowledgement;
neither consumes the new fields, and no open issue requests this schema
change. The prototype has no route tests for the new request or delivery
state. Merging the extra public contract would add an unneeded way for a
caller to mark a receipt delivered without the bot's acknowledgement. Decision:
abandon this unconsumed prototype and keep the reviewed existing delivery
contract. Fresh status is clean, checkout unlocked and process-free; remove
normally and retain its branch ref as provenance.

**AHDGame `npp-bounded-directives`: DELETE abandoned clean singleplayer
mechanic, 2026-09-25.** Six unique commits add a 2,403-line NPP strategy
room, new player directive rules, fiscal and diplomatic weights, API/UI, and a
persisted `GovernmentFormation.playerDirective` field. There is no issue for
this new mechanic/schema or `scripts/sim/` balance report, both required by
AGENTS.md before a production merge. The open NPP mandate issue #2321 asks
for the winning party's electoral platform; this branch instead adds an
independent player-authored brief and does not solve that issue. Its changes
are therefore outside the approved reset repair and would alter autonomy
outcomes without qualification. Fresh status is clean, checkout unlocked and
process-free. Decision: abandon and remove the checkout normally; retain the
branch ref so the experiment is recoverable if separately scoped later.

**AHDGame `private-privatization-vote`: DELETE abandoned clean buyout
mechanic, 2026-09-25.** Its one unique commit `c6ba158db9` opens the public
take-private vote to private corporations with minority holders and changes
the corporation action card. No open privatization issue requests this new
mechanic or supplies its required balance simulation report. It is based on
older settlement code and omits development's later #1750 bank-NAV buyout
floor and IPO unplaced-share handling, so a direct merge would regress both
guards. Its unrelated pending-ticket query change has a separate supported
delivery path in the merged bot/ops work. Decision: abandon this older
unqualified mechanic rather than change live buyout eligibility in the reset
repair. Fresh status is clean, checkout unlocked and process-free; remove it
normally, retaining the branch ref for provenance.

**AHDGame `worldsim-readiness-20260922`: DELETE extracted clean handoff
checkout, 2026-09-25.** Its one unique checkpoint `afcb2681a6` preserved
158 changed source/test/report files and was integrated into Track 1 as
`609cf2bd7d` (153 paths). The five overlapping paths were reconciled in
other Track 1 changes: `seedForex.ts` sets all eight 2027 euro members,
`seedSovereignBondInstruments.ts` resolves the budget currency,
`currency/migration.ts` seeds euro rows at the German anchor rate, and the
game-health type plus export are present. The differing implementations are
intentional rather than missing handoff patches; the preserved branch ref
still contains the original checkpoint. Fresh checkout status is clean, it
is unlocked and process-free. Decision: remove this redundant source checkout
normally. This does not claim its 1991/2027 implementation or reports pass
the final release gate; outstanding tests and conformance stay in the plan.

**AHDGame `AHDGame-turn-perf-next`: DELETE duplicate clean performance
checkout, 2026-09-25.** Its one combined #2356 commit `33a2f5d8e9`
contains the same 14 scoped source/test/index files, byte for byte, as the
five successive performance commits ending at `216d506905` in the clean
`AHDGame-turn-perf` source checkout. A scoped tree diff across all 14 paths
is empty. Keep the five-commit source for selective integration and its
per-step measurements; this combined checkout adds no distinct result.
Fresh status is clean, it is unlocked and process-free. Decision: remove
normally, retaining the branch ref. The five source commits remain an
explicit Track 1 merge/performance gate, not a claim they are already in
development.

**AHDGame `muse-1724d`: MERGE reviewed dirty UI work, then DELETE its
checkout, 2026-09-25.** Its two Poll-rule commits `7774723e2d` and
`2687fd7798` are superseded in source by merged development PR #1973
(`7f1dacb761`): the current pure quote, route, UI, and tests also thread the
newer price level. A conflict review preserved the newer behavior, producing
only the missing Poll changelog (`5cdab5f996`) and an empty provenance
follow-up (`2008e7c844`); 160 focused Poll tests passed. The checkout's real
uncommitted `WatchlistPanel.tsx` edit was separately reviewed and ported to
Track 1 as `bcdfd2d5b1`, with search/select and stale-response tests. Review
found that public search excludes banned users, so `9dd4e2bd43` restored
direct user-ID entry and added a banned-account fallback test; 3/3 watchlist
tests, scoped lint, and format pass. Decision for the dirty source file:
**commit its behavior to Track 1**, then discard only the redundant working
copy after confirming the search/select behavior and clean-state restoration.
The three untracked `muse*.log` files are local provider transcripts, not
source or game evidence; discard them by exact path. Never force-remove the
checkout. After a fresh clean, unlocked, process-free check, remove it
normally while retaining its branch ref for provenance.

**AHDGame PR #2381: MERGED, 2026-09-25 07:22 UTC.** The final clean
`perf/dead-weight-next` head `768d5dd478` targeted `development`, was
mergeable, and passed lint, format, typecheck, all four test shards, build,
custom Semgrep, dependency review, CodeQL, and the title gate. Its scoped
turn work batches tariff reconciliation, corporation vote reminders, and NPP
finance candidate reads; projects share-order and sovereign reads; and adds
recurring snapshot indexes. The PR records matched local before/after
command/document/byte measurements and unchanged result digests, with the
partial-world and production-latency limitations made explicit. Squash merge
`1919657c625cf5582034f3506357dedfda8e7fe9` is on `development`.
The Track 1 branch incorporated that squash in merge `f2ba89a6cc`. The
`dead-weight-plan` source checkout was rechecked clean, unlocked, and
process-free; decision: remove it normally, retaining the branch ref.

**AHDGame `AHDGame-turn-perf`: MERGED selectively, then DELETE clean
checkout, 2026-09-25.** The five commits ending `216d506905` from production
PR #2356 contribute bond-purchase and liquidity-quote ledger batching,
hot-path indexes, quote receipts/ask-reservation preload, and over-budget
collection attribution. Track 1 integrated them as `a8298fe1a6`,
`cb7e61920d`, `a1e4a8d7d3`, `4539de1277`, and `66b0b0debe`; two small
focused repair commits preserve the newer fund thresholds/cadence and test
shape. Forty-nine focused tests, scoped lint, formatting, and diff checks
passed. The source checkout was rechecked clean, unlocked, and process-free;
decision: remove it normally while retaining its branch ref. The full
integrated build and matched turn-profile gate remain open.
