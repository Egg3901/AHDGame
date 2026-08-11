import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";

// GET /api/game/state-player-counts — Returns { counts: { [stateId]: number } } of
// active (non-retired) players per home state, scoped to enabled countries for non-admins.
// Auth: public
export async function GET() {
  try {
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const db = await getDb();
    const match: Record<string, unknown> = { retiredAt: { $exists: false } };
    if (enabledCountries) {
      match.countryId = { $in: enabledCountries };
    }

    const rows = await db
      .collection("characters")
      .aggregate<{ _id: string | null; count: number }>([
        { $match: match },
        { $group: { _id: "$homeState", count: { $sum: 1 } } },
      ])
      .toArray();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row._id) counts[row._id] = row.count;
    }

    return NextResponse.json(
      { counts },
      {
        headers: {
          "Cache-Control": "private, max-age=120, stale-while-revalidate=600, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
