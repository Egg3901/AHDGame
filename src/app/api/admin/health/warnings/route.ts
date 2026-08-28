import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { GameHealthSnapshot, GameState, TurnLog } from "@/lib/db/types";
import { PHASE_TIMEOUT_MS } from "@/lib/turn/processingLock";

// Healthy turns normally finish in well under a minute, but historical spikes
// have exceeded 90 seconds without actually wedging. Use a wider warning window
// so Game Health only flags runs that are meaningfully outside normal variance.
const TURN_STUCK_WARNING_MS = 5 * 60_000;

/**
 * Phase-budget headroom. `runPhase` kills a phase at PHASE_TIMEOUT_MS, which
 * fails the phase and aborts the whole turn — so a phase creeping toward that
 * ceiling is an outage with a lead time, and worth surfacing before it lands.
 *
 * Why this exists (2026-08-28): corporationTurn costs ~6ms per corporateSector
 * and the sector population grows with NPP expansion, so the phase gets more
 * expensive as the world grows rather than because of any code change. Measured
 * that day it was already peaking at 110s of the 240s ceiling. Nothing in the
 * admin surfaced that, because a slow phase that still SUCCEEDS produces no
 * warning, skip or error anywhere — the turn just quietly gets closer to the
 * edge each week.
 *
 * Read from turnLogs rather than gameHealthSnapshots on purpose: the snapshot
 * query above only returns turns that already carry a warning/error/skip, so a
 * slow-but-clean turn would never appear in it.
 */
const PHASE_BUDGET_WARN_FRACTION = 0.5;
const PHASE_BUDGET_ERROR_FRACTION = 0.75;
/** Turns scanned for phase-budget pressure. */
const PHASE_BUDGET_TURN_SAMPLE = 10;

interface UnifiedWarning {
  turn: number;
  phase: string;
  severity: "warning" | "error";
  message: string;
  source: "turnProcessing" | "integrity" | "turnLock" | "turnPhase" | "phaseBudget";
  timestamp: Date;
}

/** Wall-clock a phase took, or null when the telemetry is incomplete. */
function phaseDurationMs(telemetry: {
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}): number | null {
  if (!telemetry?.startedAt || !telemetry?.completedAt) return null;
  const ms = new Date(telemetry.completedAt).getTime() - new Date(telemetry.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Flattened, filterable list of warnings and errors from recent snapshots.
 * Auth: requireAdmin()
 * Errors: 403
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const phase = url.searchParams.get("phase") || undefined;
    const severity = url.searchParams.get("severity") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const fromTurnRaw = Number(url.searchParams.get("fromTurn"));
    const toTurnRaw = Number(url.searchParams.get("toTurn"));
    const fromTurn =
      url.searchParams.get("fromTurn") && !isNaN(fromTurnRaw) ? fromTurnRaw : undefined;
    const toTurn = url.searchParams.get("toTurn") && !isNaN(toTurnRaw) ? toTurnRaw : undefined;

    const db = await getDb();

    // Fetch recent snapshots that have warnings or integrity issues
    const turnFilter: Record<string, unknown> = {};
    if (fromTurn !== undefined || toTurn !== undefined) {
      turnFilter.turn = {};
      if (fromTurn !== undefined) (turnFilter.turn as Record<string, number>).$gte = fromTurn;
      if (toTurn !== undefined) (turnFilter.turn as Record<string, number>).$lte = toTurn;
    }

    const snapshotFilter =
      source === "turnPhase"
        ? turnFilter
        : {
            ...turnFilter,
            $or: [
              { "turnProcessing.warningCount": { $gt: 0 } },
              { "turnProcessing.errorCount": { $gt: 0 } },
              { "turnProcessing.phasesSkipped": { $gt: 0 } },
              { "dataIntegrity.issues.0": { $exists: true } },
            ],
          };

    const snapshots = await db
      .collection<GameHealthSnapshot>("gameHealthSnapshots")
      .find(snapshotFilter)
      .sort({ turn: -1 })
      .limit(50)
      .toArray();

    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          currentTurn: 1,
          isProcessing: 1,
          processingKind: 1,
          processingPhase: 1,
          processingTargetTurn: 1,
          processingStartedAt: 1,
          processingHeartbeatAt: 1,
          updatedAt: 1,
        },
      }
    );

    // Flatten into unified list
    const allWarnings: UnifiedWarning[] = [];

    for (const snap of snapshots) {
      for (const w of snap.turnProcessing.warnings) {
        allWarnings.push({
          turn: snap.turn,
          phase: w.phase,
          severity: "warning",
          message: w.message,
          source: "turnProcessing",
          timestamp: w.timestamp,
        });
      }
      for (const e of snap.turnProcessing.errors) {
        allWarnings.push({
          turn: snap.turn,
          phase: e.phase,
          severity: "error",
          message: e.message,
          source: "turnProcessing",
          timestamp: e.timestamp,
        });
      }
      if (snap.dataIntegrity) {
        for (const issue of snap.dataIntegrity.issues) {
          allWarnings.push({
            turn: snap.turn,
            phase: issue.category,
            severity: issue.severity,
            message: issue.message,
            source: "integrity",
            timestamp: snap.timestamp,
          });
        }
      }
      if (source === "turnPhase" || !source) {
        for (const [phase, telemetry] of Object.entries(snap.turnProcessing.phaseStatuses ?? {})) {
          if (telemetry.status === "skipped") {
            allWarnings.push({
              turn: snap.turn,
              phase,
              severity: "warning",
              message: telemetry.message ?? "Phase skipped.",
              source: "turnPhase",
              timestamp: telemetry.updatedAt,
            });
          }
          if (source === "turnPhase" && telemetry.status === "notReached") {
            allWarnings.push({
              turn: snap.turn,
              phase,
              severity: "error",
              message: telemetry.message ?? "Phase was never reached before the turn ended.",
              source: "turnPhase",
              timestamp: telemetry.updatedAt,
            });
          }
        }
      }
    }

    const now = new Date();
    const processingKind = gameState?.processingKind ?? "turn";
    if (gameState?.isProcessing && processingKind === "turn") {
      const heartbeatAt = gameState.processingHeartbeatAt
        ? new Date(gameState.processingHeartbeatAt)
        : gameState.processingStartedAt
          ? new Date(gameState.processingStartedAt)
          : gameState.updatedAt
            ? new Date(gameState.updatedAt)
            : null;

      if (heartbeatAt && now.getTime() - heartbeatAt.getTime() >= TURN_STUCK_WARNING_MS) {
        const startedAt = gameState.processingStartedAt
          ? new Date(gameState.processingStartedAt)
          : heartbeatAt;
        const lockAgeMs = Math.max(0, now.getTime() - startedAt.getTime());
        const lastHeartbeatMs = Math.max(0, now.getTime() - heartbeatAt.getTime());
        const lockAgeSeconds = Math.round(lockAgeMs / 1000);
        const heartbeatSeconds = Math.round(lastHeartbeatMs / 1000);

        allWarnings.push({
          turn: gameState.processingTargetTurn ?? gameState.currentTurn + 1,
          phase: gameState.processingPhase ?? "unknown",
          severity: "error",
          message:
            `Turn lock appears stuck in phase "${gameState.processingPhase ?? "unknown"}". ` +
            `Lock age ${lockAgeSeconds}s, last heartbeat ${heartbeatSeconds}s ago.`,
          source: "turnLock",
          timestamp: heartbeatAt,
        });
      }
    }

    // Phase-budget pressure: phases approaching the hard PHASE_TIMEOUT_MS kill.
    // Only the worst phase per turn is reported, so a broadly slow turn produces
    // one actionable line rather than thirty.
    if (source === "phaseBudget" || !source) {
      const budgetLogs = await db
        .collection<TurnLog>("turnLogs")
        .find(turnFilter)
        .sort({ turn: -1 })
        .limit(PHASE_BUDGET_TURN_SAMPLE)
        .toArray();

      for (const log of budgetLogs) {
        let worst: { phase: string; ms: number } | null = null;
        for (const [phaseName, telemetry] of Object.entries(log.phaseStatuses ?? {})) {
          const ms = phaseDurationMs(telemetry);
          if (ms === null) continue;
          if (!worst || ms > worst.ms) worst = { phase: phaseName, ms };
        }
        if (!worst) continue;

        const fraction = worst.ms / PHASE_TIMEOUT_MS;
        if (fraction < PHASE_BUDGET_WARN_FRACTION) continue;

        allWarnings.push({
          turn: log.turn,
          phase: worst.phase,
          severity: fraction >= PHASE_BUDGET_ERROR_FRACTION ? "error" : "warning",
          message:
            `Phase "${worst.phase}" took ${Math.round(worst.ms / 1000)}s, ` +
            `${Math.round(fraction * 100)}% of the ${PHASE_TIMEOUT_MS / 1000}s phase timeout. ` +
            `Exceeding it fails the phase and aborts the turn.`,
          source: "phaseBudget",
          timestamp: log.realTime,
        });
      }
    }

    // Apply filters
    let filtered = allWarnings;
    if (phase) filtered = filtered.filter((w) => w.phase === phase);
    if (severity) filtered = filtered.filter((w) => w.severity === severity);
    if (source) filtered = filtered.filter((w) => w.source === source);

    // Sort by turn descending, then timestamp descending
    filtered.sort((a, b) => b.turn - a.turn || b.timestamp.getTime() - a.timestamp.getTime());

    return NextResponse.json({ warnings: filtered.slice(0, limit) });
  } catch (error) {
    return handleRouteError(error);
  }
}
