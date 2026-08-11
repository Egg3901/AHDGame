import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { logRequest } from "@/lib/api/requestLog";
import { updateCampaignFogOfWar } from "@/lib/campaigns/fogOfWar";

// GET /api/cron/fog-update — Cron endpoint that updates campaign fog-of-war snapshots every hour.
// Auth: requireCron
// Errors: 401
/**
 * GET /api/cron/fog-update
 * Called by Vercel Cron every hour. Updates fog of war snapshots.
 * Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
  const start = Date.now();

  if (!requireCron(req)) {
    logRequest("GET", "/api/cron/fog-update", 401, Date.now() - start);
    console.warn("[cron/fog-update] Unauthorized cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await updateCampaignFogOfWar();

    const durationMs = Date.now() - start;
    logRequest("GET", "/api/cron/fog-update", 200, durationMs);
    console.info("[cron/fog-update] Completed", { durationMs });
    return NextResponse.json({ success: true });
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "/api/cron/fog-update" } });
    logRequest("GET", "/api/cron/fog-update", 500, Date.now() - start);
    console.error("[cron/fog-update] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}
