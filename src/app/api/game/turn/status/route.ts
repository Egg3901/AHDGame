import { NextResponse } from "next/server";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { getProcessingLockState } from "@/lib/turn/processingLock";
import { computeTurnProcessingProgress, formatTurnPhaseLabel } from "@/lib/turn/turnProgress";

// GET /api/game/turn/status — Returns the current game turn, year, active status, and next scheduled turn time.
// Auth: public
// Errors: 404
export async function GET(request: Request) {
  try {
    const gameState = await getGameState();

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    // Compute when the next Vercel Cron fire is (UTC).
    // Normal mode: top of the next hour. Fast mode: next :00 or :30 boundary.
    const now = new Date();
    const nextCron = new Date(now);
    nextCron.setUTCSeconds(0, 0);
    if (gameState.fastMode) {
      const mins = nextCron.getUTCMinutes();
      if (mins < 30) {
        nextCron.setUTCMinutes(30);
      } else {
        nextCron.setUTCMinutes(0);
        nextCron.setUTCHours(nextCron.getUTCHours() + 1);
      }
    } else {
      nextCron.setUTCMinutes(0, 0, 0);
      nextCron.setUTCHours(nextCron.getUTCHours() + 1);
    }

    const processingLockState =
      gameState.isProcessing === true ? getProcessingLockState(gameState, now) : null;
    const processingPhase = gameState.processingPhase ?? null;
    const processingPhaseStatuses = gameState.isProcessing
      ? (gameState.processingPhaseStatuses ?? null)
      : null;
    const processingProgress = gameState.isProcessing
      ? computeTurnProcessingProgress(processingPhase, processingPhaseStatuses)
      : null;

    const payload = {
      currentTurn: gameState.currentTurn,
      currentYear: gameState.currentYear,
      startingYear: gameState.startingYear,
      // Pre-iteration calendar offset so client date renders honor the founding
      // date-freeze (0 on normal worlds). `preIterationTurns` is only written
      // once the founding phase ENDS, so the active flag has to ship too or the
      // calendar advances through the founding turns it is meant to freeze.
      preIterationTurns: gameState.preIterationTurns ?? 0,
      preIterationActive: gameState.preIteration?.active === true,
      preset: gameState.preset,
      isActive: gameState.isActive,
      isProcessing: gameState.isProcessing ?? false,
      lastTurnProcessed: gameState.lastTurnProcessed,
      nextScheduledTurn: gameState.isActive ? nextCron.toISOString() : null,
      pausedAt: gameState.pausedAt ?? null,
      pauseReason: gameState.pauseReason ?? null,
      pauseKind: gameState.pauseKind ?? null,
      processingPhase,
      processingPhaseLabel: processingPhase ? formatTurnPhaseLabel(processingPhase) : null,
      processingPhaseStatuses,
      processingProgress,
      processingTargetTurn: gameState.processingTargetTurn ?? null,
      processingHeartbeatAt: gameState.processingHeartbeatAt ?? null,
      processingStartedAt: gameState.processingStartedAt ?? null,
      canResetProcessingLock: processingLockState?.isStale ?? false,
      processingLockRetryAfterSeconds: processingLockState
        ? Math.ceil(processingLockState.retryAfterMs / 1000)
        : null,
      processingLockStaleAt: processingLockState?.staleAfterAt.toISOString() ?? null,
      corporationActionsPaused: gameState.corporationActionsPaused ?? false,
      playerTransfersPaused: gameState.playerTransfersPaused ?? false,
      freePartyMovesOpen: gameState.freePartyMovesOpen ?? false,
      forexEnabled: gameState.forexEnabled ?? false,
      playerRandomEventsEnabled: gameState.playerRandomEventsEnabled ?? false,
      fastMode: gameState.fastMode ?? false,
    };
    // During processing, keep no-store so clients see turn_start promptly.
    // Otherwise attach a strong ETag: even where the edge does not honor
    // s-maxage, a bodyless 304 on unchanged polls cuts origin egress to ~0.
    if (gameState.isProcessing) {
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, no-transform" } });
    }
    return conditionalJson(request, payload, {
      cacheControl: "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
