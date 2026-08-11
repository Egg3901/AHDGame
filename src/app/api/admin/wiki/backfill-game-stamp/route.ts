/**
 * POST /api/admin/wiki/backfill-game-stamp
 *
 * Stamps gameIteration and gameStartDate (from GAME_ITERATION / GAME_START_DATE
 * env vars) onto user-created wiki pages that predate those fields. Seeded and
 * auto-generated pages are excluded. Idempotent — pages already stamped are
 * skipped by the $exists: false filter.
 *
 * Auth: requireAdmin
 * Errors: 401, 403, 500
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { backfillGameStamp } from "@/lib/wiki/backfillGameStamp";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await backfillGameStamp(db);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
