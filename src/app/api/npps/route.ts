import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { NPP, NPPDisplay } from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";

/**
 * Convert NPP to display format
 */
function toNPPDisplay(npp: NPP): NPPDisplay {
  return {
    id: npp._id.toString(),
    name: npp.name,
    party: npp.party,
    homeState: npp.homeState,
    currentOffice: npp.currentOffice ? getOfficeLabel(npp.currentOffice) : "None",
    politicalInfluence: npp.politicalInfluence || 0,
    favorability: npp.favorability,
    isNPP: true,
  };
}

// GET /api/npps — Returns a paginated list of active NPPs with optional state, party, and office filters
// Auth: public
// Errors: (none)
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state");
    const party = searchParams.get("party");
    const hasOffice = searchParams.get("hasOffice");
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const db = await getDb();

    // Build query
    const query: Record<string, unknown> = { retiredAt: null };
    if (enabledCountries) {
      query.countryId = { $in: enabledCountries };
    }

    if (state) {
      query.homeState = state.toUpperCase();
    }

    if (party) {
      query.party = party.toLowerCase();
    }

    if (hasOffice === "true") {
      query.currentOffice = { $ne: null };
    }

    // Get total count for pagination
    const total = await db.collection<NPP>("npps").countDocuments(query);

    // Fetch NPPs
    const npps = await db
      .collection<NPP>("npps")
      .find(query)
      .sort({ politicalInfluence: -1, name: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const nppDisplays = npps.map(toNPPDisplay);

    return NextResponse.json({
      npps: nppDisplays,
      total,
      limit,
      offset,
      hasMore: offset + npps.length < total,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
