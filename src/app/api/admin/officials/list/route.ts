import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial } from "@/lib/db/types";

// GET /api/admin/officials/list — Returns a filtered list of elected officials by state, office type, or vacancy status.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET(request: Request) {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state");
    const officeType = searchParams.get("officeType");
    const vacant = searchParams.get("vacant") === "true";

    const db = await getDb();

    // Build query (officeType from URL is string; MongoDB accepts valid values)
    const query: Filter<ElectedOfficial> = {};
    if (state) query.state = state.toUpperCase();
    if (officeType) query.officeType = officeType as ElectedOfficial["officeType"];
    if (vacant) query.characterId = null;

    // Exclude vacant House seats (House reps are created dynamically when appointed)
    // Only show: Senate seats (vacant or filled), and filled House seats
    if (!officeType) {
      query.$or = [
        { officeType: "senate" },
        { officeType: { $ne: "house" } },
        { officeType: "house", characterId: { $ne: null } },
      ];
    } else if (officeType === "house" && !vacant) {
      query.characterId = { $ne: null };
    }

    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(query)
      .sort({ state: 1, officeType: 1, senateClass: 1, seatsHeld: -1 })
      .limit(100) // Limit results
      .toArray();

    return NextResponse.json({
      officials,
      count: officials.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
