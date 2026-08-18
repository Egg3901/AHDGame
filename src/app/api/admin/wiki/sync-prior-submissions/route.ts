/**
 * POST /api/admin/wiki/sync-prior-submissions
 *
 * Rewrites legacy ObjectId-based wiki slugs (`player-{hex}`, `corp-{hex}`,
 * `party-profile-{hex}`) to use the entity's public sequentialId
 * (`player-123`, `corp-152`, `party-us-1`). Idempotent — pages already in
 * the new format are skipped.
 *
 * Auth: requireModerator
 * Errors: 403
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { syncPriorWikiSubmissions } from "@/lib/wiki/syncPriorSubmissions";

export async function POST() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const moderatorId = new ObjectId(auth.user.userId);
    const result = await syncPriorWikiSubmissions(db, moderatorId);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
