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
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can announce a constitutional convention" },
        { status: 403 }
      );
    }

    const currentTurn = await getCurrentTurn(db);

    try {
      await announceConvention(db, countryId, auth.user.character._id, currentTurn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/collapse stage|already in progress/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, atTurn: currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
