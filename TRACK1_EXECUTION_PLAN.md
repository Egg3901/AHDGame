# Track 1: total system analysis rework

Status: in progress. This is the execution record for the owner's 2026-09-24
note, not a declaration that reset readiness has passed.

## Source and base

- Original note: `/root/misc/archive/total-system-analysis-rework-2026-09-24.jpeg`, read on 2026-09-25. The supplied transcription agrees with it.
- Source branch: `origin/development` fetched on 2026-09-25.
- Exact base: `028cb9265e76555efa5d73b611cea0f409c3446b`.
- Latest incorporated `origin/development` on 2026-09-25 is
  `1919657c625cf5582034f3506357dedfda8e7fe9` (through #2381 turn
  performance, #2392 turn performance, #2388 worker, #2380 analytics, and
  #2391 security). Track 1 first rebased
  onto `cc06acd25cf259f9f9ede8076ac57552867ebae8`, retaining both the
  newer fund-liquidity threshold reuse and crash journal at that conflict.
  It then merged the newer development head cleanly as
  `3456be9ac6412df733e76d35b2dc9d46cce30293`, then incorporated the
  newer development head as merge `90b3bf85c7e871dfe5093625b6febc4daae42601`,
  then incorporated #2381 as merge `f2ba89a6ccfbaacb0bb60fd0e0de783487a96eb2`.
  Its sole conflict combined #1672's orphan recovery hook and #2381's
  projected share-order read; 52 focused tests, scoped lint, and format passed.
  The exact base above records where Track 1 began; the incorporated commit
  records current development ancestry. Refresh again before the final PR if
  development advances.
- Worktree: `/root/projects/AHDGame/worktrees/track1-fixer` on
  `track1/total-system-analysis-rework`.
- The main checkout contains another agent's uncommitted PostHog/Sentry work.
  It must remain untouched. All Track 1 edits occur in this worktree.
- Issue #2159 selects `1991-default` for the reset. The owner also requires
  2027 defects to be fixed in this Track. A profile change invalidates the
  1991-specific launch evidence and requires a new qualification.
- For #2289, retain HU, PL, RO, BG, and RU in the 2027 effective manifest.
  These countries are already configured as active election/economy actors;
  RU and PL also matter to the 1991-to-2027 crisis horizon. Removing them
  would shrink the modeled world and require broader election, crisis,
  economy, and conformance exclusions. Build and validate their missing
  regional, political, economic, military, and currency substrate instead.
  All five country `eras/2027.ts` files currently contain only the preset id,
  and their geography dispatchers contain no `2027-default` mapping. Repair
  the modern-era overrides and seed dispatch together; copying earlier-era
  region arrays alone would retain obsolete institutions and party behavior.
  In `bootstrapGameWorld.ts`, the existing RU and nine-satellite seed stacks
  deliberately run only for `isEasternBlocEra(preset)`; preserve that Cold War
  guard and add a separate modern-country seed path for the selected five.
  This decision does not weaken #2289's zero-critical fresh-bootstrap gate.
  The DE 2027 organization floor is already calibrated to its authored
  geography (96 rows: 15 CDU, one Bavaria CSU, and five all-Land parties;
  `readinessExpectations.ts`). The historical IE 24-row warning predates the
  current five-party 2027 vote-share seed. Commit `8a1709776a` tests the
  current filtered 2027 party roster against that seed and proves 40 rows
  across all eight IE regions. A fresh exact-release bootstrap must still
  confirm both counts in persisted collections.
- For the 2027 electorate repair, the owner approved a temporary projection
  waiver on 2026-09-25 while the Census Bureau has not announced publication
  of the 2025 ACS 1-year detailed tables. Keep the January 2027 education and
  income projection with explicit source-year provenance, monitor the official
  release notice, and regenerate the 2027 substrate plus replay its checks when
  those tables are published. This does not waive implementation or validation
  of the other 2027 repairs; the selected launch reset remains 1991. The
  decision and final-gate relationship are tracked under RR-062 and #1670.
- Hungary's initial 2027 source patch used 2022 parties and older economic
  anchors. Commit `949c63c4e2` corrects the party roster to the official
  2026 election result and reconciles authored regional estimates to KSH's
  1 January 2026 population of 9.488 million and first 2025 GDP estimate of
  HUF 86,893 billion. The regional figures remain estimates; budget and FX
  data must align before the bootstrap gate. Sources:
  https://valtor.valasztas.hu/valtort/jsp/ma1.jsp?EA=47,
  https://www.ksh.hu/stadat_files/nep/hu/nep0002.html, and
  https://www.ksh.hu/en/first-releases/gdp/egdp2512.html.

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
   For #1672, extract and verify the crash-safe money-flow primitive and
   independent spend modules from its old 55-commit source branch before
   reconciling the conflicting fund, share and Euro paths. Account for every
   retained slice before deleting that clean source checkout. Do this before
   layering the five later fund performance commits, which touch some of the
   same files.
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
7. **Prepare the final gate.** On sandbox Mongo, prove bootstrap conformance,
   founding and normal-turn behavior, reset/restore tooling, report retention,
   and source pinning with deterministic fixtures and the smallest targeted
   probes justified above. Resolve every finding before freezing the candidate.
   Open the single PR only after all non-worldsim checks pass and every issue,
   PR, and worktree has a documented disposition. At that point its only
   remaining gate is the coordinated final campaign.
8. **Final campaign and accounting.** On the frozen candidate SHA, run the
   three 1991 seeds, ten-year continuations, horizon extension, reset rehearsal,
   2027 repair probe, and exact-SHA release replay as one coordinated campaign.
   Inspect complete time series and issue-owned guardrails; attach sanitized
   reports and source revisions. A code/configuration change invalidates the
   affected campaign evidence and requires a fresh frozen candidate. Update
   every touched issue with source/test evidence and remaining criteria. Close
   children and #2159 only after _all_ applicable final gates pass, updating
   parent counts in the same pass. The PR is prepared for this last gate; it
   does not claim final validation before the campaign finishes.

## Dead-weight workstream

The owner's note explicitly calls out "dead weight." Existing PR #2377
contains an audited 14-package execution map. Its documented corrections
matter here: 240 seconds is a _per-phase_ timeout; registered phase names
are not executed phases; the 21,892-command/209.1-MB figures came from one
local sandbox turn, not production; the 84%/32-phase/3-GB targets lack a
measured model. Do not make those targets release acceptance gates.

Execute these packages in dependency order within the Track 1 code and
validation work, retaining each measured before/after result in the final PR:

1. **WP0-WP2:** remeasure a pinned turn, then batch index-fund and
   corporation-turn reads/writes. For #2271 use isolated 1991 full-flags
   evidence and require zero index-fund timeouts without changing fund
   outcomes. Integrate the five later performance commits from the clean
   `AHDGame-turn-perf` checkout selectively, after proving they are absent
   from `development`.
2. **WP3-WP6:** separate NPP command cores, batch banking/vote/support
   phases, profile CPU-bound phases, and reduce BSON decode from fat
   collection reads. Preserve phase order, RNG sequence, per-phase resume,
   rules/shell boundaries, and the read projection/round-trip budgets.
3. **WP7-WP9:** inventory per-collection retention, election-candidate
   lifecycle, and recovery/idempotency with fault injection. Delete data
   only after a migration and rollback are verified; never use cleanup as
   the fix for settlement invariants.
4. **WP10-WP13:** consolidate only seams with compatible rules and cadence;
   retire each heal route after its root cause and replacement are proven;
   reconcile route naming and measure compiler RSS before setting a heap
   target. The two-file `corporation/` residue and already unified
   `billDiscussions` collection are accounted for as source facts, not
   speculative large savings.

The required proof for turn work is a pinned one-turn profile with bytes,
documents, and Mongo round trips by phase before/after, then focused
correctness tests and the 1991 qualification prefix. Wall-clock time from a
shared box is supporting context only.

## Worldsim budget

The #2159 acceptance criteria are a floor. A literal single world run cannot
meet its three-seed early-world and ten-year matrices plus post-change replay.
The owner confirmed on 2026-09-25 that "single final validating worldsim
run" means one coordinated final **campaign** on a frozen SHA, containing
the required deterministic seeds, horizon run, and release replay. #2159's
acceptance criteria remain intact. A changed release SHA invalidates that
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
for a targeted test. `scripts/sim/runWorld.ts` documents and implements
same-seed/same-DB continuation from the existing turn, with `--turns` counted
from that turn and per-turn progress persisted; this supports the shared
five-year, ten-year, and horizon starts. The budget remains provisional until
the production worker's pinned-source resume and complete report retention
are verified in sandbox.

Issue #2316's pre-merge demographic/balance report uses the fresh bootstrap
and first five turns of the **first planned 1991 qualification seed**. It adds
no world start. Save its conformance summary and `scripts/sim/checkpointReport.ts`
output at turn 5 before continuing that same world through the five-year and
ten-year gates. The source checkpoint cannot merge into `development` before
that report exists; integrating and testing it inside this unmerged Track 1
branch does not claim the report gate has passed. This prefix runs only after
deterministic zero-critical bootstrap and repeat-seeding tests are green.

Worker source inspection confirms a continuation job can point at the same
sandbox database: `worker.ts` verifies the pinned worktree before spawn and
again before report collection, while `runWorld.ts` detects an already
bootstrapped database and advances from persisted `gameState.currentTurn`.
Give each queued continuation its own run ID, retain the prior run IDs and
reports, and assert identical seed, preset, source SHA, and manifest across
the chain. The first actual sandbox continuation remains a required rehearsal
of report stitching before relying on it for the horizon evidence.

The initial 1991 qualification worlds also supply #2078's corrected six-turn
anomaly precision and scan-duration window. Its transfer-detector code and
targeted fixtures are already in development; a separate world start would
duplicate the matrix without improving coverage.

### Inherited sandbox runs, outside the final budget

The preserved `worldsim-readiness` handoff records starts made before this
Track 1 branch and before its final source freeze. I checked the local
sandbox `simJobs` status on 2026-09-25; these runs are diagnostic history,
not release qualification or extra planned campaign starts.

| Job                                    | Profile / result                    | Purpose and disposition                                                                                                                                                 |
| -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c3c60a2e-088f-4389-92c4-631e7c13a918` | 1991, failed at turn 0              | Fail-fast bootstrap probe identified the seven missing successor-country bundles. Do not continue its invalid world.                                                    |
| `0ceb61be-3ee7-4147-9877-7e63a7617332` | 2027, failed at turn 0              | Fail-fast bootstrap probe isolated Turkey regional population; euro comparison false positives had been corrected in newer source.                                      |
| `24416f47-51b3-45d1-b192-9dbe790ff51e` | 2027, completed at turn 6           | Short repaired-bootstrap probe, not a 240-turn or release-SHA result.                                                                                                   |
| `038bc511-167a-4c60-a9c3-ae4eb2fa0637` | 2027, completed at turn 5           | #2325 four-turn regional-population overlay probe with before/after totals in `scripts/sim/reports/issue-2325-modern-regional-population.md`; short-seed evidence only. |
| `6ee60360-699f-4001-9713-1252dbc4b95a` | 1991, stopped at turn 30 (exit 143) | Full-flags diagnostic with 49 successor-country criticals; intentionally interrupted rather than spending 240 turns on invalid input.                                   |
| `2df29be2-b4c0-4d62-a3fb-6e21e162e003` | 2027, stopped at turn 41 (exit 143) | Full-flags diagnostic with stale euro and Turkey findings; intentionally interrupted.                                                                                   |

No new Track 1 worldsim has been started. The forward seven-start budget
begins only after the integrated candidate passes non-worldsim gates and
bootstrap conformance. Reusing a stopped or unpinned prior world would not
meet the exact-source acceptance criteria.

## Stop conditions for a launch claim

Any unexplained seed integrity error, money conservation failure, unresolved
settlement, candidate-less election, missing crisis family, stale/misattributed
telemetry, phase budget regression, failed restore, or missing owner-approved
waiver blocks the final validation decision. A queued or incomplete horizon
run is insufficient.

## Execution log

- 2026-09-25: Created the isolated `track1-fixer` checkout from fetched
  `origin/development` at `028cb9265e76555efa5d73b611cea0f409c3446b`.
  Removed the accidental clean duplicate. Main checkout remains untouched.
- 2026-09-25: Enumerated the 99 #2159 checklist rows into a separate ledger,
  inventoried 70 open issues and the PR/worktree surfaces, and preserved the
  owner's 39-worktree AHDGame classification. See the tracker and inventory.
- 2026-09-25: Merged AHDGame dependency PRs #2263, #2267 and #2266 into
  `development` after their required checks passed. Closed incompatible PRs
  #2264 and #2265 with written reasons. `origin/development` is now newer
  than the initial Track 1 base; rebase this branch only after concurrent
  Muse edits are safely checkpointed.
- 2026-09-25: Completed #2337's 48-turn/year frequency audit and fixed
  1/12/48/240-turn calibration fixtures. Focused suite: 77 passing. Posted
  evidence on #2337 and labeled it `status: partial` pending the final pass.
- 2026-09-25: Removed six clean, zero-unique ops worktrees and eight superseded
  AHDGame Muse worktrees after individual clean checks. The latter include
  #1975 and #2059 dirty copies whose uncommitted contents were verified
  redundant before discard. No force removal or locked worktree mutation.
- 2026-09-25: Integrated the unique report from one detached research
  checkout before removing it, and deleted one orphaned build-artifact
  directory after confirming it held no source. These are separate from the
  eight superseded Muse checkouts above.
- 2026-09-25: Rechecked #2078's already-merged transfer detector with 42
  passing targeted tests. Posted implementation evidence on the issue and
  labeled it `status: partial`; its corrected six-turn sandbox precision
  remains an explicit gate in the first qualification world.
- 2026-09-25: Preserved the unique #2087-#2089 investigation report from a
  detached research checkout in commit `9a082b5c3e`; the report explicitly
  distinguishes inspected source facts from sandbox observations not rerun.
- 2026-09-25: Actual Muse Spark 1.3 contributors implemented preliminary
  2027 euro seed repair and corporation UI fixes. Focused euro-rule and Build
  Org suites passed 20 tests together. Follow-up Muse work is completing
  runtime forex mirroring, conformance tests, and corporation regressions.
  The focused eight-suite checkpoint passed 72 tests, with scoped ESLint
  reporting no errors. #2291 and #2349 remain partial for the explicit
  completion boundaries below.

### #2291 completion boundary

The current euro patch is a partial implementation. Issue #2291 requires
EUR across 2027 budgets, central banks, corporations, balances, bonds,
exchange rates, and transaction records, plus conservation and a conformance
failure on any legacy row. The branch still has era-blind
`COUNTRY_CURRENCY_MAP` uses in seed-generated sovereign issuers
(`src/lib/seeds/reference/budgets.ts`) and money operations. Test and resolve
those paths before marking #2291 ready. A passing rule helper suite alone is
insufficient evidence.

- 2026-09-25: Merged green a-house-divided dependency PRs #4441 and #4440
  into that repository's `master`. Closed superseded ops PRs #4, #34, and
  #43 with written reasons and deleted their remote branches. No locked or
  uncommitted checkout was removed for these decisions.
- 2026-09-25: Committed corporation wiki claim scoping and published-page
  checks, Build Org preview eligibility, and a defensive corporation-page
  bond-holder guard in `a9b278a3ce`. The live #2349 exception has sanitized
  GlitchTip evidence but no source-map-confirmed root cause, so it stays
  partial. Committed the partial 2027 euro repair in `a635fea5f2`; #2291
  remains partial pending all currency-bearing seed and runtime paths.

- 2026-09-25: Preserved 158 real source/test/report changes from the formerly
  dirty, now clean `worldsim-readiness-20260922` checkout as
  `afcb2681a6cd6366fb107d720cba9e31d64d214f`. This checkpoint contains
  1991 successor substrate, 2027 region/currency work, sim report changes,
  and game-health evidence. At that checkpoint it was not yet integrated or
  validated; integration and focused repair are recorded below.
  A literal local connection string was removed from the handoff note before
  the final checkpoint commit was retained.
- 2026-09-25: The first scheduled Track 1 typecheck ended by SIGTERM (`-15`)
  without TypeScript diagnostics while concurrent Muse edits were underway.
  It is neither a pass nor a source failure. Repeat from a stable source
  checkpoint after integration.

- 2026-09-25: A Muse Spark 1.3 #2291 follow-up wrote additional 2027
  sovereign/bond/national-corporation currency code and tests, then its
  provider stream failed after three network retries. The eight edited files
  passed `git diff --check` and were preserved as partial checkpoint
  `14864d52ed`. They have not passed the intended focused tests or final
  conformance, so #2291 remains open. Resume from this checkpoint.

### Current source checkpoint

The original fresh base is recorded above. Track 1 was rebased onto
`cc06acd25cf259f9f9ede8076ac57552867ebae8` after PR #2382. The preserved
1991/2027 source checkpoint was integrated as `609cf2bd7d`; the four observed
TypeScript defects were repaired in `9c23912f6f` and `c065c18730`. A Muse
Spark 1.3 contributor fixed RU owned producing SOEs in 1991 as `7e30f53bb6`
with four focused tests passing. The later integrated `npm run typecheck` on
checkpoint `aef40e9ce4` passed after the two Watchlist test fixture response
types were corrected. This pass includes the production ticket route backport
and receipt scan index; repeat after subsequent 2027 and #1672 edits. No fresh
zero-critical 1991 bootstrap or #2316 scripts/sim balance report exists yet.

The #1672 keyed standalone-Mongo money-flow primitive and indexes were ported
as `8949c9da39` with 13 focused tests passing. Its source branch remains
partial; consumers are being extracted and verified in bounded slices. #1672
and ledger RR-014 remain open. A 2027 ACS education/income projection waiver
was approved by the owner and recorded in RR-062, while 2027 implementation
and final evidence stay open.

Share-fill slice 1 landed as `325854f8c4`, `fdc2c6285b`, `e0657502a4`,
and `a1ecae6951`. The three focused audit/fill suites passed 45/45 after
the latest development merge. This checkpoint adds a keyed audit plan,
conditional claim and a bounded once-per-turn orphan scan; keyed money legs,
matcher settlement, cancel refunds and later #1672 source slices remain
required. The exact integrated typecheck, turn-path round-trip profile and
full gates remain open. The source `muse-1672` checkout stays read-only until
every unique slice has a disposition.

A read-only Muse Spark 1.3 audit classified all 55 commits of the preserved
`muse-1672` source by diff. Its commit-by-commit disposition and seven ordered
extraction slices are in `TRACK1_1672_SOURCE_AUDIT.txt`. The bond-sale slice is
superseded by merged #2288; forex turn fills remain with merged #2286; queued
fund redemptions remain with the verified Track 1 journal. The remaining
unique share, bond, fund/pension, forex-route, and small-spend slices still
require extraction, conflict reconciliation, and tests. Keep the clean source
checkout as a read-only reference until every slice is accounted for. The
audit identified a correctness risk in the primitive's 100-key eviction:
after heavy use, a delayed retry could apply an evicted key again. Track 1
removed that eviction and added a heavy-history retry regression; account
document-size monitoring remains a #1672 retention gate.

Additional PR dispositions since the initial inventory: #2379 and #2382
merged to `development`; #2385 merged at
`2f52a77d63abdfadc34dd2c5b5cb4f02fd976a84`. The clean Track 3 source,
short-turn candidate, and two Campaign 3 snapshot worktrees were removed with
ordinary `git worktree remove`. The 11 remaining legacy private game repo
Dependabot PRs were closed as abandoned with individual explanations. Bot
upstream #45 and #122 both merged after their exact-head gates. Ops #137 and
#168 merged; #167 closed as superseded. See the inventory
for each decision and the current open PRs.

**Upstream refresh completed, 2026-09-25:** The five production
fund-performance source commits have been selectively integrated into Track 1
as `a8298fe1a6`, `cb7e61920d`, `a1e4a8d7d3`, `4539de1277`, and
`66b0b0debe`, with focused repair commits `e813f4eab6` and `4d1b25ceac`.
Forty-nine focused tests, scoped lint, formatting, and diff checks passed.
The new development head `1919657c625cf5582034f3506357dedfda8e7fe9`
was then merged as `f2ba89a6ccfbaacb0bb60fd0e0de783487a96eb2`. The
original fresh base remains `028cb9265e`. The integrated typecheck passed
at `aef40e9ce4`; a final post-change typecheck, `verify`, build, turn
profiling, and the final campaign are still owed.
