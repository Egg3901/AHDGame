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
worktree `track1-fixer`). Another agent is coding #2291 in this worktree;
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

Recommendation vs execution: EVERYTHING below is a recommendation. Nothing
was merged, deleted, moved, force-removed, or edited outside this file.

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
