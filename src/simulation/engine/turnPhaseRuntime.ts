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
import { beginPhaseProfiling, endPhaseProfiling } from "@/lib/observability/mongoRoundTrips";
import { withSpan } from "@/lib/observability/spans";
import type { TurnPhaseRuntime } from "@/simulation/engine/types";
import { TURN_LOCK_HEARTBEAT_MS, PHASE_TIMEOUT_MS } from "@/lib/turn/processingLock";
import { recordAudit } from "@/lib/audit/recordAudit";
import { runInAuditContext, turnPhaseTraceId } from "@/lib/observability/context";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

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
   * SIM-ONLY predicate. When provided and it returns false for a phase, the
   * phase is marked skipped and its fn never runs (headless worldsim
   * elections-only profile — see simTurnProfiles.ts). Omitted in prod → no
   * filtering, zero overhead.
   */
  shouldRunPhase?: (phaseName: string) => boolean;
  /**
   * The turn number being processed (`context.newTurn` in `turnSystem.ts`) —
   * used to build the `"turn:<n>:<phase>"` audit traceId (forensics plan
   * §3.1, T2.7). Optional so existing unit tests that don't care about the
   * audit spine don't have to thread it through; defaults to 0.
   */
  turn?: number;
}): TurnPhaseRuntime {
  const { db, phaseStatuses, warnings, currentPhaseRef, shouldRunPhase } = input;
  const turn = input.turn ?? 0;
  let lastFlushAtMs = 0;

  async function setPhaseStatus(
    phase: string,
    status: TurnPhaseExecutionStatus,
    options: {
      reason?: TurnPhaseSkipReason;
      message?: string;
      touchHeartbeat?: boolean;
    } = {}
  ): Promise<void> {
    const now = new Date();
    const current = phaseStatuses[phase] ?? createTurnPhaseTelemetry(now, "pending");
    const next: TurnPhaseTelemetry = {
      ...current,
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
    phaseStatuses[phase] = next;

    // Decide whether to flush this transition to gameState now, or coalesce it
    // (the in-memory update above already happened, so nothing durable is lost).
    // Always flush terminal/abnormal states and any transition once the throttle
    // window has elapsed since the last flush (which includes every 30s
    // heartbeat tick, keeping the lock fresh).
    const isAbnormal = status === "failed" || status === "skipped" || status === "notReached";
    const windowElapsed = now.getTime() - lastFlushAtMs >= PHASE_STATUS_FLUSH_THROTTLE_MS;

    // Keep the in-memory current-phase pointer live regardless of flush timing.
    if (status === "running") currentPhaseRef.current = phase;

    if (!isAbnormal && !windowElapsed) return;
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

    await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current", isProcessing: true }, { $set: setFields });
  }

  async function markPhaseSkipped(
    phase: string,
    reason: TurnPhaseSkipReason,
    message: string
  ): Promise<void> {
    await setPhaseStatus(phase, "skipped", { reason, message });
  }

  async function runPhase<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    // SIM-ONLY phase gate (headless worldsim "elections-only" profile): skip
    // economy/ledger phases entirely — mark skipped and return null WITHOUT
    // running fn or arming the timeout/heartbeat timers. Callers already treat a
    // null phase result as "did not run" (group execute() bodies null-guard every
    // phaseResult). No predicate (prod/cron) → this branch is never taken.
    if (shouldRunPhase && !shouldRunPhase(name)) {
      await markPhaseSkipped(name, "simElectionsOnly", "skipped: sim elections-only profile");
      return null;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Phase "${name}" timed out after ${PHASE_TIMEOUT_MS / 1000}s`));
      }, PHASE_TIMEOUT_MS);
    });
    const heartbeatTimer = setInterval(() => {
      void setPhaseStatus(name, "running").catch((err) => {
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
      void setPhaseStatus(name, "completed").catch((err) =>
        console.warn(`[Turn] Failed to mark phase "${name}" completed`, err)
      );
      return result;
    } catch (err) {
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

  return {
    runPhase,
    markPhaseSkipped,
  };
}
