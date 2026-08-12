import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import { JP_REGIONS } from "@/lib/constants/japan";
import type { State } from "@/lib/db/types";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";

/** JP playable region `_id`s — must match `jpRegions` / `JP_REGIONS`. */
const JP_PLAYABLE_REGION_IDS = JP_REGIONS.map((r) => r.id);

// GET /api/game/states — Returns all states sorted by name, filtered to enabled countries for non-admins.
// Optional `?playableHome=1` includes US states plus Alaska/Hawaii's territorial politics.
// Auth: public
// Errors: (none)
export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();
    const playableHome = request.nextUrl.searchParams.get("playableHome") === "1";

    const db = await getDb();
    let query: Record<string, unknown>;
    if (!enabledCountries) {
      query = {};
    } else {
      const orClauses: Record<string, unknown>[] = [{ countryId: { $in: enabledCountries } }];
      // JP regions missing `countryId` still appear for admins (empty query) but fail `{ $in }`
      // for players — include those documents when Japan is enabled so character creation matches
      // imperial/admin tooling and seed upserts that only `$set` fields.
      const jpEnabled = enabledCountries.includes("JP" as CountryId);
      if (jpEnabled) {
        orClauses.push({
          _id: { $in: JP_PLAYABLE_REGION_IDS },
          $nor: [{ countryId: { $in: enabledCountries } }],
        });
      }
      query = { $or: orClauses };
    }
    let states = await db.collection<State>("states").find(query).sort({ name: 1 }).toArray();

    if (playableHome) {
      const { residentPoliticalIds } = await loadUsPoliticalStateIds(db);
      states = states.filter(
        (s) => (s.countryId ?? "US") !== "US" || residentPoliticalIds.has(s._id)
      );
    }

    return NextResponse.json(states, {
      headers: {
        // Non-admins see a subset filtered by enabled countries (cookie auth). A shared public
        // cache would serve the wrong document mix to other users when toggles or seeds change.
        "Cache-Control": "private, max-age=120, stale-while-revalidate=600, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
