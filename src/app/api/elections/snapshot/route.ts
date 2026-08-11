/**
 * POST /api/elections/snapshot
 *
 * Records an hourly primary-standings snapshot for every election that is
 * currently in its primary phase.  Call this from a cron job (e.g. Vercel
 * Cron or an external scheduler) once per hour.
 *
 * Also callable manually from the admin panel for testing.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { requireCron } from "@/lib/api/requireCron";
import { recordPrimarySnapshots } from "@/lib/turn/primaryResolution";
import { getGameTime } from "@/lib/time/gameTime";
import { handleRouteError } from "@/lib/api/errors";

// POST /api/elections/snapshot — Records hourly primary standings snapshots for all elections currently in primary phase.
// Auth: requireCron (falls back to requireAdmin)
// Errors: 401, 403
export async function POST(request: Request) {
  try {
    // Allow both admin-authenticated calls and cron (Bearer) calls
    if (!requireCron(request)) {
      // Fall back to admin auth
      const auth = await requireAdmin();
      if (!auth.ok) return auth.response;
    }

    // Anchor to game time so the snapshot's phase check matches the turn-based
    // resolver (and freezes correctly while turns are paused).
    const { currentTurn, effectiveNow } = await getGameTime();
    const snapshotted = await recordPrimarySnapshots(effectiveNow, currentTurn);

    return NextResponse.json({ snapshotted });
  } catch (error) {
    return handleRouteError(error);
  }
}
