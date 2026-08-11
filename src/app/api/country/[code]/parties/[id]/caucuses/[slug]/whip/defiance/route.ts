import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { buildWhipDefianceSnapshot } from "@/lib/partyWhips/whipDefiance";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/whip/defiance — Return active caucus whip defiance rows
// Auth: requireAuthWithCharacter
// Errors: 401, 403, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const viewerParty = auth.user.character.party ?? null;
    if (!auth.user.isAdmin && viewerParty !== String(party.sequentialId)) {
      return NextResponse.json(
        forbidden("Only party members may view active whip defiance").toJson(),
        { status: 403 }
      );
    }

    const resolved = await findCaucusBySlug(db, countryId, String(party.sequentialId), slug);
    if (!resolved) {
      return NextResponse.json(notFound("Caucus not found").toJson(), { status: 404 });
    }

    const snapshot = await buildWhipDefianceSnapshot(db, {
      countryId,
      partyId: String(party.sequentialId),
      issuedBy: "caucus",
      caucusId: resolved.caucus._id,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    return handleRouteError(error);
  }
}
