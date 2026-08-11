import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import { canViewPartyAnalytics } from "@/lib/parties/access";
import { getPartyAnalytics } from "@/lib/parties/queries/analytics";

// GET /api/country/[code]/parties/[id]/analytics - Return the shared party analytics payload.
// Auth: requireAuth
// Errors: 400, 401, 403, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const modViewEnabled =
      !auth.user.isAdmin &&
      auth.user.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    if (!canViewPartyAnalytics(party, auth.user, modViewEnabled)) {
      return NextResponse.json(
        { error: "Party analytics are only available to party members" },
        { status: 403 }
      );
    }

    return NextResponse.json(
      await getPartyAnalytics(db, { countryId, partyId: String(party.sequentialId) })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
