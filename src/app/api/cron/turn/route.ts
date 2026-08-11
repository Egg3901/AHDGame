import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getGameState } from "@/lib/gameState";
import { processTurn } from "@/lib/turnSystem";
import { logRequest } from "@/lib/api/requestLog";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { shouldFireBackupTurn } from "@/lib/cron/backupFireGuard";
import { captureTurnHealth } from "@/lib/observability/turnHealth";

// Give the hourly turn route enough headroom to finish the full pipeline while
// phase-level guards still get the first chance to fail fast and release the lock.
export const maxDuration = 800;

// Each Vercel cron entry tags itself via `?source=primary|backup`. The :00 primary
// always proceeds (processTurn's isProcessing lock prevents double-fires); the :30
// backup only fires when the primary missed its slot for the current UTC clock hour.
// This keeps the schedule self-correcting — a one-off recovery on :30 cannot pin
// future runs there, because the next :00 primary is unconditional.
type CronSource = "primary" | "backup";

function parseSource(req: Request): CronSource {
  const sourceParam = new URL(req.url).searchParams.get("source");
  return sourceParam === "backup" ? "backup" : "primary";
}

// GET /api/cron/turn — Cron endpoint that processes one full game turn every hour.
// Auth: requireCron
// Errors: 401
/**
 * GET /api/cron/turn
 * Called by Vercel Cron every hour. Processes one game turn.
 * Protected by CRON_SECRET which Vercel injects automatically.
 */
export async function GET(req: Request) {
  try {
    const start = Date.now();
    if (!requireCron(req)) {
      logRequest("GET", "/api/cron/turn", 401, Date.now() - start);
      const secret = process.env.CRON_SECRET;
      const authHeader = req.headers.get("authorization");
      if (!secret) {
        console.error("[cron/turn] Unauthorized: CRON_SECRET env var is not configured");
      } else if (!authHeader) {
        console.warn("[cron/turn] Unauthorized: Authorization header missing (external caller?)");
      } else {
        console.warn("[cron/turn] Unauthorized: Authorization header present but secret mismatch");
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gameState = await getGameState();
    if (!gameState?.isActive) {
      console.info("[cron/turn] Skipped: turn system is paused");
      return NextResponse.json({ skipped: true, message: "Turn system is paused" });
    }

    const source = parseSource(req);
    const now = new Date();

    // The backup fire only suppresses itself in normal mode. In fast mode both :00 and
    // :30 are legitimate scheduled turns, so the backup proceeds unconditionally — same
    // as the primary.
    if (source === "backup" && !gameState.fastMode) {
      const shouldFire = await shouldFireBackupTurn(now, gameState);
      if (!shouldFire) {
        console.info("[cron/turn] Skipped: primary fire already processed this hour", {
          latestCompletedTurnAt: "N/A",
          source,
        });
        return NextResponse.json({
          skipped: true,
          message: "Skipped: a turn already ran in the current clock hour.",
        });
      }
    }

    const result = await processTurn();
    // Return 200 for any turn that actually ran (even with phase warnings — those go to Sentry).
    // Reserve 500 for critical failures where no turn was processed at all (result.turn === 0, success false).
    const status = result.success || result.turn > 0 ? 200 : 500;
    const durationMs = Date.now() - start;
    logRequest("GET", "/api/cron/turn", status, durationMs);
    console.info("[cron/turn] Completed", {
      turn: result.turn,
      success: result.success,
      durationMs,
      warnings: result.warnings.length,
      source,
    });

    // Slow-turn alert: a full turn taking more than 5 minutes means something is
    // stuck — a phase hanging on a DB index scan, a large election resolution,
    // or a metric engine regression. The cron maxDuration is 800s, so 300s is
    // the "investigate now" threshold before it risks timing out entirely.
    if (result.success && durationMs > 300_000) {
      Sentry.captureMessage(`Slow turn: #${result.turn} took ${Math.round(durationMs / 1000)}s`, {
        level: "warning",
        tags: { component: "turn", "turn.slow": "true" },
        extra: { turn: result.turn, durationMs, warnings: result.warnings, source },
      });
    }

    // Structured turn-health metric (degraded/failed only — healthy turns are silent).
    captureTurnHealth(result, durationMs);
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("[cron/turn] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // handleRouteError already captures the exception to Sentry (see
    // src/lib/api/errors.ts) — do NOT also logger.error() here or the turn
    // failure double-captures into two separately-grouped GlitchTip issues.
    return handleRouteError(error);
  }
}
