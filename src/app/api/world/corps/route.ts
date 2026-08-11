import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";

/** Maps CountryId → ISO 3166-1 numeric code used by the world map */
const COUNTRY_TO_ISO: Record<string, string> = {
  US: "840",
  UK: "826",
  DE: "276",
  JP: "392",
};

const WORLD_CORPS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
};

/**
 * GET /api/world/corps
 *
 * Returns corporation counts per country, keyed by ISO numeric code.
 * Shape: { "840": { count: 12, label: "United States" }, ... }
 */
// GET /api/world/corps — Returns corporation counts per country keyed by ISO numeric code for the world map.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();

    const counts = await db
      .collection<Corporation>("corporations")
      .aggregate<{ _id: string; count: number }>([
        {
          $lookup: {
            from: "states",
            localField: "headquartersState",
            foreignField: "_id",
            as: "state",
          },
        },
        { $unwind: "$state" },
        { $group: { _id: "$state.countryId", count: { $sum: 1 } } },
      ])
      .toArray();

    if (counts.length === 0) {
      return NextResponse.json(
        { countries: {}, maxCount: 0 },
        { headers: WORLD_CORPS_CACHE_HEADERS }
      );
    }

    // Build response keyed by ISO numeric code
    const countries: Record<string, { count: number }> = {};
    let maxCount = 0;
    for (const { _id: countryId, count } of counts) {
      const isoCode = COUNTRY_TO_ISO[countryId];
      if (!isoCode) continue;
      countries[isoCode] = { count };
      if (count > maxCount) maxCount = count;
    }

    return NextResponse.json({ countries, maxCount }, { headers: WORLD_CORPS_CACHE_HEADERS });
  } catch (error) {
    return handleRouteError(error);
  }
}
