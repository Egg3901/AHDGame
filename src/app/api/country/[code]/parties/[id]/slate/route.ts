import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import { getPartySlateOverview } from "@/lib/parties/queries/slateOverview";

// GET /api/country/[code]/parties/[id]/slate - Return the shared slate overview payload.
// Auth: requireAuth
// Errors: 400, 401, 404
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

    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return NextResponse.json(
      await getPartySlateOverview(db, {
        countryId,
        partyId: String(party.sequentialId),
        includeArchived,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
