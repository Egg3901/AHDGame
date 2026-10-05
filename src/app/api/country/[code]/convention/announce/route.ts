/**
 * POST /api/country/[code]/convention/announce
 *
 * Player-initiated constitutional convention announcement. Auth: must
 * be the sitting head of government for the country.
 *
 * Errors:
 *   400 — unknown country
 *   401 — not authenticated
 *   403 — caller is not the sitting leader
 *   409 — already in collapse stage OR convention already in progress
 *   500 — anything else
 */
import { NextResponse } from "next/server";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { announceConvention } from "@/lib/onePartyState/constitutionalConvention";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return errorResponse(403, "Only the sitting leader can announce a constitutional convention");
    }

    const currentTurn = await getCurrentTurn(db);

    try {
      await announceConvention(db, countryId, auth.user.character._id, currentTurn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/collapse stage|already in progress/i.test(msg)) {
        return errorResponse(409, msg);
      }
      throw err;
    }

    return NextResponse.json({ ok: true, atTurn: currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
