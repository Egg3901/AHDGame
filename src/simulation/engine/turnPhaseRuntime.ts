import * as Sentry from "@sentry/nextjs";
import type {
  GameState,
  TurnPhaseExecutionStatus,
  TurnPhaseSkipReason,
  TurnPhaseTelemetry,
  TurnPhaseTelemetryMap,
} from "@/lib/db/types";
import type { Db } from "mongodb";
import { createTurnPhaseTelemetry } from "@/simulation/engine/phaseTelemetry";
import {
  beginPhaseProfiling,
  endPhaseProfiling,
  phaseRoundTrips,
  phaseTopCollectionsByRoundTrips,
  roundTripCountsAvailable,
} from "@/lib/observability/mongoRoundTrips";
import { roundTripBudgetFor } from "./turnPhaseBudgets";
import { discardPhaseSubsteps, takePhaseSubsteps } from "@/lib/observability/phaseSubsteps";
import { withSpan } from "@/lib/observability/spans";
import type { CompletedTurnPhaseObservation, TurnPhaseRuntime } from "@/simulation/engine/types";
import { TURN_LOCK_HEARTBEAT_MS, PHASE_TIMEOUT_MS } from "@/lib/turn/processingLock";
import { recordAudit } from "@/lib/audit/recordAudit";
import { runInAuditContext, turnPhaseTraceId } from "@/lib/observability/context";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";
import {
  encodeResumeResult,
  phaseRequiresResumeResult,
  TurnPhaseCompletionPersistError,
  TurnResumeResultUnavailableError,
  type CrashedTurnPhaseState,
  type ResumeResultOutcome,
} from "./turnPhaseResumeResults";

/**
 * Phases that only READ state to produce a derivative/historical record
 * (snapshots, scans, telemetry) rather than mutate live game entities. Kept
 * out of the coarse per-phase audit envelope below — auditing the audit/
 * telemetry machinery itself would be noise, not forensic signal (forensics
 * plan §3.1/§4 T2.7). Curated by name against `BASE_TURN_PHASE_NAMES`
 * (`src/simulation/phases/turnPhaseNames.ts`, not modified here) — every
 * `*Snapshot` phase plus the existing scan/detection/logging/reconcile
 * phases. Everything else that reaches `runPhase` is treated as mutating.
 */
/** Phases below this many round trips do not record their top collections. */
export const TOP_COLLECTIONS_MIN_ROUND_TRIPS = 100;

const READ_ONLY_PHASES = new Set<string>([
  "financialSuspectScan",
  "activityLogging",
  "auditAnomalyScan",
  "suspiciousDetection",
  "gameHealthSnapshot",
  "ledgerPreForexSnapshot",
  "ledgerBalanceSnapshot",
  "ledgerReconcile",
  "metricHistory",
  "approvalSnapshot",
  "interestRateSnapshot",
  "partyHistorySnapshot",
  "researchTelemetry",
  "portfolioSnapshot",
  "corpPortfolioSnapshot",
  "stockExchangeSnapshot",
  "investorRankingSnapshot",
  "wealthListSnapshot",
]);

/** Best-effort, cheap-only summary counts for the coarse phase envelope —
 * never inspects per-entity data, just whatever shape `fn()` already
 * returned (a count, an array length, or a `{count|length|processed}`
 * field on a result object). */
function cheapPhaseResultMeta(result: unknown): Record<string, unknown> | undefined {
  if (result == null) return undefined;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result === "number") return { count: result };
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.count === "number") return { count: r.count };
    if (typeof r.length === "number") return { count: r.length };
    if (typeof r.processed === "number") return { count: r.processed };
  }
  return undefined;
}

// Rust-ladder L0: the per-phase gameState write in setPhaseStatus exists ONLY to
// feed the live turn-progress overlay (api/game/turn/status) — the durable
// turnLog.phaseStatuses is built from the in-memory `phaseStatuses` map, not from
// these writes, and lock-staleness is guarded by processingHeartbeatAt which the
// 30s heartbeat timer keeps fresh regardless. A turn fires ~2 transitions ×
// ~166 phases = ~330 of these updateOnes, each a Mongo round-trip; on a remote
// primary that is seconds of pure telemetry overhead. So we COALESCE them: the
// in-memory map is always updated (turnLog stays exact), but the DB flush is
// throttled to at most once per window. Terminal/abnormal transitions
// (failed/skipped) always flush so problems surface promptly, and the 30s
// heartbeat call (interval >> window) always flushes so the lock never goes
// stale. Net effect on the overlay: it advances every ~throttle window instead
// of every phase — imperceptible on a multi-second turn.
const PHASE_STATUS_FLUSH_THROTTLE_MS = 1500;

export function createTurnPhaseRuntime(input: {
  db: Pick<Db, "collection">;
  phaseStatuses: TurnPhaseTelemetryMap;
  warnings: string[];
  currentPhaseRef: { current: string | null };
  /**
   * Phase names a crashed previous holder already applied, for a resumed turn. Empty
   * or absent on every normal turn. See the resume gate in `runPhase`.
   */
  alreadyApplied?: Set<string>;
  /**
   * How the dead holder left each applied phase, plus the stored results of
   * completed phases a later phase consumes (#3429). Absent on a normal turn.
   */
  resumed?: CrashedTurnPhaseState;
  /**
   * Combined phase eligibility predicate for simulation profiles, singleplayer
   * exclusions and shared-world scan cadence. A false result skips the phase
   * without executing its function. The boolean does not identify which
   * eligibility condition rejected the phase.
   */
  shouldRunPhase?: (phaseName: string) => boolean;
  /**
   * The turn number being processed (`context.newTurn` in `turnSystem.ts`) —
   * used to build the `"turn:<n>:<phase>"` audit traceId (forensics plan
   * §3.1, T2.7). Optional so existing unit tests that don't care about the
   * audit spine don't have to thread it through; defaults to 0.
   */
  turn?: number;
  /** Sandbox tooling hook. Omitted by production turn execution. */
  onPhaseCompleted?: (phase: CompletedTurnPhaseObservation) => Promise<void>;
}): TurnPhaseRuntime {
  const {
    db,
    phaseStatuses,
    warnings,
    currentPhaseRef,
    shouldRunPhase,
    alreadyApplied,
    resumed,
    onPhaseCompleted,
  } = input;
  const resumeOutcomes = new Map<string, ResumeResultOutcome>();
  const turn = input.turn ?? 0;
  let lastFlushAtMs = 0;

  async function setPhaseStatus(
    phase: string,
    status: TurnPhaseExecutionStatus,
    options: {
      reason?: TurnPhaseSkipReason;
      message?: string;
      touchHeartbeat?: boolean;
      roundTrips?: number;
      roundTripBudget?: number;
      topCollections?: TurnPhaseTelemetry["topCollections"];
      substeps?: TurnPhaseTelemetry["substeps"];
      resumeCarried?: TurnPhaseTelemetry["resumeCarried"];
      /** Written in the same gameState update as the status, then flushed at once. */
      result?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    const now = new Date();
    const current = phaseStatuses[phase] ?? createTurnPhaseTelemetry(now, "pending");
    const next: TurnPhaseTelemetry = {
      ...current,
      ...(options.roundTrips != null && options.roundTripBudget != null
        ? {
            roundTrips: options.roundTrips,
            roundTripBudget: options.roundTripBudget,
            overBudget: options.roundTrips > options.roundTripBudget,
          }
        : {}),
      ...(options.topCollections?.length ? { topCollections: options.topCollections } : {}),
      ...(options.substeps ? { substeps: options.substeps } : {}),
      ...(status === "skipped" && options.resumeCarried
        ? { resumeCarried: options.resumeCarried }
        : {}),
      status,
      updatedAt: now,
      startedAt:
        status === "running" || status === "completed"
          ? (current.startedAt ?? now)
          : current.startedAt,
      completedAt:
        status === "completed" ||
        status === "skipped" ||
        status === "failed" ||
        status === "notReached"
          ? now
          : null,
      reason:
        status === "completed" || status === "running" ? null : (options.reason ?? current.reason),
      message:
        status === "completed" || status === "running"
          ? null
          : (options.message ?? current.message),
    };
    // A result-carrying completion is recorded in memory only after its marker
    // and result land together. Otherwise a later whole-map write (the failure
    // path) could persist "completed" with no result (#3429).
    const stagedCompletion = phaseRequiresResumeResult(phase) && status === "completed";
    if (!stagedCompletion) phaseStatuses[phase] = next;

    // Every start must land before the callback can mutate. A coalesced start
    // leaves a pending phase eligible for duplicate execution after a crash.
    // Completion telemetry remains coalesced; recovery conservatively treats a
    // durable running marker as interrupted when completion was not flushed.
    const isAbnormal = status === "failed" || status === "skipped" || status === "notReached";
    const windowElapsed = now.getTime() - lastFlushAtMs >= PHASE_STATUS_FLUSH_THROTTLE_MS;

    // Keep the in-memory current-phase pointer live regardless of flush timing.
    if (status === "running") currentPhaseRef.current = phase;

    // Result-carrying completions must land atomically with their saved output.
    if (status !== "running" && !isAbnormal && !windowElapsed && !stagedCompletion) return;
    lastFlushAtMs = now.getTime();

    const setFields: Record<string, unknown> = {
      [`processingPhaseStatuses.${phase}`]: next,
    };
    if (options.touchHeartbeat !== false) {
      setFields.processingHeartbeatAt = now;
    }
    if (status === "running") {
      setFields.processingPhase = phase;
    }
    if (options.result) {
      setFields[`processingPhaseResults.${phase}`] = options.result;
    }

    const persisted = await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current", isProcessing: true }, { $set: setFields });
    if (status === "running" && persisted.matchedCount === 0) {
      throw new Error(`Cannot start phase "${phase}": processing lock no longer matches`);
    }
    if (stagedCompletion) phaseStatuses[phase] = next;
  }

  async function markPhaseSkipped(
    phase: string,
    reason: TurnPhaseSkipReason,
    message: string
  ): Promise<void> {
    await setPhaseStatus(phase, "skipped", { reason, message });
  }

  async function runPhase<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    // A combined predicate can reject an ordinary cadence or singleplayer
    // phase as well as a simulation profile. Record the known conditional
    // skip without claiming a profile that the predicate does not expose.
    // Do not execute the function or arm its timeout/heartbeat timers.
    if (shouldRunPhase && !shouldRunPhase(name)) {
      await markPhaseSkipped(name, "conditional", "skipped: phase eligibility predicate");
      return null;
    }
    // RESUME GATE. This turn is a re-entry into a turn a previous process began and
    // did not finish, and `alreadyApplied` names the phases that must not run again:
    // the ones it recorded as completed, plus the single phase it was inside when it
    // died. Running either would double-apply writes that already landed.
    //
    // Before this existed the whole turn was CONSUMED on recovery, so one redeploy
    // landing mid-turn discarded every remaining phase, roughly 150 of them, including
    // every election, metric and settlement the turn had not reached yet. Skipping the
    // handful that already ran and continuing is strictly better: the cost of a deploy
    // falls from a whole turn to the one phase that was interrupted.
    //
    // A skipped phase returns nothing, so a phase whose result a later phase reads
    // hands back the bounded copy it stored with its completed status (#3429). An
    // interrupted phase, or a completed one without a valid copy, returns null and
    // records why; `requirePhaseResult` turns that into an explicit failure.
    if (
      alreadyApplied?.has(name) ||
      resumed?.completed.has(name) ||
      resumed?.interrupted.has(name)
    ) {
      const resumeCarried = resumed?.completed.has(name) ? "completed" : "interrupted";
      const restored =
        resumeCarried === "completed" && phaseRequiresResumeResult(name)
          ? ((resumed?.results[name] as T | undefined) ?? null)
          : null;
      if (phaseRequiresResumeResult(name)) {
        resumeOutcomes.set(
          name,
          restored !== null ? "restored" : resumeCarried === "completed" ? "missing" : "interrupted"
        );
      }
      // Carry the restored copy forward, so a second crash can restore it again.
      const result = restored !== null ? encodeResumeResult(name, restored) : null;
      await setPhaseStatus(name, "skipped", {
        reason: "upstreamAbort",
        message:
          restored !== null
            ? "skipped: already applied before crash; restored its completed result"
            : "skipped: already applied before crash",
        resumeCarried,
        ...(result ? { result } : {}),
      });
      return restored;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Phase "${name}" timed out after ${PHASE_TIMEOUT_MS / 1000}s`));
      }, PHASE_TIMEOUT_MS);
    });
    const heartbeatTimer = setInterval(() => {
      // Heartbeats renew the lock only. An in-flight heartbeat may finish after
      // a terminal status write and must never revive that phase as running.
      void db
        .collection<GameState>("gameState")
        .updateOne(
          { _id: "current", isProcessing: true },
          { $set: { processingHeartbeatAt: new Date() } }
        )
        .catch((err) => {
          console.warn(`[Turn] Failed to refresh heartbeat for phase "${name}"`, err);
          Sentry.captureException(err, {
            extra: { phase: name, component: "turnHeartbeat" },
          });
        });
    }, TURN_LOCK_HEARTBEAT_MS);

    const phaseStart = Date.now();
    // Audit correlation id shared by this phase's coarse envelope AND any
    // fine-grained `recordAudit`/`recordAuditBulk` calls nested inside `fn()`
    // (corporationTurn, electionResolution, bondTurn, …) — see
    // `runInAuditContext` below (forensics plan §3.1, T2.7).
    const traceId = turnPhaseTraceId(turn, name);
    const isMutatingPhase = !READ_ONLY_PHASES.has(name);

    try {
      const result = await Promise.race([
        runInAuditContext(
          traceId,
          async () => {
            await setPhaseStatus(name, "running");
            beginPhaseProfiling(name);
            Sentry.addBreadcrumb({
              category: "turn.phase",
              message: `Phase "${name}" started`,
              level: "info",
              data: { phase: name },
            });
            // Each phase becomes a span nested under the turn cron transaction,
            // so GlitchTip's trace view shows a per-phase timing waterfall and
            // flags which phase failed (span status ERROR) — not just the
            // pre-existing breadcrumbs.
            return await withSpan(
              `turn.phase.${name}`,
              { op: "turn.phase", tags: { "turn.phase": name } },
              () => fn()
            );
          },
          { kind: "system" }
        ),
        timeoutPromise,
      ]);
      const phaseDurationMs = Date.now() - phaseStart;
      if (onPhaseCompleted) await onPhaseCompleted({ name, result });
      Sentry.addBreadcrumb({
        category: "turn.phase",
        message: `Phase "${name}" completed`,
        level: "info",
        data: { phase: name, durationMs: phaseDurationMs },
      });
      // A slow phase is a perf signal, not an error: it is recorded as the
      // breadcrumb above (with durationMs) and tracked first-class by the
      // turndiag tooling off the turn logs. We deliberately do NOT mint a
      // standalone GlitchTip issue, which only duplicated that signal as
      // error-tracker noise.
      // Coarse per-phase audit envelope (forensics plan §3.1/§4 T2.7) — one
      // `recordAudit` call, fire-and-forget, never awaited; skipped for
      // read-only/telemetry phases. `recordAudit` itself is a no-op when
      // `gameConfig.auditLog` is off, so this is zero-cost by default.
      if (isMutatingPhase) {
        const entry: ActionAuditInput = {
          source: "turn",
          category: "system",
          action: "turn.phase",
          phase: name,
          turn,
          traceId,
          actor: { kind: "system" },
          subject: { type: "turnPhase", id: name, name },
          outcome: "ok",
          meta: { durationMs: phaseDurationMs, ...cheapPhaseResultMeta(result) },
        };
        recordAudit(entry);
      }
      // Round-trip budget (see turnPhaseBudgets.ts). Warn-only: a phase over
      // budget is a perf regression to fix, not a failed turn.
      const roundTrips = roundTripCountsAvailable() ? phaseRoundTrips(name) : undefined;
      const roundTripBudget = roundTripBudgetFor(name);
      if (roundTrips != null && roundTrips > roundTripBudget) {
        const topCollections = phaseTopCollectionsByRoundTrips(name)
          .map(({ collection, roundTrips: count }) => `${collection}:${count}`)
          .join(", ");
        console.warn(
          `[Turn] Phase "${name}" issued ${roundTrips} Mongo round trips, over its budget of ${roundTripBudget}. ` +
            `Top collections: ${topCollections}. See src/simulation/engine/turnPhaseBudgets.ts.`
        );
        Sentry.addBreadcrumb({
          category: "turn.phase",
          message: `Phase "${name}" over round-trip budget`,
          level: "warning",
          data: { phase: name, roundTrips, roundTripBudget },
        });
      }
      const substeps = takePhaseSubsteps(name);
      const topCollections =
        roundTrips != null && roundTrips >= TOP_COLLECTIONS_MIN_ROUND_TRIPS
          ? phaseTopCollectionsByRoundTrips(name, 3)
          : undefined;
      const completionTelemetry = {
        ...(roundTrips == null ? {} : { roundTrips, roundTripBudget }),
        ...(topCollections ? { topCollections } : {}),
        ...(substeps ? { substeps } : {}),
      };
      if (phaseRequiresResumeResult(name)) {
        // A dependent phase consumes this result, so the completed marker and
        // its stored copy land together before the turn moves on, or the turn
        // stops. Two awaited writes per turn (running, completed) for this one
        // phase; every other phase keeps the coalesced flush.
        const stored = encodeResumeResult(name, result);
        try {
          if (!stored) throw new Error("result is not a storable completion result");
          await setPhaseStatus(name, "completed", { ...completionTelemetry, result: stored });
        } catch (persistErr) {
          throw new TurnPhaseCompletionPersistError(name, persistErr);
        }
        return result;
      }
      void setPhaseStatus(name, "completed", completionTelemetry).catch((err) =>
        console.warn(`[Turn] Failed to mark phase "${name}" completed`, err)
      );
      return result;
    } catch (err) {
      if (err instanceof TurnPhaseCompletionPersistError) {
        // Writes landed, so this is not a phase failure to log and continue past.
        // The in-memory status stays "running"; the turn aborts and a resume
        // treats the phase as interrupted.
        discardPhaseSubsteps(name);
        warnings.push(`${name}: ${err.message}`);
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Turn] Phase "${name}" failed: ${message}`, err);
      Sentry.captureException(err, { extra: { phase: name } });
      if (isMutatingPhase) {
        recordAudit({
          source: "turn",
          category: "system",
          action: "turn.phase",
          phase: name,
          turn,
          traceId,
          actor: { kind: "system" },
          subject: { type: "turnPhase", id: name, name },
          outcome: "error",
          reason: message,
        });
      }
      discardPhaseSubsteps(name);
      void setPhaseStatus(name, "failed", { reason: "other", message }).catch((setErr) =>
        console.warn(`[Turn] Failed to mark phase "${name}" failed`, setErr)
      );
      warnings.push(`${name}: ${message}`);
      return null;
    } finally {
      endPhaseProfiling(name);
      clearInterval(heartbeatTimer);
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function requirePhaseResult<T>(phase: string, result: T | null, dependent: string): T {
    if (result !== null) return result;
    const outcome = resumeOutcomes.get(phase);
    if (outcome === "missing" || outcome === "interrupted") {
      throw new TurnResumeResultUnavailableError(phase, outcome, dependent);
    }
    throw new Error(`${dependent} requires a completed ${phase} result`);
  }

  return {
    runPhase,
    markPhaseSkipped,
    requirePhaseResult,
    resumeResultOutcome: (phase: string) => resumeOutcomes.get(phase) ?? null,
  };
}
