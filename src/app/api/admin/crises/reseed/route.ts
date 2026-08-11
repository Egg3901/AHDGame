import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { reseedCrisisHeroImages } from "@/lib/crises/reseedCrisisHeroImages";

/**
 * POST /api/admin/crises/reseed
 *
 * Backfill hero images on existing crises from the current template catalog.
 * Matches by crisis name; manual crises with no template are skipped.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await reseedCrisisHeroImages(db);

    return NextResponse.json({
      success: true,
      message:
        result.updated > 0
          ? `Updated hero images on ${result.updated} crisis(es).`
          : "No crisis hero images needed updating.",
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
