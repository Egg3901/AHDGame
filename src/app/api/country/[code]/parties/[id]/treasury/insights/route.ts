import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import { canViewNationalTreasuryInsights } from "@/lib/parties/access";
import { getPartyTreasuryInsights } from "@/lib/parties/queries/treasuryInsights";

// GET /api/country/[code]/parties/[id]/treasury/insights - Return leadership treasury insights.
// Auth: requireAuthWithCharacter
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

    const auth = await requireAuthWithCharacter();
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
    if (!canViewNationalTreasuryInsights(party, auth.user, modViewEnabled)) {
      return NextResponse.json(
        { error: "Only party leadership can view treasury insights" },
        { status: 403 }
      );
    }

    return NextResponse.json(
      await getPartyTreasuryInsights(db, {
        countryId,
        partyId: String(party.sequentialId),
        partyName: party.name,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
