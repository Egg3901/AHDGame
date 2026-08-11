import { NextResponse } from "next/server";
import { getGameState } from "@/lib/gameState";
import { logRequest } from "@/lib/api/requestLog";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { applyPriceMultipliers } from "@/lib/corporations/applyPriceMultipliers";
import { getProcessingLockState } from "@/lib/turn/processingLock";

// GET /api/cron/price-update
// Retained for manual invocation. Price multipliers are now applied as part of
// stock-exchange-refresh (every 5 minutes) so this cron is no longer scheduled.
// Auth: requireCron
export async function GET(req: Request) {
  const start = Date.now();
  try {
    if (!requireCron(req)) {
      logRequest("GET", "/api/cron/price-update", 401, Date.now() - start);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gameState = await getGameState();
    if (!gameState?.isActive) {
      return NextResponse.json({ skipped: true, message: "Turn system is paused" });
    }
    if (gameState.isProcessing) {
      // Mirrors the in-process cron: stale lock means no real turn in flight,
      // so the refresh must proceed instead of dead-ending.
      const lockState = getProcessingLockState(gameState);
      if (!lockState.isStale) {
        return NextResponse.json({ skipped: true, message: "Turn in progress" });
      }
      console.warn(
        `[cron/price-update] Stale processing lock detected (lastTouch=${
          lockState.lastTouch?.toISOString() ?? "none"
        }); proceeding.`
      );
    }

    const { updated, pulseCount } = await applyPriceMultipliers();

    const durationMs = Date.now() - start;
    logRequest("GET", "/api/cron/price-update", 200, durationMs);
    console.info("[cron/price-update] Updated prices", { updated, pulseCount, durationMs });
    return NextResponse.json({ updated, pulseCount });
  } catch (error) {
    console.error("[cron/price-update] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}
