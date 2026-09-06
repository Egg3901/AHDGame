/**
 * Unified reset + bootstrap orchestrator — single entry point for fresh-world
 * setup. Called by:
 *
 *  - CLI: `scripts/reset-and-bootstrap.ts` (existing world)
 *  - CLI: `scripts/bootstrap-full.ts` (empty database, via runBootstrap helper)
 *  - Admin API: `src/app/api/admin/reset/route.ts`
 *
 * Before this orchestrator existed, the CLI and admin paths each composed
 * `resetGameWorld` + `bootstrapGameWorld` with slightly different defaults —
 * notably `resetReference` was false on CLI and true in admin, so the two
 * produced subtly different "fresh worlds". This function pins the canonical
 * sequence so every entry point is equivalent given the same options.
 *
 * Sequence — teardown, build, finalize. Each phase owns one job and no phase
 * seeds what another already seeds; that separation is the point, because the
 * three used to overlap and the world was seeded twice per reset.
 *
 *   0. Seal — maintenance mode + `isActive: false`, BEFORE anything is deleted.
 *   1. resetGameWorld — wipes runtime collections, retires/deletes characters,
 *      stamps the new clock. Seeds nothing.
 *   2. bootstrapGameWorld — seeds the entire world, initializes gameState,
 *      spawns starting elections + officials (or stops at seed-only).
 *   2b. finalizeResetGameWorld — the cleanup steps that need a seeded world:
 *      default-party top-up, party/charter/statePartyOrg cleanup, demographics
 *      reset, orphan region-row purge, IMF placeholder, adminLog.
 *   3. If `seedOnly: true`, run seedHistoricalOfficials *after* the seeders so
 *      party sequentialIds match — bootstrap's own historical seed only fires
 *      on the non-seedOnly path.
 *   4. runSeedDiagnostic (conformance) while sealed, then re-assert the seal.
 *      When conformance has no criticals, captureSeedBaseline snapshots macros.
 *      Diagnostic failure never aborts the reset.
 *
 * See `docs/reset-and-seed-contract.md` and `seedManifest.ts` for the
 * companion classification of which collections each phase touches.
 */

import type { Db } from "mongodb";
import { resetGameWorld, type ResetGameWorldResult } from "@/lib/admin/resetGameWorld";
import { bootstrapGameWorld, type BootstrapMode } from "@/lib/admin/bootstrapGameWorld";
import { finalizeResetGameWorld } from "@/lib/admin/finalizeResetGameWorld";
import { seedHistoricalOfficials } from "@/lib/npp/seedHistorical";
import { enableMaintenanceMode } from "@/lib/maintenanceStatus";
import {
  closeResetRunLog,
  createResetRunRecord,
  openResetRunLog,
} from "@/lib/admin/resetRunRecord";
import { presetDefaultsToFoundingPhase } from "@/lib/seeds/presetSelector";
import type { GameIteration, GameState } from "@/lib/db/types/gameState";

export interface ResetAndBootstrapOptions {
  db: Db;
  /** "historical" populates real-world officials/NPPs; "vacant" leaves seats empty. */
  mode?: BootstrapMode;
  /** Preset key passed to seedHistoricalOfficials (e.g. "2019-default"). */
  preset: string;
  /**
   * If true, the bootstrap phase drops reference collections before re-seeding.
   * Catches schema drift from removed seed entries. Default true; pass false
   * to upsert in place (legacy CLI behaviour, exposed via --preserve-reference).
   */
  resetReference?: boolean;
  /**
   * Full reset: deletes non-admin `users`, `characters`, `retiredCharacters`,
   * and `characterAchievements`. Admin users always survive. Default false.
   */
  deleteProfiles?: boolean;
  /** Skip ensureUKRegionalCouncilElections in bootstrap. */
  skipRegionalCouncil?: boolean;
  /**
   * If true, stop bootstrap after reference seeding — no game state init,
   * no election spawning. Historical officials are still seeded so the
   * "reset only" admin button leaves a populated NPP/officials state.
   */
  seedOnly?: boolean;
  /** Identifier recorded in adminLogs. CLI passes "CLI"; admin passes the admin username. */
  adminUsername?: string;
  iteration?: GameIteration;
  /**
   * Start the world in a live pre-iteration "founding" phase: chambers seed
   * VACANT and a cycle-0 founding election seats every political nation before
   * the real game begins (date pinned to the era start meanwhile). Threaded to
   * `resetGameWorld` (state stamp + priors seed) and `bootstrapGameWorld`
   * (priors seed, the founding spawn sweep, and skipping the JP Sangiin inline
   * bootstrap).
   *
   * LEAVE UNSET to get the preset's intended default
   * (`presetDefaultsToFoundingPhase` — currently 1953-default only). Pass an
   * explicit boolean to force it on or off. Forced ON is still ignored for
   * `seedOnly` / `mode: "vacant"` runs, which never spawn the founding races
   * and so would pin the calendar to the era start forever.
   */
  preIteration?: boolean;
  /** Skip the operator conformance audit for isolated local player worlds. */
  skipDiagnostic?: boolean;
  log?: (msg: string) => void;
}

export interface ResetAndBootstrapResult {
  reset: ResetGameWorldResult;
  /** Bootstrap summary counts (undefined if seedOnly: true). */
  bootstrap: Awaited<ReturnType<typeof bootstrapGameWorld>> | undefined;
  /** Officials seeded after the seed-only path (undefined otherwise). */
  postSeedOfficials: { officialsCreated: number; nppsCreated: number } | undefined;
  logs: string[];
}

export async function resetAndBootstrapGameWorld(
  options: ResetAndBootstrapOptions
): Promise<ResetAndBootstrapResult> {
  const {
    db,
    mode = "historical",
    preset,
    resetReference = true,
    deleteProfiles = false,
    skipRegionalCouncil = false,
    seedOnly = false,
    adminUsername,
    iteration,
  } = options;

  // Founding phase: explicit option wins; otherwise fall back to the preset's
  // intended default. Only a full historical bootstrap can run it — `seedOnly`
  // returns before the ensure* battery and `mode: "vacant"` seeds no candidate
  // pool, so in either case `preIteration.active` would be stamped with zero
  // cycle-0 races and `detectPreIterationComplete` (which needs at least one
  // RESOLVED founding race) could never end the phase, pinning the calendar to
  // the era start forever.
  const foundingEligible = !seedOnly && mode === "historical";
  const preIteration =
    foundingEligible && (options.preIteration ?? presetDefaultsToFoundingPhase(preset));
  const log = options.log ?? (() => {});
  const logs: string[] = [];
  const collect = (msg: string) => {
    logs.push(msg);
    log(msg);
  };

  if (preIteration) {
    collect(
      `Pre-iteration founding phase ON for ${preset}${
        options.preIteration === undefined ? " (preset default)" : " (explicit)"
      }: chambers seed vacant, a cycle-0 founding election seats them, and the ` +
        "calendar stays pinned to the era start until it resolves"
    );
  }

  // 0) Seal the world BEFORE anything is destroyed.
  //
  //    Both halves of this used to happen far too late. `enableMaintenanceMode`
  //    was step 4 — after reset AND bootstrap had both finished — and
  //    `isActive: false` was not written until resetGameWorld's final gameState
  //    update, roughly 150s into a 415s reset. So the 208-collection runtime
  //    wipe and the entire first country-seed pass ran against a world the turn
  //    cron still considered active (`cron.ts` gates on `isActive` alone) and
  //    that players could still load pages on.
  //
  //    ⚠️ Maintenance mode gates PAGE routes only — `src/proxy.ts` returns early
  //    for `/api/*`, so this stops players reaching the UI, not the API. The
  //    `isActive` clear is what actually stops the turn engine.
  //
  //    The seal survives the seeders only because `runSeed`'s reset branch no
  //    longer drops `gameConfig`; see RESET_DROP_COLLECTIONS in runCoreSeed.ts.
  await enableMaintenanceMode(db, {
    reason:
      "Game reset — fresh world being prepared. Site will reopen when admin verifies the new state.",
    enabledBy: adminUsername ?? "system",
  });
  //    ⚠️ Deliberately NOT an upsert. On an empty database this must match
  //    nothing: upserting would create a `gameState` doc holding only
  //    `isActive` and `updatedAt`, and `initializeGameState` returns any
  //    existing doc untouched — so the world would run forever on a gameState
  //    with no currentTurn, preset, or startingYear. A database with no
  //    gameState has no turn cron to stop anyway.
  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current" }, { $set: { isActive: false, updatedAt: new Date() } });
  collect("World sealed for reset — maintenance mode on, turn processing stopped");

  // 0b) Open the run's audit row NOW, before anything is destroyed.
  //
  //     This row used to be written in finalize, so a run that died in teardown
  //     or build left the world sealed and half-built with nothing recorded —
  //     the admin's live SSE log was the only evidence, and it dies with the
  //     browser tab. `adminLogs` is manifest category `preserved`, so the row
  //     survives the teardown it is recording.
  const run = createResetRunRecord(collect);
  let phaseReached = "seal";
  let aborted = false;
  let finalized: Awaited<ReturnType<typeof finalizeResetGameWorld>> | null = null;
  await openResetRunLog(db, run, { preset, mode, adminUsername });

  try {
    // 1) TEARDOWN. Wipes runtime state, retires or deletes characters, stamps the
    //    new clock. It does NOT seed: it used to call `seedAllCountryData` itself
    //    and step 2 then seeded the identical world a second time, measured at
    //    exactly 2.00x the write count on every collection that call touches.
    //
    //    We never seed historical officials here either — the bootstrap seeders
    //    re-create the default parties, so officials must follow them for party
    //    sequentialIds to line up.
    //
    //    `log` matters more than it looks: this phase used to run silently, so the
    //    SSE stream showed nothing until step 2 began. Its lines arrive tagged
    //    `[reset]` (see ResetGameWorldOptions.log).
    phaseReached = "teardown";
    const reset = await resetGameWorld(db, {
      deleteProfiles,
      preset,
      seedHistorical: false,
      adminUsername,
      iteration,
      preIteration,
      log: collect,
    });
    collect(reset.message);

    // 2) BUILD. `seedOnly` short-circuits before election + officials spawn.
    phaseReached = "build";
    const bootstrap = await bootstrapGameWorld({
      db,
      mode,
      preset,
      skipRegionalCouncil,
      resetReference,
      seedOnly,
      preIteration,
      log: collect,
      run,
    });

    // 2b) FINALIZE. The steps that need a fully-seeded world: default-party
    //     top-up, the party / charter / statePartyOrg cleanup, the demographics
    //     reset, the orphan region-row purge, the IMF placeholder, and the
    //     adminLog row. These used to live inside `resetGameWorld`, which is why
    //     it had to seed the world first. Two of them were being silently
    //     discarded there by bootstrap's own drops; their counts are honest for
    //     the first time here, so they are merged back into `reset.details` and
    //     the response shape is unchanged.
    //
    //     CONTAINED: a finalize failure leaves a seeded world, so it degrades the
    //     run to `partial` rather than throwing away a build that succeeded.
    phaseReached = "finalize";
    finalized = await run.step("finalize", "finalizeResetGameWorld", () =>
      finalizeResetGameWorld(db, {
        preset,
        teardown: reset.details,
        deleteProfiles,
        log: collect,
      })
    );
    if (finalized) {
      reset.details.demographicsReset = finalized.demographicsReset;
      reset.details.customPartiesDeleted = finalized.customPartiesDeleted;
      reset.details.partyOrgRecordsDeleted = finalized.partyOrgRecordsDeleted;
      reset.details.budgetSeedLog = finalized.finalizeLog;
    }

    // 3) Reset-only path: seed historical officials *after* reference is re-seeded.
    //    On the bootstrap path, bootstrapGameWorld already seeded them internally.
    let postSeedOfficials: ResetAndBootstrapResult["postSeedOfficials"];
    if (seedOnly) {
      phaseReached = "officials";
      // CONTAINED: the reference data is already re-seeded by this point, so a
      // failure here degrades the run rather than discarding it.
      const result = await run.step("officials", "seedHistoricalOfficials", () =>
        seedHistoricalOfficials(db, preset, preIteration ? "priors" : "winners")
      );
      if (result) {
        postSeedOfficials = result;
        collect(
          `Seeded historical officials: ${result.officialsCreated} officials, ${result.nppsCreated} NPPs`
        );
      }
    }

    // 4) Seal the freshly-reset world behind maintenance mode, then run the
    //    seed conformance diagnostic while sealed. Diagnostic failure must NEVER
    //    abort the reset — wrap in try/catch and surface diagnostic_error.
    await enableMaintenanceMode(db, {
      reason:
        "Game reset — fresh world being prepared. Site will reopen when admin verifies the new state.",
      enabledBy: adminUsername ?? "system",
    });
    collect("Maintenance mode enabled — site sealed until admin toggles it off");

    if (!options.skipDiagnostic) {
      try {
        const { runSeedDiagnostic, formatDiagnosticSummary, captureSeedBaseline } =
          await import("@/lib/admin/seedDiagnostic");
        const report = await runSeedDiagnostic(db, {
          mode: "conformance",
          trigger: "post-reset",
          preset,
        });
        collect(formatDiagnosticSummary(report));
        // A `partial` run means at least one seeder was contained, so the world is
        // knowingly incomplete. Capturing a baseline from it would make every
        // future drift check compare against a broken reference — the same reason a
        // critical finding skips capture.
        if (report.summary.critical === 0 && run.status(false) === "succeeded") {
          await captureSeedBaseline(db);
          collect("Seed diagnostic baseline captured");
        } else if (run.status(false) !== "succeeded") {
          collect(
            `Seed diagnostic: skipped baseline capture (${run.failures.length} contained failure(s))`
          );
        } else {
          collect(
            `Seed diagnostic: skipped baseline capture (${report.summary.critical} critical check(s))`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        collect(`Seed diagnostic failed: ${message}`);
        try {
          const { diagnosticErrorReport } = await import("@/lib/admin/seedDiagnostic");
          const errorReport = diagnosticErrorReport(message, {
            preset,
            trigger: "post-reset",
          });
          await db.collection("seedDiagnostics").insertOne(errorReport as never);
        } catch {
          // Persistence of the error report is best-effort.
        }
      }
    } else {
      collect("Skipped operator seed audit for isolated singleplayer world");
    }

    phaseReached = "complete";
    return { reset, bootstrap, postSeedOfficials, logs };
  } catch (error) {
    aborted = true;
    collect(
      `Reset ABORTED in ${phaseReached}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  } finally {
    const status = run.status(aborted);
    if (status === "partial") {
      collect(
        `Reset completed PARTIAL — ${run.failures.length} step(s) contained: ` +
          run.failures.map((f) => `${f.phase}/${f.name}`).join(", ") +
          ". The world is knowingly incomplete; no seed baseline was captured."
      );
    }
    // Always closed, on every path. `closeResetRunLog` is best-effort inside,
    // so a bookkeeping failure can never replace the reset's real error.
    await closeResetRunLog(db, run, {
      status: run.status(aborted),
      phaseReached,
      details: finalized?.adminDetails ?? `Reset ${run.status(aborted)} in ${phaseReached}`,
      logs,
      deleteProfiles,
      adminUsername,
    });
  }
}
