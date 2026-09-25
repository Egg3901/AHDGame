# Dead weight plan: audited execution plan

Status: execution in progress · 2026-09-25. This file supersedes and expands an earlier
untracked first-pass audit that occupied this path.

Sources:

- [Operations report](https://ops.lakesidegames.net/reports/dead-weight-plan-1)
  ("the report", 2026-09-24): the 11-stream consolidation blueprint under audit.
- The 2026-09-18 turn performance plan ("the earlier plan"), a local
  `docs/plans/` document (`docs/` is gitignored local-only in this repo):
  partially superseded; used as historical evidence only.
- This checkout: every code fact below was re-verified on `development` at
  commit `028cb9265e` (2026-09-24).

This document authorizes no data deletion and changes no game rules. It is an
execution plan; each work package lists its own gates. The execution record is
in §8.

## Evidence classes

Every claim below carries one of four classes. Mixing them is the original
report's core defect; this plan keeps them separate.

- **[measured]** observed telemetry, with source, window, and caveats named.
- **[code]** static fact of the repository at the pinned commit. Verifiable by
  reading the file; does not by itself prove a runtime cost.
- **[hypothesis]** a plausible mechanism not yet demonstrated.
- **[target]** a desired end state. Never evidence.

## 1. Verdict

The report is a useful inventory of consolidation seams but is not yet an
executable production plan. It combines measured values, budgets, guesses, and
targets without distinguishing them, and its headline outcomes (84% turn-time
reduction, 217→32 phases, ~2,500 commands, <3 GB compiler heap) have no
attributable model. Its largest proposed change - collapsing the phase registry

- is an architectural proxy, not a player or operational outcome.

The executable strategy is unchanged from the first audit: reduce measured work
inside existing phase boundaries first, then consolidate only where a seam
table demonstrates a shared rules model, compatible cadence, and a migration
that preserves persistent player state.

## 2. Corrections to the published report

Re-verified at `028cb9265e`. "Report claim" quotes the operations page; "audit
finding" is what the repository or telemetry actually shows.

| Report claim                                                                               | Audit finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Required correction                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Turn 960 failed at 204.9 s against a "hard 240 s ceiling"; p95 191.5 s leaves 20% headroom | `PHASE_TIMEOUT_MS = 4 * 60 * 1000` is a **per-phase** timeout (`src/lib/turn/processingLock.ts:23`), applied per phase in `turnPhaseRuntime.ts` (~line 233). Turn 960 recorded 232 completed and 7 skipped phases, none incomplete, plus 9 warnings. At that date `turnLogs.success` was `warnings.length === 0`; PR #2281 fixed this on 2026-09-21. The false `success` value was warning semantics, with no evidence of a timeout. [code] + [measured]                                                                                                                                                                                                            | Classify turn 960 as completed with warnings. Define a separate whole-turn SLO, per-phase timeout, and lock-staleness semantics.    |
| 217 registered phases = 154 base + 63 country election phases                              | `BASE_TURN_PHASE_NAMES` has **140** entries (`turnPhaseNames.ts`); `COUNTRY_ELECTION_PHASE_NAMES` has **58** (`countryElectionPhaseNames.ts`). These are progress-name registries, not a count of executed work: country election phases only run for countries returned by `getRegisteredCountryIds`, are suppressed during founding (`foundingActive`), several phases are cadence-gated, and singleplayer skips a denylist. [code]                                                                                                                                                                                                                               | Recount at a pinned commit; report registered, eligible, executed, and skipped counts separately per turn type.                     |
| "Fiscal Year Phase: 7,000 round trips"                                                     | `turnPhaseBudgets.ts` sets `fiscalYear: 7000` as a **warning budget**. The earlier plan's measured median is 3,389 trips on n=2 fiscal-year turns. [code] + [measured, stale]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Label budgets as budgets; re-measure the phase on current code.                                                                     |
| NPP behavior fixed by "a single projected `$in` read"                                      | The per-candidate `findOne({ceoId})` was already batched (`cc2148d36d`, PR #2312). `nppActionProcessing` runs every 4th turn (`ACTION_PROCESSING_INTERVAL = 4`, `src/lib/turn/nppActionProcessing.ts:77`) and its remaining trips live in the guarded per-NPP command cores under `src/lib/nppAutonomy/v3/finance/` (`nppBonds.ts`, `nppShares.ts`, `nppFoundCorporation.ts`), which write through `findOneAndUpdate` guards. [code]                                                                                                                                                                                                                                | Scope remaining work per command core; a batch must not replace a balance guard with a blind `$inc`.                                |
| Pruning dead candidates takes `voteAccumulation` from 8.1 s to <1 s                        | `staleCandidateCleanup` already runs every turn and marks candidates of completed elections `status: "withdrawn"` (`cleanupStaleElectionCandidates`, `src/lib/turn/perpetualElections/engine.ts:927`) - it does not delete them. `electionCandidates` rows do accumulate, but no experiment links row count to the phase's p95, and historical tallies/results readers use these rows. [code]                                                                                                                                                                                                                                                                       | Measure the phase's query shape and index use first; define a retention contract for candidate rows before any deletion.            |
| "14 snapshot tables grow with zero TTL"                                                    | At least 12 snapshot collections are written in code (`moneySupplySnapshots`, `primarySnapshots`, `tradeFlowSnapshots`, `federalBudgetSnapshots`, `stockExchangeSnapshots`, `investorRankingSnapshots`, `gameHealthSnapshots`, `wealthListSnapshots`, `indexFundSnapshots`, `electionResultSnapshots`, `equityLiquidityFacilitySnapshots`, `balanceSnapshots`). `gameHealthSnapshots` already has a 30-day TTL (`observability.ts`); `activityLog`, `auditAnomalies`, `actionAuditLog`, `financialTxLog`, `apiAccess`, `identityHistory`, `siteTrafficPageviews` also carry TTL or expiry semantics. Several snapshot collections have no index file at all. [code] | Inventory retention per collection (writer, readers, restore needs) before any blanket TTL.                                         |
| Delete all 30 heal routes after adding transactions                                        | There are **34** heal routes, ~6,557 LOC: 28 `route.ts` under `src/app/api/admin/heal/` plus `heal-cross-country`, `heal-captured-unowned`, `heal-orphan-tallies`, `heal-withdrawn-tallies`, `heal-senate`, `uk/government/heal`. The report undercounts both routes and LOC. Transactions do not fix bad inputs, legacy data, or multi-step idempotency. [code]                                                                                                                                                                                                                                                                                                    | Per-route incident audit; fix root causes; prove a route obsolete before removing it individually.                                  |
| 21,892 commands and 209.1 MB BSON are a production baseline                                | The earlier plan attributes both to **one local sandbox turn under `tsx`** (`perf_profile_scratch`, turn 122); production `turnLogs` supplied timing only. The tsx run includes ~21 s of transpilation and counts driver commands, not just queries. [measured, mislabeled]                                                                                                                                                                                                                                                                                                                                                                                         | Publish provenance per figure (world, turn, commit, profiler mode). Re-measure on current code before calling any of it a baseline. |
| 84% turn-time reduction, 32-phase target, <3 GB heap                                       | No per-stream additive model, compiler profile, or capacity model supports these. Stream savings overlap (streams 4, 5, 6, 7 all claim parts of the same turn). [target]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Treat as hypotheses until matched-world measurement; do not put them in commitments or the PR checklist.                            |
| Parallel `billDiscussion` vs `stateBillDiscussion` collections (stream 3)                  | Already unified: a single `billDiscussions` collection keyed by `billScope: "national" \| "state"` (`src/lib/db/types/billDiscussion.ts`, `src/lib/legislature/discussions/`). [code]                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Drop the collection merge from stream 3; the engine duality (`engine.ts` / `regionalEngine.ts`) still stands.                       |
| `corporation/` vs `corporations/` split, ">180 files" (stream 6)                           | `src/lib/corporation/` holds exactly 2 residual files (`dividendIncomeFromHistory.ts`, `previewQuickDissolve.ts`); `src/lib/corporations/` holds ~215 entries. The split is real but trivially small. [code]                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fold the 2-file residue into `corporations/` as cleanup; do not present it as a major merge.                                        |
| Per-turn unprojected `characters` load (earlier plan §3.2)                                 | Fixed: `turnExecutionContext.ts` (~line 74) reads `characters` with an explicit projection ("Turn-init projections (#2166)"). [code]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mark landed; do not re-plan it.                                                                                                     |
| "8,192 MB TypeScript compiler heap"                                                        | `package.json` pins `node --max-old-space-size=8192` for `typecheck` - a configured ceiling, not a measured usage figure. [code]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Measure actual tsc RSS before setting a target; treat <3 GB as unattributed until then.                                             |

### Structural facts the report never mentions

These change what is safe to build, and all are [code] at `028cb9265e`:

- **Interrupted-turn recovery already exists.** `turnPhaseRuntime.ts` resume
  gate: a re-entered turn skips every phase recorded complete **plus** the one
  in flight when the process died (`alreadyApplied`, skip reason
  `upstreamAbort`). Before it existed, a redeploy mid-turn consumed the rest of
  the turn. Consolidation must preserve per-phase idempotency or extend this
  gate, not bypass it.
- **Phase ordering is deliberate.** `turnPhaseRegistry.ts` documents ordering
  constraints (e.g. "Group 7 is strictly sequential. Reordering any of these
  steps corrupts…") and RNG draw ordering. Merging phases changes draw order
  unless the rng is re-keyed.
- **Settlement recovery machinery exists.** `src/lib/banking/settlementJournal.ts`
  and `recovery.ts` journal and resume interrupted banking settlements; banking
  batching must integrate with it, not route around it.
- **Singleplayer/headless gating exists.** `SINGLEPLAYER_SKIP_PHASES` denies
  `financialSuspectScan`, `auditAnomalyScan`, `suspiciousDetection`,
  `gameHealthSnapshot` in singleplayer; `runPhase` also honors a
  `simElectionsOnly` profile gate. New cross-player work should register its
  skip predicate at creation.
- **`shareOrders` has a seed gap for its fund-bid index.** The index-fund bid sweep filters
  `{ placerFundId, type: "buy", status: "open" }` twice per fund
  (`fundCron.ts` ~lines 783, 822). The one-off migration
  `2026-08-10-index-fund-phase-indexes` creates
  `share_orders_fund_open_bids` on `{ placerFundId: 1, type: 1, status: 1 }`.
  Production `explain(queryPlanner)` confirmed an `IXSCAN` on that index.
  The recurring index seed omitted it, so reset worlds can lose it when
  migration markers survive. [code] + [measured]
- **Country election phases are gated, not global.** They run only for
  `getRegisteredCountryIds` output and are suppressed during founding, so "58
  phases run every turn" is false; the true per-turn count is smaller and
  world-dependent. [code]

## 3. What the 11 streams omit

Keeping the first audit's list, sharpened with current evidence:

1. **`corporationTurn` as a first-class target.** 23.2 s median / 2,420 trips
   in the earlier production sample [measured, stale]; still per-row in
   `buildLookups.ts`, `shareListings.ts`, `shareOrders.ts`, `voteReminders.ts`
   [code]. The report's streams mention it only inside stream 6's finance
   bucket.
2. **CPU-bound phases.** `bondTurn`, `commodityPrices`,
   `stockExchangeSnapshot`, `financialSuspectScan`, `auditAnomalyScan` have few
   trips relative to their seconds [measured, stale]. Round-trip consolidation
   cannot fix them; they need CPU profiles.
3. **BSON decode and document shape.** The sandbox profile puts decode + GC at
   ~23% of turn CPU, spread across the turn [measured, local]. `npps` and
   `corporateSectors` are the fat collections; `corporateSectors` alone was
   ~45 MB across ~6 reads in one profiled turn.
4. **Market settlement ordering.** Index-fund clearing, share-order
   settlement, and NPP financial commands share guarded writes on live
   balances. Batching changes which orders fill and in what sequence - a
   gameplay-visible outcome, not just a perf change.
5. **Interrupted-turn recovery and idempotency.** See §2 structural facts.
   Every consolidation PR must state what a mid-phase kill leaves behind and
   what resume does.
6. **Multiplayer vs singleplayer/headless cost models.** MP turn time is
   round trips × remote latency; SP/headless is CPU + BSON decode. A change
   that wins in one host can be neutral in the other; report both.
7. **Schema and API consumers.** Every proposed merge needs a reader/writer
   inventory spanning turn code, admin tools, seeds, migrations, public API,
   and history/wiki surfaces - `electionCandidates` alone is referenced in
   ~270 files [code].
8. **Index design and data lifecycle.** Collection counts say nothing about
   query cost. Several snapshot collections have no index file at all;
   `shareOrders` has a migration-created `placerFundId` index but its seed path
   lacked that index; `turnLogs` has query indexes but no TTL in this checkout.
9. **The compiler heap and route-sprawl streams are maintainability work.**
   Keep them as independent tracks; they do not belong in the turn-latency
   savings total.

## 4. Work packages

Each package is independently shippable and independently revertible. Order
within a package is dependency order; packages are sequenced in §5.

### WP0 - Trustworthy baseline and service targets

- **Problem (high confidence):** every downstream decision keys off numbers
  whose provenance is mixed (production timings vs local command counts vs
  budgets vs targets). [measured]+[code]
- **Surface:** `scripts/perf/one-turn.ts`, `scripts/perf/trace-callsites.ts`,
  `src/simulation/engine/turnPhaseBudgets.ts`, `turnPhaseRuntime.ts` telemetry,
  `turnLogs`, turndiag MCP.
- **Smallest useful steps:**
  1. Re-run `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts` on
     a seeded world matched to production shape at the pinned commit; record
     per-phase trips/documents/bytes, marking the `tsx` warm-up artifact.
  2. Pull production per-phase p50/p95/max and trips for a 60+ turn window;
     record fiscal-year and election turns separately (they are different
     workloads).
  3. Reconcile `turnPhaseBudgets.ts` against the measured distribution:
     raise budgets that are structurally exceeded (e.g. `indexFunds`,
     `bankingTurn` over on every sampled turn in the old data) in the same PR
     as the measurement, so the warning means something again.
  4. Write per-deployment targets explicitly: MP turn p95 and phase-timeout
     rate; SP/headless CPU and bytes per turn; sim turns/night. Each target
     gets an owner and a stated model, or it is labeled provisional.
  5. Optional follow-on: the earlier plan's `turnPhaseStats` rollup and CI
     round-trip gate remain unlanded; either land them or explicitly drop them.
- **Correctness risks:** none (read-only measurement + warning thresholds).
  Do not let a "budget fix" PR quietly change phase behavior.
- **Measurement & acceptance:** a published baseline table with provenance
  columns (world, commit, window, profiler mode); budgets within ~1.5× of
  measured p95 for every phase; zero phases permanently over budget without a
  linked issue.
- **Rollout/rollback:** docs-and-thresholds only; rollback = revert.

### WP1 - `indexFunds` batching (largest measured round-trip lever)

- **Problem (high):** 5,373 trips/turn median, over its 3,000 budget on every
  sampled turn [measured, stale]. Code at the pinned commit still shows the
  pattern: `getFundById` re-reads inside loops (`fundCron.ts` ~735, 924, 933,
  1008, 1147, 1162, 1802), two identical open-bid scans per fund filtered on
  `placerFundId` (~783, 822). `refreshEquityLiquidityFacility` appears in two
  mutually exclusive branches (disabled cleanup or enabled quotes), so it runs
  once per turn [code].
- **Surface:** `src/lib/indexFunds/fundCron.ts` (passes 1, 3, 3c, step 8),
  `equityLiquidityFacility.ts`; collections `indexFunds`, `shareOrders`,
  `indexFundTransactions`, `indexFundSnapshots`; guarded balance writes in
  `fundCron.ts` (~253, ~942).
- **Smallest useful steps:**
  1. Seed the migration-created `{placerFundId: 1, type: 1, status: 1}`
     `shareOrders` index with its existing name and sparse option, so a reset
     world retains it. Production already uses it; do not count this as a
     production turn-time win.
  2. One `find({_id: {$in: fundIds}})` per pass; carry the fund document
     through the sell loop instead of re-reading.
  3. Evaluate the second open-bid scan only after proving the concurrency
     contract: it currently sees bids placed or filled while cancellations
     run, which a stale in-memory set would miss.
  4. `bulkWrite` NAV/status/holdings updates; `insertMany` per-fund snapshots.
  5. Assess gating `refreshEquityLiquidityFacility` (and any pure repricing) to the
     daily cross-fund cadence instead of every turn - but only after
     confirming the quote cadence is not load-bearing for same-turn
     settlement.
- **Correctness risks:** guarded debits (`findOneAndUpdate` on cash/float)
  must remain atomic per leg; order-book semantics (which bids cancel, which
  fill, in what sequence) must be unchanged; redeem-before-rebalance ordering
  is load-bearing.
- **Measurement & acceptance:** before/after on the same seed: trips,
  documents, bytes for the phase (old-plan target <1,000 trips is plausible
  but re-derive it); golden replay diff identical; index confirmed via
  `explain()` on the bid query.
- **Rollout/rollback:** no schema change except the additive index; rollback
  = revert. Index build on a 294 k collection is safe online but schedule it
  with the deploy, not mid-turn.

### WP2 - `corporationTurn` read batching

- **Problem (high):** 23.2 s median / 2,420 trips [measured, stale]. A local
  phase trace found 558 `tariffs` commands inside signed-bill reconciliation
  on a turn with 276 tariff provisions. Per-row helpers also remain in
  `src/lib/turn/corporation/` support modules (`buildLookups.ts`,
  `shareListings.ts`, `shareOrders.ts`, `voteReminders.ts`) [code], but the
  watched support reads did not show a comparable per-sector query loop.
- **Surface:** `src/lib/turn/corporation/*`, `corporateSectors`,
  `corporations`, `shareListings`, `shareOrders`, state-metric margin modifier.
- **Smallest useful steps:** replay signed non-economy tariff provisions with
  one ordered bulk write while retaining economy-wide budget sync; collect
  remaining ids once per turn → projected `$in` reads → per-turn lookup maps
  passed into `sectorTurn`; memoize the state-metric margin modifier; keep
  write order identical.
- **Correctness risks:** same-turn write-then-read inside the loop (a sector's
  own update must be visible to later legs in the same turn - check whether
  any helper re-reads what an earlier leg wrote); guarded float/ownership
  updates stay atomic.
- **Measurement & acceptance:** trips/documents/bytes delta on matched world;
  state diff identical on replay; production canary p95 for the phase.
- **Rollout/rollback:** revert. No schema change.

### WP3 - `nppActionProcessing` command cores

- **Problem (medium-high):** 7,457 trips on the turns it runs (every 4th)
  [measured, stale]. The simple N+1 is already fixed; the residual is ~4-5
  trips per invocation inside `src/lib/nppAutonomy/v3/finance/` command cores
  (`nppBonds.ts`, `nppShares.ts`, `nppFoundCorporation.ts`), each a `findOne`
  plus a guarded `findOneAndUpdate` plus an `updateOne` [code].
- **Surface:** the three finance cores + their call sites in
  `nppActionProcessing.ts` sweeps; collections `npps`, `bonds`,
  `corporations`, `shareOrders`.
- **Smallest useful steps:**
  1. `TRACE_COLLECTIONS=npps,bonds,corporations` on a profiled turn to
     attribute trips to call sites before touching code.
  2. Preload the per-NPP documents the cores `findOne` (funds, holdings) in
     one `$in`, pass them in, and keep the guarded write as the only
     per-entity trip.
  3. Do not merge the guard and the effect write into one blind `bulkWrite`.
- **Correctness risks:** the `findOneAndUpdate` guard is the atomicity boundary
  (deduct funds first, then allocate); weakening it double-spends NPP funds
  under any retry or concurrency.
- **Measurement & acceptance:** per-callsite trip attribution in the PR;
  phase trips on action turns before/after; replay-identical outcomes.
- **Rollout/rollback:** revert. No schema change.

### WP4 - `bankingTurn`, `voteAccumulation`, `recomputeSharePrices`, NPP support phases

- **Problem (medium):** `bankingTurn` over budget on every sampled turn
  (904/500); `voteAccumulation` spiky (1.4 s median / 13.8 s p95 / 4,497
  trips); `recomputeSharePrices` 519/500; `nppUnionBehavior` 1,191;
  `nppBehavior`, `nppBillSponsorship` elevated [measured, stale].
- **Surface:** `src/lib/turn/bankingTurn.ts` + `src/lib/banking/`
  (`settlementJournal.ts`, `recovery.ts`); `voteAccumulation` path -
  `src/lib/turn/voteAccumulationPreload.ts` already hydrates candidates,
  characters, NPPs, orgs, endorsements in batch; `tallyManagement` readers of
  `electionCandidates`.
- **Smallest useful steps:** per phase, attribute trips first
  (`TRACE_COLLECTIONS`), then apply collect→`$in`→`bulkWrite`; for
  `voteAccumulation`, finish passing tallies forward rather than re-reading
  per election; check `electionCandidates` query shapes and index coverage
  (status + electionId) before believing the candidate-count hypothesis.
- **Correctness risks:** banking writes interlock with the settlement journal
  and recovery path - batching must keep journal entries truthful on partial
  failure; vote tallies feed historical results pages, so preload changes must
  not drop fields that readers use.
- **Measurement & acceptance:** per-phase trips/documents/bytes; spike-turn
  (election day, fiscal boundary) coverage in replay; journal/resume tests
  keep passing.
- **Rollout/rollback:** revert. No schema change.

### WP5 - CPU-bound phases: `bondTurn`, `commodityPrices`, `stockExchangeSnapshot`, anti-abuse scans

- **Problem (medium):** seconds high, trips low (`bondTurn` 8.6 s/559,
  `commodityPrices` 5.5 s/133, `stockExchangeSnapshot` 4.4 s/49,
  `financialSuspectScan` 7.8 s/160, `auditAnomalyScan` 4.0 s/85)
  [measured, stale]. The sandbox profile shows no single hot loop; cost is
  per-document decode + spread app code [measured, local].
- **Surface:** `src/lib/turn/bondTurn*.ts`, `src/lib/turn/commodity/*`,
  snapshot writers, `financialSuspectScan`/`auditAnomalyScan`/`suspiciousDetection`.
- **Smallest useful steps:**
  1. `--profile out.cpuprofile` per phase on a matched world; attribute to
     decode vs algorithm before writing code.
  2. Typical fixes once attributed: tighter projections, avoid
     `JSON.parse(JSON.stringify())` clones and full-array sorts per entity,
     push reducers into `aggregate()` where the result is scalars.
  3. Confirm the anti-abuse scans skip in SP (`SINGLEPLAYER_SKIP_PHASES`)
     and headless sim profiles; extend the denylist entry pattern to any new
     cross-player scan.
- **Correctness risks:** settlement math unchanged (these are pricing/
  detection paths); snapshot shape changes break history readers - version
  the payload or keep the schema.
- **Measurement & acceptance:** CPU seconds per phase on the same world
  (profile, not wall clock); documents/bytes decoded per phase; identical
  outputs on replay.
- **Rollout/rollback:** revert.

### WP6 - BSON decode: document shape, not query count

- **Problem (medium):** ~16% decode + ~7% GC of sampled CPU, diffuse
  [measured, local]. `npps` carries ~30 KB `policies.domainPositions` that
  most phases never use; `corporateSectors` is read ~6×/turn (~45 MB) by
  different phases [measured, local].
- **Surface:** `npps` schema + every turn reader; `corporateSectors` readers
  (`corporationTurn`, `recomputeSharePrices`, `fiscalBaseGrowth`,
  `economicVitalSigns`, `stockExchangeSnapshot`, `nppCorporateAttacks`);
  `turnReadProjections.test.ts` guard.
- **Smallest useful steps:**
  1. Inventory which phases need `policies.domainPositions` (voting/bill
     phases) vs which only need scalars; extend projections.
  2. For `corporateSectors`: evaluate one projected per-turn read handed to
     phases vs six independent projected reads - the right answer depends on
     whether phases need post-write freshness, so measure, don't assume.
  3. The `nppPolicies` collection split (earlier plan §3.1) is a schema
     change: needs an issue + migration plan, and is only worth it if
     projections can't get the same bytes off the wire.
- **Correctness risks:** splitting NPP stances touches `src/lib/db/types` and
  every reader; a missed reader silently votes with empty stances. Full
  reader/writer inventory is the gate.
- **Measurement & acceptance:** bytes/documents per phase; sim turns/hour;
  replay-identical outcomes; migration dry-run counts match.
- **Rollout/rollback:** projection-only changes = revert. The stance split
  needs the WP9 migration machinery.

### WP7 - Data lifecycle: per-collection retention inventory

- **Problem (medium):** snapshot/history collections grow without a uniform
  policy; some already have TTL (`gameHealthSnapshots` 30 d), most have none,
  some have no index file at all [code]. The report's blanket "90-day TTL on
  snapshots" would destroy history surfaces that readers expect.
- **Surface:** the ~12 snapshot collections (§2), `turnLogs`, `activityLog`,
  `actionAuditLog`, `financialTxLog`, `electionCandidates`, plus any
  `*History`/`*Log` collection; readers: admin health pages, wiki/history
  surfaces, public API, heal routes.
- **Smallest useful steps:**
  1. Build the inventory table: collection → writer → readers → current
     indexes/TTL → growth rate (prod count over 30 d) → restore requirement.
  2. Per collection, choose: TTL, turn-bounded prune, archive-then-delete, or
     keep-forever. Record the decision in the index file comment.
  3. Add the missing index files (several snapshot collections have none) -
     queries exist regardless of retention.
- **Correctness risks:** TTL is irreversible expiry; `electionCandidates` and
  election result snapshots back historical result pages; `turnLogs` backs
  turndiag and recovery forensics.
- **Measurement & acceptance:** inventory table in the PR; per-collection
  policy applied one per PR; prod doc-count trend after deploy.
- **Rollout/rollback:** TTL rollout is one-way for expired data - gate each
  TTL on an explicit retention contract; prefer archive-first for anything
  player-visible.

### WP8 - `electionCandidates` lifecycle

- **Problem (medium):** rows accumulate (report claims 11,462 dead; count
  unverified from repo); `staleCandidateCleanup` already withdraws them but
  never deletes [code]. Whether they drive `voteAccumulation` cost is
  [hypothesis] until query shape and indexes are measured.
- **Surface:** `electionCandidates` (~270 referencing files), `elections`,
  `tallyManagement`, `voteAccumulationPreload.ts`, history/result readers,
  `cleanupStaleElectionCandidates`.
- **Smallest useful steps:**
  1. Measure: count by status, query shapes on the vote path, `explain()`.
  2. If rows are the cost: define an archival contract (which fields history
     needs → archive collection or keep-with-status), extend cleanup to
     archive instead of only withdraw.
  3. If the cost is unindexed scans: fix the index, keep the rows.
- **Correctness risks:** historical tallies, result snapshots, and
  "past elections" UI read candidate rows; deleting them rewrites history.
- **Measurement & acceptance:** before/after query plans; phase p95 on
  election turns; zero broken history links.
- **Rollout/rollback:** archive-then-delete with a restore path; never
  delete-first.

### WP9 - Recovery, idempotency, and failure injection

- **Problem (medium):** the resume gate (`alreadyApplied`/`upstreamAbort`)
  exists, but consolidation changes write granularity: a merged phase that
  dies mid-way has partial state the resume gate cannot subdivide [code].
- **Surface:** `turnPhaseRuntime.ts`, `processingLock.ts`,
  `banking/settlementJournal.ts`, `recovery.ts`, `atomicClaim.ts`.
- **Smallest useful steps:**
  1. For each touched phase, document the mid-phase-kill state and the resume
     behavior in the phase file.
  2. Failure-injection test per consolidated phase: kill between legs, resume,
     assert no double-apply (the banking retry integration tests are the
     pattern).
  3. Where a merged phase spans previously separate phases, either keep
     per-step journals or record sub-phase progress so resume is precise.
- **Correctness risks:** double-applied writes are player-money bugs; this is
  the highest-blast-radius package in the plan.
- **Measurement & acceptance:** fault-injection tests green; a rehearsed
  resume on a restored world.
- **Rollout/rollback:** gates all consolidation merges; not optional.

### WP10 - The 11 streams, gated by seam tables

- **Problem (medium):** the streams mix four different decisions - share
  **rules**, share **orchestration** (phase merges), share **storage**
  (collection merges), share **routes** - as if they were one. Each needs its
  own evidence.
- **Gate per stream:** publish a seam table (document owners, writers,
  readers, invariants, phase ordering, cadence, rules host, migration need,
  measured cost) before any merge. Then decide each of the four axes
  independently. Current per-stream audit notes:

| Stream                      | Audit status at `028cb9265e`                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Subnational budgets      | Premise confirmed: `federalBudget`, `regionalBudgets`, `stateBudgets`, `ukBudgets` are four real collections; `regionalBudgetCadence.ts` exists. A merge is a schema change (issue + migration plan); the cadence hack is load-bearing until the merged phase is proven faster. |
| 2. Monetary/FOMC            | All 7 directories exist (`centralBank`, `monetary`, `monetaryGovernance`, `monetaryPolicy`, `moneySupply`, `currency`, `forex`). Committee timing (FOMC cadence) changes outcomes - pure-rules sharing must preserve per-committee calendars.                                   |
| 3. Legislative engines      | `engine.ts`/`regionalEngine.ts` duality real; `billDiscussions` already unified - drop that claim. National/regional scope merge needs a `bills`/`stateBills` reader inventory first.                                                                                           |
| 4. Elections                | 58 phase names, not 63; gated per registered country. `electionCandidates` lifecycle is WP8, not a phase merge. "Collapse to 1 phase" needs per-system (FPTP/PR/STV/EC) rules parity proven first.                                                                              |
| 5. Decay vectorization      | Plausible but unmeasured; decay phases share RNG draw order - merging changes outcomes unless draws are re-keyed per entity. Measure the actual trip cost of each decay phase first; several may be near-free already.                                                          |
| 6. Banking/funds            | The indexFunds part is WP1; the phase merge is separable and lower value. `corporation/` residue is 2 files.                                                                                                                                                                    |
| 7. NPP engines              | Covered by WP3. "10,000 queries" conflates all `npp*` phases; attribute per phase before merging.                                                                                                                                                                               |
| 8. Military/conflicts       | Directory sprawl real (`military`, `navair`, `livingConflict`, `coldwar`); template-driven scenarios are a design decision needing an issue, not a refactor. Ordering: naval/air state before battle resolution is load-bearing.                                                |
| 9. Metrics merge            | `stateMetrics`, `politicalMetrics`, `macroMetrics`, `nationalMetrics` all in live use (43-162 referencing files). Prove identical semantics + query shape before merging storage; sharing rules is cheaper.                                                                     |
| 10. Telemetry + heal routes | See WP7 and WP11.                                                                                                                                                                                                                                                               |
| 11. Country islands         | `src/lib/uk/` and `src/app/uk/` exist; generalization is a mechanics-design decision (issue required). Other countries' bespoke phases need the same seam treatment.                                                                                                            |

- **Measurement & acceptance:** a seam table per stream is the deliverable;
  a merge proceeds only when its row is complete and the migration plan (WP9
  machinery) exists.
- **Rollout/rollback:** per-stream, behind the migration pattern below.

### WP11 - Heal-route retirement pipeline

- **Problem (medium):** 34 heal routes / ~6,557 LOC [code]. Each exists
  because something wrote bad state once. The report's "delete all after
  transactions" skips the incident analysis.
- **Surface:** `src/app/api/admin/heal/*` (28) + 6 heal routes elsewhere;
  the writers that created the corruption each repairs.
- **Smallest useful steps:**
  1. Per route: which incident created it, is the root cause fixed, when did
     it last run, does anything still call it.
  2. Fix root causes first (guarded writes, journals, invariants).
  3. Remove a route only after it is provably unused and unrepaired cases are
     resolved; keep the audit trail of what it fixed.
- **Correctness risks:** removing a still-needed repair path leaves the next
  corruption unfixable without a deploy.
- **Measurement & acceptance:** route-by-route justification in each removal
  PR; never a bulk delete.
- **Rollout/rollback:** revert restores the route; no data migration.

### WP12 - API route sprawl (singular/plural pairs)

- **Problem (low-medium):** real pairs exist (`/api/character` +
  `/api/characters`, `/api/corporation` + `/api/corporations`,
  `/api/country` + `/api/countries`) [code]. The report's "308 redirects" is
  [target], uncounted.
- **Smallest useful steps:** inventory pairs and their callers (web app,
  discord bot, API consumers, docs site); consolidate on the plural form
  behind redirects only where callers are all internal; public-facing paths
  need a deprecation window.
- **Correctness risks:** external consumers (bot, scripts, bookmarks) break
  silently on a hard rename.
- **Measurement & acceptance:** caller inventory per pair; redirects verified
  with and without session cookies (no CDN caching of per-user responses -
  check `no-store`).
- **Rollout/rollback:** redirects are cheap to revert; removals are not.

### WP13 - TypeScript compiler heap

- **Problem (low):** `--max-old-space-size=8192` is a ceiling, not a
  measurement [code]. Whether tsc actually needs 8 GB is unknown; the <3 GB
  target is [target].
- **Smallest useful steps:** measure actual peak RSS of `npm run typecheck`;
  if it is heap-bound, profile `tsc --diagnostics`/`--extendedDiagnostics` for
  the widest types (db types unions are the usual suspect); only then set a
  target.
- **Measurement & acceptance:** a measured number, not a ceiling.
- **Rollout/rollback:** n/a (tooling).

## 5. Sequencing and decision points

1. **WP0 first, always.** Nothing else is defensible until the baseline has
   provenance. Budget reconciliation rides in the same PR as the measurement.
2. **WP1-WP4** (round-trip relief) and **WP5-WP6** (CPU/decode) proceed in
   parallel as separate small PRs - one phase or command family per PR, each
   with before/after trips/documents/bytes. Never sum savings across phases
   that share reads; overlapping wins are not additive.
3. **WP9's failure-injection pattern** lands before any WP10 merge, because
   merged phases change recovery granularity.
4. **WP10 streams** start with rules sharing where parity is provable;
   storage merges only when the seam table, reader inventory, and migration
   plan are complete.
5. **WP7/WP8/WP11** (lifecycle and dead weight) run continuously, one
   collection/route per PR.
6. **WP12/WP13** are independent maintainability tracks with their own
   evidence; they never count toward turn-latency claims.

## 6. Standing constraints (apply to every package)

- **Portable rules core:** any formula touched lands in `rules.ts`/`rules/`
  beside its system - plain data in/out, injected rng and turn, no DB/clock/
  env/network. The architecture audit runs in `verify`.
- **RNG and ordering:** phases share draw order; merges and reordering change
  outcomes unless re-keyed. Ordering comments in `turnPhaseRegistry.ts` are
  load-bearing.
- **Guarded writes survive batching:** `findOneAndUpdate` balance/ownership
  guards are the atomicity boundary; never replaced by blind `$inc`.
- **Issue gates:** schema changes under `src/lib/db/types`, new mechanics, and
  balance changes each need an issue; balance changes also need a
  `scripts/sim/` report.
- **Measurement protocol:** same-seed before/after via
  `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts` quoting
  trips/documents/bytes (not wall clock); `TRACE_COLLECTIONS` for call-site
  attribution; `--profile` for CPU; golden replays byte-identical; post-deploy
  turndiag review.
- **Hosts:** report MP and SP/headless separately; register SP skip
  predicates for new cross-player work.

## 7. Verification status of this plan

Verified against `development` @ `028cb9265e` (this checkout): every [code]
claim in §2, the heal-route and snapshot inventories, the resume gate, SP
denylist, projection and cadence machinery, `billDiscussions` unification,
NPP command-core locations and guarded writes, `shareOrders` index seed gap and migration coverage,
budget values, phase-name counts, and the typecheck heap ceiling.

Still requires production BSON bytes; timing and command distributions split by
fiscal and election turn; the `electionCandidates` historical retention
contract; whether production runs the turn via `CRON_OWNER=worker`;
and the true per-turn executed-phase count per world. A partial local
production copy is available for profiling.

## 8. Execution record

Work began on this PR on 2026-09-25. Items below distinguish landed code from
observations that have not passed their package acceptance gate.

Production timing sample from turndiag `phase_history`, latest 60 logged turns
through turn 1117 (2026-09-24 23:00 UTC). p95 is the nearest-rank value from
the returned 60 per-turn durations. These are phase wall times, not command
counts; cadence-gated phases have near-zero readings on skipped turns.

| Phase                  | Median ms | p95 ms | Max ms | Failed readings |
| ---------------------- | --------: | -----: | -----: | --------------: |
| `indexFunds`           |    14,242 | 48,766 | 75,484 |               0 |
| `corporationTurn`      |    26,034 | 58,661 | 81,039 |               6 |
| `nppActionProcessing`  |         1 | 30,715 | 42,754 |               0 |
| `bankingTurn`          |     2,008 |  5,673 |  8,176 |               0 |
| `voteAccumulation`     |     8,831 | 23,668 | 25,380 |               0 |
| `bondTurn`             |     6,428 | 19,977 | 27,329 |               0 |
| `financialSuspectScan` |     8,274 |  9,764 | 12,880 |               0 |
| `recomputeSharePrices` |     3,426 |  7,271 |  9,319 |               0 |

Production command sample from `turnLogs.phaseStatuses.roundTrips` in the same
60 logged turns (turns 1058-1117). There were 55 successful turns. The table
uses only those 55 turns and only executed readings above zero. A phase's
`overBudget` count compares against the budget in place before this PR; it is
not a failure count. The deployed commit hash is not recorded in `turnLogs`,
so these readings cannot by themselves prove a code-diff speedup.

| Phase                  | Executed readings | Median trips | p95 trips | Old-budget exceedances | New warning budget |
| ---------------------- | ----------------: | -----------: | --------: | ---------------------: | -----------------: |
| `indexFunds`           |                55 |        7,239 |    15,056 |                     54 |             18,000 |
| `corporationTurn`      |                49 |        2,154 |     3,544 |                     31 |              4,500 |
| `nppActionProcessing`  |                16 |        6,682 |     8,553 |                     14 |             10,000 |
| `bankingTurn`          |                55 |          591 |       818 |                     53 |              1,000 |
| `voteAccumulation`     |                55 |        3,132 |     3,641 |                     42 |              4,500 |
| `recomputeSharePrices` |                55 |          631 |       853 |                     55 |              1,000 |
| `fiscalYear`           |                 1 |        3,214 |     3,214 |                      0 |   7,000, unchanged |

| Package                | Result                                                                                                                                                                                                                                                                                                                                                                                                                      | Remaining gate                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0                    | Production turndiag read at turn 1117 (2026-09-24 23:00 UTC): successful 116.358 s turn, 243 recorded phases; `corporationTurn` 29.726 s and `indexFunds` 14.345 s. The last 60 logged turns have 111.846 s median and 236.547 s p95. Turn 960 was completed with warnings under the old success predicate, fixed by #2281. Queried `turnLogs` directly for the round-trip sample above and reconciled six warning budgets. | BSON bytes and per-turn-type p95 need a matched local world or additional telemetry. The partial local copy produced a turn profile; its bytes and duration are not production baselines. Warning-budget changes are not performance gains. |
| WP1                    | Added the migration-compatible `share_orders_fund_open_bids` index to the recurring seed path. Production `explain(queryPlanner)` already uses the migration-created index, so this protects reset worlds and has no expected production speedup.                                                                                                                                                                           | Test a reset world to confirm the index is recreated; validate the local phase-only reduction after rollout against production telemetry. The second bid read remains because it observes the live order book after cancellation.           |
| WP10, stream 6 cleanup | Moved the two residual modules from `src/lib/corporation/` into `src/lib/corporations/` and updated their four callers. The singular directory is gone.                                                                                                                                                                                                                                                                     | Typecheck, focused tests, and build must pass. The banking/fund seam and phase merge are still open.                                                                                                                                        |
| WP7 inventory          | Read-only production `db.stats()` reports 392 collections, 31,156,553 documents, and 16.49 GB logical data. The three largest collections by logical size are `ledgerEntries` (4,390 MB), `actionAuditLog` (2,935 MB), and `financialTxLog` (2,572 MB).                                                                                                                                                                     | Writer/reader inventory, 30-day growth, and restore requirements remain open; no TTL or deletion has been applied.                                                                                                                          |
| WP8 measurement        | Read-only production aggregation found 36,140 withdrawn and 2,337 active `electionCandidates` rows. The `tallyManagement` query `{ electionId, status: "active" }` uses `electionCandidates_electionId` in production `explain(queryPlanner)`. This does not support a global candidate-scan explanation for `voteAccumulation` latency.                                                                                    | Profile election-turn query work and define the historical reader contract before any archive or deletion.                                                                                                                                  |
| WP13 measurement       | `/usr/bin/time -f %M npm run typecheck` completed successfully with peak RSS 7,849,504 KiB (7.49 GiB) in this worktree. The configured 8,192 MiB V8 heap is a limit, not the measured RSS; the proposed under-3-GB target is currently unsupported.                                                                                                                                                                         | Profile TypeScript diagnostics and type instantiation hotspots before changing compiler settings. Elapsed wall time was 1,790.93 s on a heavily contended host and is not a stable compiler benchmark.                                      |

WP6 now projects only `turnLengthMinutes` for transaction expiry reads. On the
local copy, the full `gameConfig` document is 10,572 BSON bytes and the
projected result is 45 bytes. This changes bytes returned per read, not the
number of reads. A call-site trace on local turn 1119 counted 417 expiry reads
from fund bond purchases, 342 from bid placement, and 282 from bid refunds.
It also counted 342 `systemSettings` threshold reads from bid placement and
282 from bid refunds. The equity liquidity refresh now loads thresholds once
and passes them to both order paths. This predicts 623 fewer threshold reads
for an equivalent turn. It and the bond reserve pass also load turn cadence
once each and pass it to transaction emission, predicting 1,039 fewer
`gameConfig` expiry reads across these paths on turn 1119. The trace
instrumentation counts both `findOne` and the underlying `find` hook for each
call, so the stated counts use only its `findOne` rows.

A matched phase-only replay at turn 1120 used two copies of the same local
snapshot: baseline commit `4fdc572264` and batched commit `4ae339b03a`.
`indexFunds` fell from 5,980 to 4,625 Mongo round trips (1,355 fewer,
22.7%), from 32,324 to 31,647 returned documents, and from 6,460,783 to
6,430,318 BSON bytes. All numeric phase result counters and the zero error
count matched. The aggregate fund cash, units, NAV, liquidity quote statuses
and escrow totals, 680 fund transaction-log rows at turn 1120, and the
liquidity snapshot also matched. This verifies the local phase behavior on
the partial world; production monitoring must confirm the deployed effect.

WP2's direct local `corporationTurn` trace at turn 1121 recorded 1,741 Mongo
commands, including 558 on `tariffs`. The signed-bill replay contained 275
origin-country tariff provisions and one economy-wide provision. The replay
now batches non-economy scope updates in enactment order and keeps the
economy-wide provision on its existing budget-sync path. On two identical
local copies, `reconcileSignedTariffBills` fell from 559 to 11 Mongo commands
(548 fewer, 98.0%), from 557 to 282 returned documents, and from 1,092,025
to 1,033,415 BSON bytes. Both copies ended with 222 tariff documents and the
same normalized scope/rate/source-bill digest; federal budget tariff-rate and
revenue totals matched. This is a helper-level replay on a partial local world,
not a production phase p95 claim. The rest of WP2 remains open.

WP3's direct local `processNppActions` trace at turn 1124 recorded 7,267 Mongo
commands, 24,394 returned documents, and 14,934,762 BSON bytes on the partial
local world. The bond-buy core made 132 `bonds.findOne` calls after the sweep
had already loaded candidate bonds by country. The share-buy and share-sell
cores made another 242 and 270 `corporations.findOne` calls respectively.
The bond sweep now passes its projected candidate to `nppBuyBond`; the core
still obtains a live market-pool quote and retains the guarded NPP debit and
bond reservation with refund on a failed reservation. A focused test verifies
the omitted bond read and refund. A matched `processNppActions` replay at turn
1128 on two copies of the same local snapshot reduced commands from 7,279 to
7,150 (129 fewer), returned documents from 22,970 to 22,841, and BSON bytes
from 13,909,605 to 13,009,284. All reported action counters matched. Hashes
of projected NPP investment cash (3,450 rows), bond float and holders (5,693),
bond pool cash and lifetime totals (24), and corporation float, shareholders,
and liquid capital (734) matched. This verifies the local phase behavior; the
other share command-core reads and production p95 remain open.

The one-turn profiler has a local-only guard and cannot be run against
production. A partial production copy is restored to a private localhost Mongo instance
outside the repository for a profiling turn. It has 380 collections, 3.31 million
documents, and 1.96 GB logical data. To make the copy tractable, the dump
excluded `ledgerEntries`, `actionAuditLog`, `financialTxLog`,
`corporationHistory`, `indexFundTransactions`, `orgRegLedger`,
`corporationPortfolioHistory`, `treasuryTransactions`, `primarySnapshots`,
`tradeFlowSnapshots`, `wealthListHistory`, and `portfolioHistory`. Any local
bytes or CPU profile from this copy is a partial-world sample. The local
profile completed turn 1118 in 544.4 s with 20,362 Mongo round trips,
507,833 documents, and 291.7 MB BSON returned. `indexFunds` accounted for
7,064 trips and 15.8 MB; its 970 `gameConfig` reads returned 9.7 MB.
`corporationTurn` accounted for 1,717 trips and 91.6 MB, with 33.4 MB from
`corporateSectors` and 22.1 MB from `supplyAgreements`. These values are a
single partial-world observation and cannot be compared with the production
duration or used as acceptance thresholds. WP1 now loads exchange rates,
the persisted turn, and transaction thresholds once for each fund rebalance
sell pass; replay the same world before and after this change to quantify its
effect. The operations page is unchanged. The remaining work packages are open and must pass their
own measurement and correctness gates before implementation.
