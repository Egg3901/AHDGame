/**
 * POST /api/admin/officials/reset
 *
 * Deletes ALL elected officials and clears currentOffice on all characters and NPPs.
 * Does not touch elections, demographics, or other game data.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";

// POST /api/admin/officials/reset — Deletes all elected officials and clears currentOffice on all characters and NPPs.
// Auth: requireAdmin
// Errors: 401, 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    const officialsResult = await db.collection("electedOfficials").deleteMany({});

    const charsResult = await db
      .collection("characters")
      .updateMany(
        { currentOffice: { $ne: null } },
        { $set: { currentOffice: null, updatedAt: now } }
      );

    const nppsResult = await db
      .collection("npps")
      .updateMany(
        { currentOffice: { $ne: null } },
        { $set: { currentOffice: null, updatedAt: now } }
      );

    return NextResponse.json({
      success: true,
      message: `Reset complete. Deleted ${officialsResult.deletedCount} elected officials. Cleared currentOffice on ${charsResult.modifiedCount} characters and ${nppsResult.modifiedCount} NPPs.`,
      details: {
        officialsDeleted: officialsResult.deletedCount,
        charactersCleared: charsResult.modifiedCount,
        nppsCleared: nppsResult.modifiedCount,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
