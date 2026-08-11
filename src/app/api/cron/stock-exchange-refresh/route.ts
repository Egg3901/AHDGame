import { NextResponse } from "next/server";
import { getGameState } from "@/lib/gameState";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";
import { applyPriceMultipliers } from "@/lib/corporations/applyPriceMultipliers";
import { logRequest } from "@/lib/api/requestLog";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { getProcessingLockState } from "@/lib/turn/processingLock";

// GET /api/cron/stock-exchange-refresh — Applies price multipliers then rebuilds stock exchange snapshots.
// Auth: requireCron
// Errors: 401
/**
 * GET /api/cron/stock-exchange-refresh
 * Scheduled every fifteen minutes. Applies sentiment/order-flow multipliers to corp sharePrice,
 * then immediately rebuilds exchange snapshots so both share the same price state.
 */
export async function GET(req: Request) {
  const start = Date.now();
  try {
    if (!requireCron(req)) {
      logRequest("GET", "/api/cron/stock-exchange-refresh", 401, Date.now() - start);
      console.warn("[cron/stock-exchange-refresh] Unauthorized cron attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gameState = await getGameState();
    if (!gameState?.isActive) {
      console.info("[cron/stock-exchange-refresh] Skipped: turn system is paused");
      return NextResponse.json({ skipped: true, message: "Turn system is paused" });
    }

    if (gameState.isProcessing) {
      // Mirrors the in-process stockExchangeRefreshCron: a stale lock means no
      // real turn is in flight (prior process died mid-turn), so the refresh
      // must proceed. processTurn's own findOneAndUpdate keeps takeover safe
      // if a turn-cron tick arrives concurrently.
      const lockState = getProcessingLockState(gameState);
      if (!lockState.isStale) {
        console.info("[cron/stock-exchange-refresh] Skipped: turn in progress");
        return NextResponse.json({ skipped: true, message: "Turn in progress" });
      }
      console.warn(
        `[cron/stock-exchange-refresh] Stale processing lock detected (lastTouch=${
          lockState.lastTouch?.toISOString() ?? "none"
        }); proceeding with refresh.`
      );
    }

    const { updated, pulseCount } = await applyPriceMultipliers();
    await generateStockExchangeSnapshots(gameState.currentTurn);

    const durationMs = Date.now() - start;
    logRequest("GET", "/api/cron/stock-exchange-refresh", 200, durationMs);
    console.info("[cron/stock-exchange-refresh] Refreshed", {
      turn: gameState.currentTurn,
      pricesUpdated: updated,
      pulseCount,
      durationMs,
    });
    return NextResponse.json({
      success: true,
      turn: gameState.currentTurn,
      pricesUpdated: updated,
    });
  } catch (error) {
    console.error("[cron/stock-exchange-refresh] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}
