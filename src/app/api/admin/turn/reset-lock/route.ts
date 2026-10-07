import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { invalidateGameStateCache } from "@/lib/gameState";
import type { GameState } from "@/lib/db/types";
import { createAdminLog } from "@/lib/adminLog";
import { getProcessingLockState } from "@/lib/turn/processingLock";
import { hasAppliedNextTurnEvidence } from "@/simulation/engine/turnResumeBootstrap";

function formatRetryDelay(retryAfterMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

// POST /api/admin/turn/reset-lock - Clears a stale isProcessing lock so the next cron can run.
// Auth: requireAdmin
// Errors: 403, 404, 409
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          isProcessing: 1,
          currentTurn: 1,
          processingKind: 1,
          processingPhase: 1,
          processingTargetTurn: 1,
          processingPhaseStatuses: 1,
          processingAbandonedAt: 1,
          processingHeartbeatAt: 1,
          processingStartedAt: 1,
          updatedAt: 1,
        },
      }
    );

    if (!gameState) {
      throw notFound("Game state not initialized");
    }

    if (gameState.isProcessing !== true) {
      return NextResponse.json({
        success: true,
        modified: false,
        message: "No change - there is no active processing lock to clear.",
        processingPhase: gameState.processingPhase ?? null,
        processingTargetTurn: gameState.processingTargetTurn ?? null,
      });
    }

    const { isStale, lastTouch, retryAfterMs, staleAfterAt } = getProcessingLockState(gameState);

    // Refuse to clear a healthy lock because doing so can allow overlapping turn runs.
    if (!isStale) {
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      const safeLastTouch = lastTouch ?? staleAfterAt;
      return errorResponse(
        409,
        `Processing lock is still active and cannot be reset yet. Try again in about ${formatRetryDelay(retryAfterMs)}.`,
        {
          extra: {
            processingPhase: gameState.processingPhase ?? null,
            processingTargetTurn: gameState.processingTargetTurn ?? null,
            lastHeartbeatAt: safeLastTouch.toISOString(),
            retryAfterSeconds,
            staleAfterAt: staleAfterAt.toISOString(),
          },
        }
      );
    }

    const preserveRecoveryEvidence = hasAppliedNextTurnEvidence(gameState);
    const now = new Date();
    const releaseFields: Record<string, unknown> = {
      isProcessing: false,
      processingKind: null,
      processingStartedAt: null,
      processingHeartbeatAt: null,
      processingAbandonedAt: null,
      updatedAt: now,
    };
    if (!preserveRecoveryEvidence) {
      Object.assign(releaseFields, {
        processingTargetTurn: null,
        processingPhase: null,
        processingPhaseStatuses: null,
        processingPhaseResults: null,
      });
    }

    const result = await db.collection<GameState>("gameState").updateOne(
      {
        _id: "current",
        isProcessing: true,
        processingKind: gameState.processingKind ?? null,
        processingAbandonedAt: gameState.processingAbandonedAt ?? null,
        processingStartedAt: gameState.processingStartedAt ?? null,
        processingTargetTurn: gameState.processingTargetTurn ?? null,
        processingPhase: gameState.processingPhase ?? null,
        processingHeartbeatAt: gameState.processingHeartbeatAt ?? null,
      },
      {
        $set: releaseFields,
      }
    );

    if (result.matchedCount === 0) {
      return errorResponse(
        409,
        "Processing lock changed while the reset was in progress. Nothing was cleared; refresh and try again."
      );
    }

    if (result.modifiedCount > 0) {
      invalidateGameStateCache();

      await createAdminLog({
        category: "system",
        action: "turn_lock_reset",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details:
          `Released stale processing lock (phase=${gameState.processingPhase ?? "none"}, ` +
          `targetTurn=${gameState.processingTargetTurn ?? "none"}, ` +
          `recoveryEvidence=${preserveRecoveryEvidence ? "preserved" : "none"})`,
      });
    }

    return NextResponse.json({
      success: true,
      modified: result.modifiedCount > 0,
      message:
        result.modifiedCount > 0
          ? preserveRecoveryEvidence
            ? "Processing lock released. Existing turn recovery evidence was preserved for the next cron tick."
            : "Processing lock cleared. Next cron tick will run normally."
          : "No change - lock was already cleared.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
