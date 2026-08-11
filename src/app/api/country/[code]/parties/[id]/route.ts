import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import { getPartyDetail } from "@/lib/parties/queries/partyDetail";

// GET /api/country/[code]/parties/[id] - Return the shared national-party detail view model.
// Auth: public
// Errors: 400, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    return NextResponse.json(await getPartyDetail(db, party));
  } catch (error) {
    return handleRouteError(error);
  }
}
