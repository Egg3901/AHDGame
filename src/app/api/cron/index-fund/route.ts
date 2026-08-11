import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { logRequest } from "@/lib/api/requestLog";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { runIndexFundCron } from "@/lib/indexFunds/fundCron";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";

// GET /api/cron/index-fund — Manual/debug index-fund engine (not scheduled in lib/cron.ts).
// Recompute NAV, absorb float, rebalance constituents, process queued redemptions, snapshot.
// Auth: requireCron
// Feature flag: indexFundsMode must be partial or full; returns 200 with { skipped: true } otherwise.
export const maxDuration = 300;

export async function GET(req: Request) {
  const start = Date.now();
  try {
    if (!requireCron(req)) {
      logRequest("GET", "/api/cron/index-fund", 401, Date.now() - start);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isIndexFundsEnabled())) {
      logRequest("GET", "/api/cron/index-fund", 200, Date.now() - start);
      return NextResponse.json({ skipped: true, message: "Index funds feature is disabled" });
    }

    const gameState = await getGameState();
    if (!gameState?.isActive) {
      logRequest("GET", "/api/cron/index-fund", 200, Date.now() - start);
      return NextResponse.json({ skipped: true, message: "Turn system is paused" });
    }

    const db = await getDb();
    const result = await runIndexFundCron(db, { currentTurn: gameState.currentTurn });

    const durationMs = Date.now() - start;
    logRequest("GET", "/api/cron/index-fund", 200, durationMs);

    if (result.errors.length > 0) {
      console.warn("[cron/index-fund] Errors:", result.errors);
    }

    return NextResponse.json({
      success: true,
      ...result,
      durationMs,
    });
  } catch (error) {
    console.error("[cron/index-fund] Failed:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}
