import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { ObjectId } from "mongodb";
import { getGameState, invalidateGameStateCache } from "@/lib/gameState";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type {
  GameConfig,
  GameState,
  TurnLog,
  GameIteration,
  TurnPhaseTelemetryMap,
} from "@/lib/db/types";
import { invalidateGameTimeCache, reconcileGameStateClock } from "@/lib/time/gameTime";
import { emit } from "@/lib/events";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { recordPrimarySnapshots } from "@/lib/turn/primaryResolution";
import {
  ensurePerpetualElections,
  ensureUKElections,
  ensureUKRegionalCouncilElections,
} from "@/lib/turn/perpetualElections";
import { STARTING_YEAR, MS_PER_TURN } from "@/lib/constants/turnTime";
import { yearOfTurn } from "@/lib/utils/gameDate";
import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";
import { seedUnownedSectors } from "@/lib/admin/seed/seedUnownedSectors";
import { processGameHealthSnapshot } from "@/lib/turn/gameHealthSnapshot";
import { TURN_LOCK_STALE_MS, shouldRecoverCrashedTurn } from "@/lib/turn/processingLock";
import { getLatestCompletedTurnRealTime } from "@/lib/turn/turnLogQueries";
import { isAutoPauseDrift, formatDriftHours } from "@/lib/time/clockDrift";
import {
  createInitialTurnPhaseStatuses,
  finalizeAbortedPhaseStatuses,
} from "@/simulation/engine/phaseTelemetry";
import { formatRoundTripReport, withPhaseProfiling } from "@/lib/observability/mongoRoundTrips";
import { createTurnPhaseRuntime } from "@/simulation/engine/turnPhaseRuntime";
import { buildTurnExecutionContext } from "@/simulation/engine/turnExecutionContext";
import { getTurnPhaseRegistry } from "@/simulation/phases/turnPhaseRegistry";
import { getSimTurnPhasePredicate } from "@/simulation/phases/simTurnProfiles";
import {
  combinePhasePredicates,
  getSingleplayerPhasePredicate,
} from "@/simulation/phases/singleplayerPhases";
import { getAnomalyScanCadencePredicate } from "@/simulation/phases/anomalyScanCadence";
import { isSingleplayer } from "@/lib/singleplayer";
import { reconcileFederalBudgetInvariants } from "@/lib/budget/budgetInvariants";

// Re-export public helpers consumed by other modules
export {
  recordPrimarySnapshots,
  resolveGeneralElections,
  ensurePerpetualElections,
  ensureUKElections,
  ensureUKRegionalCouncilElections,
};
export { getGameState, invalidateGameStateCache };

// ─── Game state helpers ───────────────────────────────────────────────────────

// Compatibility exports live above; turn orchestration state begins below.

export async function initializeGameState(): Promise<GameState> {
  const db = await getDb();
  const existing = await getGameState(db);
  if (existing) return existing;

  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  const initialState: GameState = {
    _id: "current",
    currentTurn: 1,
    currentYear: STARTING_YEAR,
    // Always pair `startingYear` with the matching `preset`. Writing only
    // `startingYear` previously left `preset` undefined, which made
    // `cycleAnchorContextFromGameState` silently fall back to 2019-default
    // even when the row's `startingYear` was updated to 1991 — producing
    // the "2023 NPC Delegate in a 1991 game" symptom on sandbox.
    // `resetGameWorld` still overwrites both when an admin selects a preset.
    startingYear: DEFAULT_CYCLE_ANCHOR_CONTEXT.startingYear,
    preset: DEFAULT_CYCLE_ANCHOR_CONTEXT.preset,
    isActive: false,
    lastTurnProcessed: now,
    nextScheduledTurn: nextHour,
    pausedAt: null,
    corporationActionsPaused: false,
    playerTransfersPaused: false,
    fastMode: false,
    processingKind: null,
    processingStartedAt: null,
    processingTargetTurn: null,
    processingHeartbeatAt: null,
    processingPhase: null,
    processingPhaseStatuses: null,
    createdAt: now,
    updatedAt: now,
    // Fresh worlds start with the production feature-flag posture instead of
    // everything-off (see featureFlagDefaults.ts for the rationale).
    ...DEFAULT_GAME_STATE_FLAGS,
  };

  const gameStateCol = await getGameStateCollection(db);
  await gameStateCol.insertOne(initialState);
  return initialState;
}

// ─── Main turn processor ─────────────────────────────────────────────────────

// True only while THIS process holds the turn-processing lock. Used by the
// graceful-shutdown handler (src/lib/turn/shutdownHandler.ts) to release the
// lock when Railway sends SIGTERM mid-turn on a redeploy — otherwise the lock
// strands with a frozen heartbeat and no turn runs until the 20-min stale
// takeover on a later cron tick (2026-07 stuck-turn incident). Scoping the
// release to the acquiring process makes it safe across concurrent containers:
// a process never clears a lock it did not set.
let localTurnLockHeld = false;

/**
 * Best-effort release of a turn-processing lock held by THIS process. No-op if
 * this process does not currently hold the lock. Called on graceful shutdown so
 * a redeploy mid-turn recovers instantly instead of waiting out the stale TTL.
 * Guarded by `isProcessing: true` so it never resurrects a lock a newer process
 * already re-acquired and cleared.
 */
export async function releaseLocalProcessingLock(reason: string): Promise<boolean> {
  if (!localTurnLockHeld) return false;
  try {
    const db = await getDb();
    await db.collection<GameState>("gameState").updateOne(
      { _id: "current", isProcessing: true },
      {
        $set: {
          isProcessing: false,
          processingKind: null,
          processingStartedAt: null,
          processingTargetTurn: null,
          processingHeartbeatAt: null,
          processingPhase: null,
          processingPhaseStatuses: null,
          updatedAt: new Date(),
        },
      }
    );
    localTurnLockHeld = false;
    invalidateGameStateCache();
    console.warn(`[Turn System] Released in-flight processing lock on ${reason}.`);
    return true;
  } catch (err) {
    console.error(`[Turn System] Failed to release processing lock on ${reason}:`, err);
    Sentry.captureException(err, {
      tags: { component: "turnSystem", op: "shutdownLockRelease" },
    });
    return false;
  }
}

export async function processTurn(): Promise<{
  success: boolean;
  turn: number;
  message: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const startTime = Date.now();
  let activeTurn = 0;
  let activeGameNow: Date | null = null;
  let activeCurrentYear = STARTING_YEAR;
  let activeIteration: GameIteration | undefined;
  const currentPhaseRef = { current: null as string | null };
  let phaseStatusesForFailure: TurnPhaseTelemetryMap | null = null;
  let phaseResultsForFailure: TurnLog["phases"] | null = null;
  let turnLogWritten = false;
  let healthSnapshotWritten = false;
  // #2815: if the previous lock holder died mid-turn (after phases began
  // committing writes), we must NOT re-run that turn — that would double-apply
  // committed income phases. Captured from the pre-lock snapshot, acted on once
  // we hold the lock.
  let crashedTurnRecovery: { targetTurn: number; lastPhase: string } | null = null;

  try {
    const db = await getDb();
    const localSingleplayer = isSingleplayer();
    const lockAcquiredAt = new Date();
    const staleLockCutoff = new Date(lockAcquiredAt.getTime() - TURN_LOCK_STALE_MS);

    // Auto-pause guard: if wall-clock time since the last *completed* turn (by
    // turnLog.realTime) exceeds AUTO_PAUSE_DRIFT_MS, cron has stopped firing.
    // Use realTime — not lastTurnProcessed (game/LARP clock) — so a steady
    // game-clock offset after an old outage does not false-positive while
    // hourly cron is still healthy. See docs/plans/archive/2026-05/2026-05-20-clock-mismatch-design.md.
    {
      const preLockState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      // SIM-ONLY: the drift guard below models a LIVE deployment where an hourly
      // cron is supposed to be firing, so a long gap means it stopped. A headless
      // sandbox world has no cron at all — its turns are driven by runWorld.ts as
      // fast as the CPU allows — so "wall-clock time since the last completed
      // turn" measures nothing but how long ago someone last ran the sim.
      //
      // Resuming an existing sandbox world therefore trips this guard on its
      // FIRST turn essentially always: the world was last touched hours or days
      // ago. That is a hard failure at turn N+1 (runWorld exits 1) for a reason
      // that has nothing to do with the sim. It bit a 500-turn 1953 run on the
      // ops box on 2026-07-28, and it would bite every resumed run on a laptop,
      // which sleeps by definition.
      //
      // Undefined in production (runWorld.ts is the only writer), so this is
      // inert there — the same shape as simTurnPhaseMode below.
      // A singleplayer world only advances when the player asks it to, so a
      // gap of days between turns is the normal case, not a dead cron.
      const simSandbox =
        localSingleplayer ||
        (await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }))?.simSandbox ===
          true;
      if (preLockState) {
        // #2815: detect a stale lock left by a turn that crashed after phases
        // began applying writes. Recorded here; the recovery close-out runs
        // after we acquire the lock (and re-verifies against the locked state).
        if (
          shouldRecoverCrashedTurn(preLockState, lockAcquiredAt) &&
          typeof preLockState.processingTargetTurn === "number" &&
          typeof preLockState.processingPhase === "string"
        ) {
          crashedTurnRecovery = {
            targetTurn: preLockState.processingTargetTurn,
            lastPhase: preLockState.processingPhase,
          };
        }
        const lastTp = new Date(preLockState.lastTurnProcessed);
        const latestCronFire = localSingleplayer
          ? null
          : await getLatestCompletedTurnRealTime(preLockState);
        const rawAnchor = latestCronFire ?? lastTp;
        // Floor the drift anchor at the most recent resume. Without this floor,
        // the first turn after a long manual pause sees drift = entire pause
        // duration (e.g. 149h) and trips the 4h auto-pause guard immediately,
        // re-pausing the cron the moment the admin tried to start it.
        const resumeAnchor = preLockState.lastResumedAt
          ? new Date(preLockState.lastResumedAt)
          : null;
        const cronAnchor =
          resumeAnchor && resumeAnchor.getTime() > rawAnchor.getTime() ? resumeAnchor : rawAnchor;
        const cronDriftMs = lockAcquiredAt.getTime() - cronAnchor.getTime();
        const isBootstrap = preLockState.currentTurn <= 1 || lastTp.getFullYear() < 2020;
        const heartbeatAt = preLockState.processingHeartbeatAt
          ? new Date(preLockState.processingHeartbeatAt).getTime()
          : 0;
        const hasHealthyInFlightTurn =
          preLockState.isProcessing === true &&
          heartbeatAt > lockAcquiredAt.getTime() - TURN_LOCK_STALE_MS;
        if (
          !simSandbox &&
          !preLockState.pausedAt &&
          !isBootstrap &&
          !hasHealthyInFlightTurn &&
          isAutoPauseDrift(cronDriftMs)
        ) {
          await db.collection<GameState>("gameState").updateOne(
            { _id: "current" },
            {
              $set: {
                isActive: false,
                pausedAt: lockAcquiredAt,
                pauseReason: `Auto-paused: no turn completed in ${formatDriftHours(cronDriftMs)} (cron may have stopped)`,
                pauseKind: "auto-drift",
                updatedAt: lockAcquiredAt,
              },
            }
          );
          invalidateGameStateCache();
          invalidateGameTimeCache();
          Sentry.captureMessage("Cron auto-paused due to drift", {
            level: "error",
            extra: {
              cronDriftMs,
              cronDriftHours: cronDriftMs / 3_600_000,
              lastTurnProcessed: preLockState.lastTurnProcessed,
              latestCompletedTurnRealTime: latestCronFire,
            },
          });
          console.error(
            `[Turn System] Auto-paused: no completed turn in ${formatDriftHours(cronDriftMs)}. Admin must investigate before resuming.`
          );
          return {
            success: false,
            turn: 0,
            message: `Auto-paused: no completed turn in ${formatDriftHours(cronDriftMs)}`,
            warnings: [],
          };
        }
      }
    }

    const unownedCount = await db.collection("unownedSectors").countDocuments();
    if (unownedCount === 0) {
      // Seed at the WORLD's era. This used to ride the seeder's "2019-default"
      // parameter default, so a 1953 world auto-seeded modern sector floors
      // mid-turn.
      await seedUnownedSectors(
        db,
        (msg) => console.log(`[Turn] Auto-seed: ${msg}`),
        1,
        await getGameStatePresetOrDefault(db)
      );
    }

    const lockResult = await db.collection<GameState>("gameState").findOneAndUpdate(
      {
        _id: "current",
        $or: [
          { isProcessing: { $ne: true } },
          { processingHeartbeatAt: { $lt: staleLockCutoff } },
          {
            processingHeartbeatAt: { $exists: false },
            updatedAt: { $lt: staleLockCutoff },
          },
        ],
      },
      {
        $set: {
          isProcessing: true,
          processingKind: "turn",
          processingStartedAt: lockAcquiredAt,
          processingTargetTurn: null,
          processingHeartbeatAt: lockAcquiredAt,
          processingPhase: "turn_bootstrap",
          processingPhaseStatuses: null,
        },
      },
      { returnDocument: "after" }
    );
    if (!lockResult) {
      console.log("[Turn] Skipping - another turn is already processing");
      return {
        success: true,
        turn: 0,
        message: "Skipped: concurrent turn in progress",
        warnings: [],
      };
    }

    // This process now owns the lock — allow graceful shutdown to release it.
    localTurnLockHeld = true;

    const gameState = lockResult;
    activeIteration = gameState.iteration ? { ...gameState.iteration } : undefined;

    // #2815: the previous holder died mid-turn after phases began committing.
    // Re-running would double-apply the income phases it already committed, so
    // consume the turn number instead of re-executing it: advance the clock
    // past the crashed turn and skip. The race guard (target === currentTurn+1
    // against the freshly locked state) ensures a concurrent completion between
    // the pre-lock read and lock acquisition can't cause a spurious skip.
    if (crashedTurnRecovery && crashedTurnRecovery.targetTurn === gameState.currentTurn + 1) {
      const recoveredTurn = crashedTurnRecovery.targetTurn;
      const startingYear = gameState.startingYear ?? STARTING_YEAR;
      // Same offset-aware year `reconcileGameStateClock` computes — deriving it
      // from the raw turn wrote a year AHEAD of the calendar on a world with a
      // founding phase, and every direct `gameState.currentYear` reader (the
      // cabinet roster gate among them) saw it until the next turn repaired it
      // (#1208).
      const recoveredYear = yearOfTurn(recoveredTurn, startingYear, {
        preIterationActive: gameState.preIteration?.active,
        preIterationTurns: gameState.preIterationTurns,
      });
      // Advance the game clock by exactly one turn (as a normal completion would),
      // so currentTurn and lastTurnProcessed stay in lockstep and don't drift a
      // turn apart at year boundaries.
      const recoveredLastTurnProcessed = new Date(
        new Date(gameState.lastTurnProcessed).getTime() + MS_PER_TURN
      );
      await db.collection<GameState>("gameState").updateOne(
        { _id: "current" },
        {
          $set: {
            // reconcileGameStateClock uses max(currentTurn, latestLog.turn), so
            // this only moves the pointer forward and is never repaired back.
            currentTurn: recoveredTurn,
            currentYear: recoveredYear,
            lastTurnProcessed: recoveredLastTurnProcessed,
            isProcessing: false,
            processingKind: null,
            processingStartedAt: null,
            processingTargetTurn: null,
            processingHeartbeatAt: null,
            processingPhase: null,
            processingPhaseStatuses: null,
            updatedAt: lockAcquiredAt,
          },
        }
      );
      localTurnLockHeld = false;
      invalidateGameTimeCache();
      invalidateGameStateCache();
      const message =
        `Recovered crashed turn ${recoveredTurn}: skipped re-run to prevent double-apply ` +
        `(previous holder died at phase "${crashedTurnRecovery.lastPhase}")`;
      console.warn(`[Turn System] ${message}`);
      Sentry.captureMessage("Turn recovery: skipped re-run to prevent double-apply", {
        level: "warning",
        fingerprint: ["turn-crash-recovery"],
        extra: { recoveredTurn, lastPhase: crashedTurnRecovery.lastPhase },
      });
      return { success: false, turn: recoveredTurn, message, warnings: [message] };
    }

    const repairedClock = await reconcileGameStateClock(gameState);
    gameState.currentTurn = repairedClock.currentTurn;
    gameState.currentYear = repairedClock.currentYear;
    gameState.lastTurnProcessed = repairedClock.lastTurnProcessed;

    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    const phaseStatuses = createInitialTurnPhaseStatuses();
    phaseStatusesForFailure = phaseStatuses;
    currentPhaseRef.current = "turn_bootstrap";

    const nextTurnNumber = gameState.currentTurn + 1;
    await db.collection<GameState>("gameState").updateOne(
      { _id: "current", isProcessing: true },
      {
        $set: {
          processingTargetTurn: nextTurnNumber,
          processingPhaseStatuses: phaseStatuses,
          updatedAt: lockAcquiredAt,
        },
      }
    );

    // Bracketed so its reads are attributable: turn setup runs before the
    // first phase, and was the largest single bucket in the round-trip profile
    // only because nothing named it.
    const context = await withPhaseProfiling("turnSetup", () =>
      buildTurnExecutionContext({
        db,
        gameState,
        config,
        warnings,
        activeIteration,
        phaseStatuses,
        startTimeMs: startTime,
      })
    );
    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
      // SIM-ONLY: sandbox worldsim can set gameConfig.simTurnPhaseMode to skip
      // the economy phases. Undefined in prod (config?.simTurnPhaseMode absent) →
      // full turn, unchanged.
      // Singleplayer skips the anti-abuse scans: one account with cheat
      // commands available by design has no one to defraud, and the scans were
      // ~18% of every document a turn deserializes. Composed with the sim
      // profile predicate so a headless sim run keeps its own filtering.
      // In a shared world the same scans run on a cadence instead of every
      // turn; their rolling windows make that lossless.
      shouldRunPhase: combinePhasePredicates(
        getSimTurnPhasePredicate(config?.simTurnPhaseMode),
        getSingleplayerPhasePredicate(localSingleplayer),
        getAnomalyScanCadencePredicate(gameState.currentTurn)
      ),
      // Audit traceId convention "turn:<n>:<phase>" (forensics plan §3.1, T2.7).
      turn: nextTurnNumber,
    });

    activeTurn = context.newTurn;
    activeCurrentYear = context.currentYear;
    activeGameNow = context.gameNow;
    phaseResultsForFailure = context.phaseResults;

    emit({
      type: "turn_start",
      payload: { turn: context.newTurn },
      timestamp: new Date().toISOString(),
    });

    for (const adapter of getTurnPhaseRegistry()) {
      await adapter.execute(context, runtime);
    }

    // Reconciles, never throws. `federalBudget.surplus` and `debt.principal` are
    // caches of an expression, and both drift intra-year on the live world even
    // though every writer maintains them on its own write. This used to only log
    // the drift, which was wrong: the stored `surplus` gates treasury transfers
    // against the debt ceiling and sizes sovereign bond issuance, so a stale cache
    // is wrong money rather than noise. Runs HERE, after every phase, because live
    // `updatedAt` values show budget writes landing well after the corporation
    // phase that recomputes them. See lib/budget/budgetInvariants.
    if (!localSingleplayer) {
      await reconcileFederalBudgetInvariants(db, context.newTurn);
    }

    healthSnapshotWritten = context.phaseResults.gameHealthSnapshot !== null;

    const compactPhaseTimings = Object.entries(phaseStatuses)
      .flatMap(([phase, status]) => {
        if (!status.startedAt || !status.completedAt) return [];
        return [{ phase, durationMs: status.completedAt.getTime() - status.startedAt.getTime() }];
      })
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5);
    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      {
        $set: {
          currentTurn: context.newTurn,
          currentYear: context.currentYear,
          lastTurnProcessed: context.gameNow,
          nextScheduledTurn: gameState.isActive ? context.nextTurnTime : null,
          isProcessing: false,
          processingKind: null,
          processingStartedAt: null,
          processingTargetTurn: null,
          processingHeartbeatAt: null,
          processingPhase: null,
          processingPhaseStatuses: null,
          updatedAt: context.realNow,
          ...(localSingleplayer
            ? {
                singleplayerTurnMetrics: {
                  turn: context.newTurn,
                  durationMs: Date.now() - startTime,
                  success: warnings.length === 0,
                  warningCount: warnings.length,
                  slowestPhases: compactPhaseTimings,
                },
              }
            : {}),
        },
      }
    );
    localTurnLockHeld = false;

    invalidateGameTimeCache();
    invalidateGameStateCache();

    const turnLog: Omit<TurnLog, "_id"> = {
      turn: context.newTurn,
      year: context.currentYear,
      ...(activeIteration ? { iteration: activeIteration } : {}),
      gameTime: context.gameNow,
      realTime: context.realNow,
      durationMs: Date.now() - startTime,
      success: warnings.length === 0,
      warnings,
      phaseStatuses,
      phases: context.phaseResults,
      createdAt: context.realNow,
    };
    if (!localSingleplayer) {
      await db.collection<TurnLog>("turnLogs").insertOne(turnLog as TurnLog);
      turnLogWritten = true;
    }

    emit({
      type: "turn_complete",
      payload: { turn: context.newTurn, warnings: warnings.length },
      timestamp: context.realNow.toISOString(),
    });

    const warningsSuffix = warnings.length > 0 ? ` (${warnings.length} warning(s))` : "";
    const nppActions = context.phaseResults.nppActionProcessing;
    const nppSuffix = nppActions
      ? `, NPP actions: ${nppActions.actionsExecuted}/${nppActions.nppsProcessed} (build:${nppActions.buildDonorBase} camp:${nppActions.campaign} adv:${nppActions.advertise} donate:${nppActions.partyDonation} skip:${nppActions.skipped})`
      : "";
    // Per-phase Mongo round-trip profile (AHD_TURN_ROUNDTRIP_PROFILE=1).
    // Turn cost on production is round-trip bound, so this ranks phases by
    // the thing that actually costs, not by local wall clock.
    const roundTripProfile = formatRoundTripReport();
    if (roundTripProfile) console.log(roundTripProfile);
    console.log(
      `[Turn] #${context.newTurn} - ${context.characters.length} chars, $${context.phaseResults.fundGeneration?.totalGenerated?.toLocaleString() ?? "?"} generated, ${context.phaseResults.partyActions?.totalActionsGenerated ?? "?"} party actions generated, ${context.phaseResults.campaignTurn?.campaignsProcessed ?? "?"} campaigns ($${context.phaseResults.campaignTurn?.totalFundsGenerated?.toLocaleString() ?? "?"} funds, ${context.phaseResults.campaignTurn?.totalActionsGenerated ?? "?"} actions), ${context.phaseResults.partyElections?.stateElectionsCompleted ?? "?"} state elections completed${nppSuffix}${warningsSuffix}`
    );

    const durationMs = Date.now() - startTime;
    console.info("[Turn] Completed", {
      turn: context.newTurn,
      durationMs,
      characters: context.characters.length,
      warnings: warnings.length,
      fundsGenerated: context.phaseResults.fundGeneration?.totalGenerated ?? 0,
      campaignsProcessed: context.phaseResults.campaignTurn?.campaignsProcessed ?? 0,
      electionsCompleted: context.phaseResults.partyElections?.stateElectionsCompleted ?? 0,
    });

    return {
      success: warnings.length === 0,
      turn: context.newTurn,
      message:
        warnings.length === 0
          ? `Turn ${context.newTurn} processed successfully. ${context.characters.length} characters received action points.`
          : `Turn ${context.newTurn} processed with ${warnings.length} warning(s). ${context.characters.length} characters received action points.`,
      warnings,
    };
  } catch (error) {
    console.error("[Turn System] Critical error processing turn:", error);
    Sentry.captureException(error, { tags: { component: "turnSystem" } });
    const failureTime = new Date();
    const failureMessage =
      error instanceof Error ? error.message : "Unknown error during turn processing";

    if (!warnings.some((warning) => warning === `turnSystem: ${failureMessage}`)) {
      warnings.push(`turnSystem: ${failureMessage}`);
    }

    try {
      const db = await getDb();
      const finalizedPhaseStatuses = phaseStatusesForFailure
        ? finalizeAbortedPhaseStatuses(
            phaseStatusesForFailure,
            currentPhaseRef.current,
            failureTime,
            failureMessage
          )
        : null;

      await db.collection<GameState>("gameState").updateOne(
        { _id: "current" },
        {
          $set: {
            isProcessing: false,
            processingKind: null,
            processingHeartbeatAt: failureTime,
            processingPhase: currentPhaseRef.current,
            processingTargetTurn: activeTurn > 0 ? activeTurn : null,
            processingPhaseStatuses: finalizedPhaseStatuses,
            updatedAt: failureTime,
          },
        }
      );
      localTurnLockHeld = false;

      if (
        !isSingleplayer() &&
        finalizedPhaseStatuses &&
        phaseResultsForFailure &&
        activeTurn > 0 &&
        !healthSnapshotWritten
      ) {
        try {
          await processGameHealthSnapshot(
            db,
            activeTurn,
            activeCurrentYear,
            Date.now() - startTime,
            false,
            [...warnings],
            finalizedPhaseStatuses
          );
        } catch (snapshotError) {
          console.warn("[Turn] Failed to persist crash health snapshot", snapshotError);
          Sentry.captureException(snapshotError, {
            extra: { component: "turnCrashHealthSnapshot", turn: activeTurn },
          });
        }
      }

      if (
        !isSingleplayer() &&
        finalizedPhaseStatuses &&
        phaseResultsForFailure &&
        activeTurn > 0 &&
        !turnLogWritten
      ) {
        const crashTurnLog: Omit<TurnLog, "_id"> = {
          turn: activeTurn,
          year: activeCurrentYear,
          ...(activeIteration ? { iteration: activeIteration } : {}),
          gameTime: activeGameNow ?? failureTime,
          realTime: failureTime,
          durationMs: Date.now() - startTime,
          success: false,
          warnings: [...warnings],
          phaseStatuses: finalizedPhaseStatuses,
          phases: phaseResultsForFailure,
          createdAt: failureTime,
        };
        await db.collection<TurnLog>("turnLogs").insertOne(crashTurnLog as TurnLog);
      }
    } catch (releaseError) {
      // If we can't release the lock here it will be reclaimed by the 20-min
      // stale takeover on a later cron tick — but surface it rather than
      // swallow, since a silently-stranded lock is exactly what wedged turns in
      // the 2026-07 incident. Do NOT clear localTurnLockHeld: keeping it set
      // lets the graceful-shutdown handler retry the release on exit.
      console.error("[Turn System] Failed to release lock after turn error:", releaseError);
      Sentry.captureException(releaseError, {
        tags: { component: "turnSystem", op: "lockReleaseAfterError" },
      });
    }

    return {
      success: false,
      turn: 0,
      message: `Failed to process turn: ${error instanceof Error ? error.message : "Unknown error"}`,
      warnings,
    };
  }
}

export async function startTurnSystem(): Promise<{ success: boolean; message: string }> {
  try {
    const db = await getDb();
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);

    // Deadlines are turn-based, so resuming after a pause needs no Date-shift:
    // frozen turns kept every countdown frozen. (Phase 5 removed shiftDeadlinesOnResume.)
    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      {
        $set: {
          isActive: true,
          nextScheduledTurn: nextHour,
          pausedAt: null,
          pauseReason: null,
          pauseKind: null,
          lastResumedAt: now,
          updatedAt: now,
        },
      }
    );

    invalidateGameStateCache();
    console.log(`[Turn System] Started. Next turn at ${nextHour.toISOString()}`);
    return {
      success: true,
      message: `Turn system started. Next turn at ${nextHour.toLocaleTimeString()}.`,
    };
  } catch (error) {
    console.error("[Turn System] Error starting:", error);
    Sentry.captureException(error, { tags: { component: "turnSystem", op: "start" } });
    return {
      success: false,
      message: `Failed to start: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function stopTurnSystem(): Promise<{ success: boolean; message: string }> {
  try {
    const db = await getDb();
    const now = new Date();
    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      {
        $set: {
          isActive: false,
          nextScheduledTurn: null,
          pausedAt: now,
          pauseReason: "Paused by admin",
          pauseKind: "manual",
          updatedAt: now,
        },
      }
    );
    invalidateGameStateCache();
    console.log("[Turn System] Stopped at", now.toISOString());
    return { success: true, message: "Turn system stopped successfully. Election timers paused." };
  } catch (error) {
    console.error("[Turn System] Error stopping:", error);
    Sentry.captureException(error, { tags: { component: "turnSystem", op: "stop" } });
    return {
      success: false,
      message: `Failed to stop: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ─── Fast mode toggle ─────────────────────────────────────────────────────────

export async function toggleFastMode(): Promise<{
  success: boolean;
  message: string;
  fastMode: boolean;
}> {
  try {
    const db = await getDb();
    const gameState = await getGameState(db);

    if (!gameState) {
      return { success: false, message: "Game state not found", fastMode: false };
    }

    const newFastModeState = !gameState.fastMode;

    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        { $set: { fastMode: newFastModeState, updatedAt: new Date() } }
      );

    invalidateGameStateCache();

    // Restart cron with new schedule
    const { restartCronWithSchedule } = await import("./cron");
    await restartCronWithSchedule();

    console.log(`[Turn System] Fast mode ${newFastModeState ? "enabled" : "disabled"}`);
    return {
      success: true,
      message: `Fast mode ${newFastModeState ? "enabled" : "disabled"}. Turns will run ${newFastModeState ? "every 30 minutes" : "every hour"}.`,
      fastMode: newFastModeState,
    };
  } catch (error) {
    console.error("[Turn System] Error toggling fast mode:", error);
    Sentry.captureException(error, { tags: { component: "turnSystem", op: "toggleFastMode" } });
    return {
      success: false,
      message: `Failed to toggle fast mode: ${error instanceof Error ? error.message : "Unknown error"}`,
      fastMode: false,
    };
  }
}

// Keep ObjectId in scope for any callers that import it via turnSystem
export { ObjectId };
