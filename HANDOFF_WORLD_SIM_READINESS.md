# Worldsim readiness handoff

## 2026-09-23 corrective restart

- Stopped the previous 1991 and 2027 diagnostic jobs at turns 30 and 41, respectively, instead of allowing known invalid bootstraps to consume 240 turns. Stopped the detached watcher and worker. Their queue status is `failed` with exit code 143; this means intentionally interrupted, not a simulation failure.
- The 1991 bootstrap had 49 critical checks, all explained by absent RU/PL/CS/HU/RO/BG/YU region, party, and sector substrate. This is a real unauthored 1991 country bundle gap. Do not fill it with Soviet-era data or mark countries absent merely to silence conformance.
- The 2027 bootstrap had 13 critical checks. Twelve euro budget comparisons were false positives and are fixed in the current source; the remaining critical is real: TR regional population 43.5 million versus national 83.4 million. The 2019/2027 TR region selector currently uses explicitly 1979 data.
- Partial runs found no `indexFunds` timeout: 1991 had 29 completed samples, median 40.8 seconds, max 122.3 seconds; 2027 had 40, median 30.6 seconds, max 75.8 seconds. This does not establish 240-turn performance acceptance.
- Persisted health snapshots reported 28 Irish Seanad and 48 Japanese Sangiin officials as orphaned. Their classification was fixed after those workers loaded source; these old snapshots do not verify the correction. Other warnings included empty parties and zero-candidate elections.
- `scripts/sim/runWorld.ts` now stops immediately after fresh-bootstrap conformance if there are critical findings or a diagnostic error. This prevents another long run on an invalid seed. Focused worldsim conformance tests (5), formatting, and diff whitespace passed; incremental TypeScript check was still running at this update.
- Queued fresh guarded jobs: 1991 `c3c60a2e-088f-4389-92c4-631e7c13a918`, 2027 `0ceb61be-3ee7-4147-9877-7e63a7617332`, with unique sandboxes and the same 240-turn flags as the interrupted pair. Started one local worker with concurrency 2. These runs should stop at bootstrap if the real seed gaps remain. Do not count them as accepted runs or relaunch 240-turn work until the authored country data is repaired and bootstrap conformance is clean.
- Filed prerequisite authoring issues [#2316](https://github.com/Egg3901/AHDGame/issues/2316) for the seven 1991 successor countries and [#2317](https://github.com/Egg3901/AHDGame/issues/2317) for modern Turkey regions, including simulation-report acceptance requirements. No demographic weights were changed to silence diagnostics.
- Both guarded restarts reached fresh-bootstrap conformance and stopped at **turn 0**. The 1991 run reported 451 ok, 77 warnings, 49 critical, all in the seven unauthored countries. The 2027 run reported 424 ok, 52 warnings, **1 critical** (`regions.TR.populationSum`); this confirms the twelve euro comparison false positives are resolved in new-source conformance. Both queue jobs are `failed` with exit code 1 by the new fail-fast guard, not after turn processing. The worker was sent SIGTERM to drain and claim nothing further.
- The focused conformance suite passed 5 tests. Prettier check, `git diff --check`, and incremental TypeScript check passed. The full verify/build and 240-turn acceptance gate remain outstanding because the bootstrap criticals are real.

## 2026-09-23 authoring work in progress

- The user chose authored 1991 data for RU/PL/CS/HU/RO/BG/YU, rather than temporary regional or demographic proxies. Do not remove those countries from the 1991 roster or copy the Cold War one-party seed pack into 1991.
- Added a 1991 conformance critical for each active country with no authored national fiscal config. The seven missing countries have no `NATIONAL_BUDGET_SEED_CONFIGS_1991` rows or `COUNTRY_POLICY_CONFIGS_1991` entries, so passing the original 49 checks alone would still leave an incomplete world. The focused conformance test passed 30 tests.
- Added a transparent modern Turkey population overlay for the existing eight simulation regions, based on the Republic of Turkey Ministry of Development's ABPRS 2013 NUTS-1 regional weights normalized to the game's 83.4 million 2019 national budget. It allocates 600 assembly seats and no Senate seats. This is an explicit modern population proxy, **not** the complete modern province-level bundle tracked in #2317; old relative regional GDP weights remain until that work is authored. It is used for 2019/2023/2027; 1991 explicitly retains its previous bundle rather than accidentally inheriting this modern overlay.
- The 2027 in-memory bootstrap produced the correct 83.4 million regional total and passed its Turkey and euro assertions; a broad all-critical assertion against that fixture was removed because it leaves gameState at 2019 and omits seats. A fresh five-turn 2027 sandbox probe was queued as `24416f47-51b3-45d1-b192-9dbe790ff51e`, seed `worldsim-readiness-2027-probe-mud90q9i`, using isolated source snapshot `/tmp/ahd-worldsim-2027-source` with SHA-256 manifest `abf9ba1e4c0767508e7b1090cb3a337ddd1cfb395865711edc2f3963bc2af104`. Its worker runs with one slot; inspect its bootstrap conformance before any longer run.
- The worker now copies a failed bootstrap's critical finding IDs and summary onto the queue job if it stops at turn 0. TypeScript and focused lint passed after this change.
- Research anchors for 1991 national populations: World Bank WDI `SP.POP.TOTL` for 1991 reports RU 148,394,216; PL 38,246,193; HU 10,373,400; RO 23,001,155; BG 8,632,367. The Czech Statistical Office publishes the 3 March 1991 Czechoslovak census; the UN digital library catalogues the 1991 Yugoslav federal census. National totals alone are insufficient to author their regional, demographic, fiscal, party, and policy bundles.
- The isolated five-turn 2027 probe `24416f47-51b3-45d1-b192-9dbe790ff51e` passed fresh bootstrap conformance: 425 ok, 52 warnings, **0 critical**. It was still processing turns at this update. Source snapshot `/tmp/ahd-worldsim-2027-source` has manifest hash `abf9ba1e4c0767508e7b1090cb3a337ddd1cfb395865711edc2af104`. Its sandbox database is `ahd_sim_worldsim-readiness-2027-probe-mud90q9i`. The focused readiness integration suite passed all five tests after the final assertion correction.
- That probe completed all five turn logs and its queue job is `completed` at `currentTurn=6` (post-turn cursor). Its turn-4 health snapshot is passing with 0 errors and 2 warnings: five memberless parties and 17 active elections without candidates. The worker received SIGTERM after completion so it cannot claim further jobs.
- The 52 bootstrap warnings break down as 22 missing demographic defaults/turnout, 10 regional-vs-budget population drift, eight missing strategic-sector designations, six FX era-rate checks for unseeded HU/PL/RO/YU/BG/CS, four political readiness gaps, and two reset metadata checks. The six FX warnings are false positives for 2027: the sandbox has zero states, budgets and corporations for those countries. Conformance now filters the FX fallback-rate check to seeded countries; its focused test suite passed 31/31. This correction was made after the isolated snapshot, so a fresh bootstrap should report six fewer warnings. The other warnings remain unresolved and the user explicitly wants them addressed before overnight jobs.
- The user clarified that both overnight runs should be queued only after warning remediation and brief probes of no more than a few turns. Neither 240-turn job has been queued. The 1991 authored RU/PL/CS/HU/RO/BG/YU bundles remain a major prerequisite; do not queue a known turn-0 failure. The 2027 short probe is complete, and its worker is stopped. Before any overnight worker starts, pin a clean source snapshot, run fresh bootstrap conformance, inspect health warnings, then arrange a watcher to detect failure/stall and restart only after diagnosing the cause.

## 2026-09-22 continuation status

- Formatted all touched files and added `health: lastHealth` to the successful `processTurn` return, which had been omitted.
- Updated both `checkpointReport.ts` and `executiveSummary.ts` to use `aggregateGameHealth(gameHealthRunSummary(...))`, so report error and warning totals include integrity findings.
- Focused Vitest command in the verification sequence passed: 7 files, 83 tests. `git diff --check` passed.
- `npx tsc --noEmit` hit Node's default 4 GB heap limit after about 6.5 minutes. A retry with `NODE_OPTIONS=--max-old-space-size=8192` remained CPU active with no diagnostics after 20 minutes and about 7.6 GB RSS; it was stopped. Typecheck is **not verified**. Investigate TypeScript memory use before accepting the source.
- Bootstrap integration, one-turn performance profiling, full `verify`, build, and the two requested simulation runs have **not** been executed. No job was queued or lease changed in this continuation.

## Later 2026-09-22 continuation (supersedes the status above)

- TypeScript passed with `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit --incremental --tsBuildInfoFile /tmp/worldsim-readiness-20260922.tsbuildinfo` after fixing debt return typing and euro rate null guards. The default 4 GB heap is insufficient for this checkout.
- Tests passed: initial focused suite (83), new 2027 readiness bootstrap (4), all preset bootstrap (13), worker argument tests (16), redenomination tests (2), and health snapshot tests (12, with a 60-second timeout under host contention). `git diff --check` passed. Lint and format checks were still active when this line was written.
- Corrected `checkpointReport.ts` and `executiveSummary.ts` to aggregate integrity and processing health. The successful `processTurn` return includes health.
- Corrected 2027 conformance comparisons to denominate expected GDP and debt in EUR. The new readiness integration test verifies this. The original 2027 job bootstrap report, generated before this correction was loaded, contains 12 false euro-budget criticals.
- The remaining 2027 bootstrap critical is real: `regions.TR.populationSum`, 43.5 million in seeded regions versus 83.4 million national expectation. Do not quietly change demographic weights; this needs the repo's balance issue and simulation policy.
- The 1991 bootstrap report has 49 critical checks for missing RU/PL/CS/HU/RO/BG/YU regional and party substrate, the same set as the prior 1991 run. The era roster explicitly says these countries are present but unauthored, so do not mark them absent as a shortcut.
- Health snapshots exposed false orphan errors for Japanese Sangiin bloc rows (2027: 48), which have region and office but no class assignment, and Irish Seanad rows (1991: 28), which have real seats but no action office configuration. `gameHealthSnapshot.ts` now recognizes both without falsely marking precise Japanese class seats as filled; its 12 tests pass. Running workers loaded code before this follow-up edit, so their persisted historical health snapshots will still contain the old false errors.
- Exactly two fresh jobs were queued and claimed by one local worker with `GAME_REPO_DIR` pointing at this dirty worktree and no pinned source fields: 1991 `6ee60360-699f-4001-9713-1252dbc4b95a`, seed `worldsim-readiness-1991-mud50zob`; 2027 `2df29be2-b4c0-4d62-a3fb-6e21e162e003`, seed `worldsim-readiness-2027-mud50zob`. Both have 240 turns, plants market, full labour, active freight, v5 autonomy, all feature flags, and the prior explicit market flags. They were running at turn 9 and turn 14 respectively at this update. Their sandbox DBs are `ahd_sim_worldsim-readiness-1991-mud50zob` and `ahd_sim_worldsim-readiness-2027-mud50zob` on local Mongo port 27018.
- The worker was started with explicit local-only Mongo settings and `SIM_WORKER_MAX_LOAD_RATIO=1.1` because host load exceeded its default claim threshold. Do not start a second worker for these jobs. Query `sim_control.simJobs` for status and monitor through completion/failure; then gather phase timings, health summaries, and checkpoint reports.
- Subsequent verification: repository-wide lint exited 0 with 451 warnings and no errors; format check passed; architecture audit passed all blocking checks (56 advisory warnings); latest 12 GB incremental TypeScript check exited 0. Focused lint on later touched files also exited 0.
- Fixed another health propagation gap: non-checkpoint turns had been writing `health: null` over the most recent checked summary in both sandbox progress and the queue mirror. The mirror now omits health on unchecked turns so the last checked summary survives. `simStatusMirror.test.ts` passes 3 tests, including checked-then-unchecked coverage. Running workers loaded the old code before this edit.
- Generated the first partial checkpoint report: `/tmp/worldsim-readiness-2027-turn25.html` (turn 25, 18 countries, 8 snapshots). Generate the matching 1991 turn-25 report once that job reaches 25. These are partial-run artifacts, not 240-turn acceptance.
- The matching 1991 partial report was generated at `/tmp/worldsim-readiness-1991-turn25.html` (turn 25, 18 countries, 8 snapshots). At the last status check, the jobs were still running at turn 34 (2027) and turn 25 (1991).
- Current-run `indexFunds` early samples: 2027 first 15 completed phases had median 19.2 seconds and max 75.8 seconds; 1991 first 10 had median 49.2 seconds and max 122.3 seconds. The 1991 turn-24 `indexFunds` phase completed in 106.5 seconds after a long overall turn. This is below the 240-second phase timeout but does not prove 240-turn acceptance.
- A detached read-only watcher is running from `/tmp/worldsim-readiness-watch-20260922.cjs`. It refreshes `/tmp/worldsim-readiness-status-20260922.json` each minute. Once both jobs are terminal, it attempts final checkpoint and executive HTML reports under `/tmp/worldsim-readiness-<year>-final-checkpoint.html` and `/tmp/worldsim-readiness-<year>-executive.html`, writing execution details to `/tmp/worldsim-readiness-watch-20260922.log`. It does not claim, alter, retry, or restart jobs. The worker itself remains the original process (PID 2694132 at this update).

## Copy/paste prompt for the next agent

You are continuing work in `/root/projects/AHDGame/worktrees/worldsim-readiness-20260922` on branch `fix/worldsim-readiness-20260922`.

The user asked to fix all known blockers from the previous 1991 and 2027 world simulations, discover additional blockers instead of assuming the list is complete, verify the fixes, queue two new runs, and start them. Do not commit unless the user explicitly asks for a commit. Preserve unrelated work in `/root/projects/AHDGame/worktrees/resolve-open-issues-20260922`.

Use the `diagnosing-bugs` skill loop: measure first, keep focused red-capable tests, rank hypotheses, and do not claim readiness without evidence. The repository is production-bound. Read `AGENTS.md` before editing.

## Current worktree state

The worktree is intentionally dirty. Existing edits are the active implementation and should be reviewed, formatted, typechecked, and tested rather than discarded.

Branch base: `241f66072 perf(turn): batch high-volume simulation work`.

Changed areas:

- 2027 era roster now excludes RU, PL, HU, RO, and BG until modern country bundles exist; party-only seeds cannot recreate an absent country.
- Added pure era-aware currency rules and redenomination rules.
- Added the era-currency topology shell to convert euro-member budgets, state data, treasuries, NPP wallets, corporations, bonds, and exchange-rate documents during bootstrap.
- Updated forex seeding and conformance diagnostics to use era currency rules.
- Added game-health summary telemetry that separates processing failures from integrity failures and carries health through turn logs, simulation jobs, progress mirrors, and status output.
- Added forex-order actor coverage as an explicitly unexercised pure-NPP mechanic, rather than inventing fake system actors.
- Updated checkpoint currency reporting to be era-aware.

Untracked/new files include:

- `src/lib/admin/seed/applyEraCurrencyTopology.ts`
- `src/lib/currency/rules/eraCurrency.ts` and tests
- `src/lib/currency/rules/redenominate.ts` and tests
- `src/lib/turn/rules/gameHealth.ts` and tests

## Known prior findings

- Previous 1991 run: `029054a8...`; replicate: `06b86bd9...`.
- Previous 2027 run: `4d943526...`.
- #2289: 2027 HU/PL/RO/BG/RU were listed active without substrate.
- #2291: euro countries retained legacy currencies.
- #2292: health snapshots hid integrity errors.
- #2293: forex was enabled but produced zero orders/trades.
- #2271: `indexFunds` hit 240-second phase timeouts in 1991 full flags.
- #2078 anomaly false positives were already fixed in HEAD by #2261.

The selected 2027 roster decision is to exclude unsupported RU/PL/HU/RO/BG from the shipping manifest until complete modern regional, fiscal, executive, and election bundles are authored. Do not silently seed Soviet or 1979 data into 2027.

The selected forex decision is that pure-NPP worlds do not submit orders. Keep the actor manifest honest by reporting the mechanic as unexercised/partial; do not create fake system characters.

## Immediate verification sequence

1. Inspect `git status` and the diffs. Check `src/lib/turnSystem.ts`, `src/lib/turn/gameHealthSnapshot.ts`, and `src/lib/admin/seed/applyEraCurrencyTopology.ts` carefully for missed return shapes, idempotence gaps, and TypeScript errors.
2. Run Prettier on touched files, then run focused tests with one worker:

   ```bash
   npx prettier --write scripts/sim/checkpointReport.ts scripts/sim/localWorldsimMcp.ts scripts/sim/runWorld.ts scripts/sim/simStatusMirror.ts scripts/sim/worker.ts src/lib/admin/bootstrapGameWorld.ts src/lib/admin/seed/seedForex.ts src/lib/admin/seedDiagnostic/conformance.ts src/lib/currency/migration.ts src/lib/db/types/gameHealthSnapshot.ts src/lib/db/types/index.ts src/lib/db/types/turnLog.ts src/lib/seeds/partySeedRegistry.ts src/lib/sim/actorCoverage.test.ts src/lib/sim/actorCoverage.ts src/lib/sim/actorReport.test.ts src/lib/turn/gameHealthSnapshot.ts src/lib/turnSystem.ts src/lib/world/eraRoster.test.ts src/lib/world/eraRoster.ts src/lib/admin/seed/applyEraCurrencyTopology.ts src/lib/currency/rules/*.ts src/lib/turn/rules/*.ts
   npx vitest run --maxWorkers=1 src/lib/sim/actorCoverage.test.ts src/lib/sim/actorReport.test.ts src/lib/world/eraRoster.test.ts src/lib/world/eraContract.test.ts src/lib/currency/rules/eraCurrency.test.ts src/lib/currency/rules/redenominate.test.ts src/lib/turn/rules/gameHealth.test.ts
   ```

3. Run `npx tsc --noEmit`. Likely trouble spots are `GameHealthSnapshot.health` being required in old object literals, untyped Mongo documents in conformance checks, and broad return-shape edits in `turnSystem.ts`.
4. Run the relevant integration/bootstrap milestone: `npx vitest run src/lib/admin/seed/presetBootstrap.integration.test.ts`. It previously took roughly 14 minutes and exceeded a 600-second hook timeout, so communicate progress and do not mistake the hook timeout for a code failure. Check the generated world directly if needed.
5. Port health aggregation into `scripts/sim/checkpointReport.ts` and `scripts/sim/executiveSummary.ts` if not already done. Reports should use `aggregateGameHealth` and preserve integrity failures instead of reducing only processing errors/warnings.
6. Measure the performance blocker on a local world before claiming #2271 fixed:

   ```bash
   AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts
   ```

   Inspect `indexFunds` round trips, bytes, documents, and wall-clock behavior. The HEAD perf commit batches high-volume work, but no acceptance claim has yet been made for a 120-turn full-flags run. A short isolated run is useful evidence; a full acceptance run should be isolated from other workers.

## Host and queue facts

- Use the configured local sandbox Mongo service for simulation runs.
- A stale `simJobs` job `04da0b9e...` was observed previously, with no local worker process. Inspect its lease/status before queueing. Do not kill the unrelated Vitest process in the other worktree.
- At the time of this handoff, another worktree may be running `npm run verify` and/or Vitest. Avoid interpreting host contention as a regression.
- `scripts/sim/start-worker.sh` loads `.env.sim.local`; if it is unavailable, use explicit local environment variables only after inspecting the worker configuration.
- `simSource` refuses dirty pinned worktrees. Since this worktree is dirty and no commit is authorized, either run the worker with `GAME_REPO_DIR` pointed at this worktree and omit `sourceWorktree/sourceCommit`, or create a temporary clean verified copy without changing repository history. Do not queue a pinned dirty source.

## Queue and run requirements

After verification, queue exactly two new jobs, one `1991-default` and one `2027-default`, using unique seeds and unique sandbox database names. Match the previous full-run intent: 240 turns, full labour, plants market mode, active freight settlement, all relevant flags enabled, and the accepted pure-NPP actor mode. Inspect the validator in `scripts/sim/localWorldsimMcp.ts` for exact allowed enum values before insertion.

Before inserting, read current `simJobs` statuses and worker leases. Resolve only demonstrably stale orphan state, preferably through the worker's recovery path; if manual status repair is unavoidable, record the exact job id and reason. Then start the worker and confirm both new jobs transition from `queued` to `running`. Continue monitoring until there is a concrete completion/failure result and collect checkpoint reports and health summaries.

Do not report the runs as successful merely because they were queued. Report verification commands, any remaining blockers, job ids, statuses, source path, and measured performance. If a blocker remains, state it plainly and leave the queue in a recoverable state.

## Important constraints

- No secrets, credentials, player data, or connection strings in committed files or handoff text.
- No destructive git commands and no commits without explicit user authorization.
- Preserve the unrelated dirty worktree at `/root/projects/AHDGame/worktrees/resolve-open-issues-20260922`.
- Avoid broad rewrites. Use `apply_patch` for edits.
