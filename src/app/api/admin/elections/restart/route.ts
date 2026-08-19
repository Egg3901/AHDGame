/**
 * POST /api/admin/elections/restart
 *
 * Manually triggers ensurePerpetualElections(), ensureUKElections(), and
 * ensureDEElections() so any missing active/upcoming races (US + UK + DE) are
 * spawned immediately without
 * waiting for the next turn.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { ensurePerpetualElections, ensureUKElections } from "@/lib/turnSystem";
import { ensureDEElections } from "@/lib/turn/perpetualElections";

// POST /api/admin/elections/restart — Spawns any missing US, UK, and DE elections immediately without waiting for the next turn.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const before = Date.now();
    const now = new Date();
    await ensurePerpetualElections(now);
    await ensureUKElections(now);
    await ensureDEElections(now);
    const ms = Date.now() - before;

    return NextResponse.json({
      success: true,
      message: `Election continuity check complete (${ms}ms). Any missing US, UK, and DE races have been spawned. Check server logs for details.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
