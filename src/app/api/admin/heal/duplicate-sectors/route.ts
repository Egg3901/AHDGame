import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { normalizeAndMergeCorporateSectors } from "@/lib/corporations/repairDuplicateSectors";

/**
 * POST /api/admin/heal/duplicate-sectors
 * Normalizes `corporateSectors.countryId` from the authoritative state record and
 * merges duplicate sectors in the same operating market. This heals legacy
 * cross-border expansion rows that were stamped with the owner's HQ country,
 * which later caused hostile takeovers to create parallel state+type sectors.
 * Auth: requireAdmin
 * Errors: 401, 403
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await normalizeAndMergeCorporateSectors(db, new Date());
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
