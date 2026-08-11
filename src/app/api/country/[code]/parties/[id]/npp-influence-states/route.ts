import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { Character, State } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/parties/[id]/npp-influence-states — Return states where the party has only NPPs and no player characters
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const authData = authResult.user;

    const db = await getDb();

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);

    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    // Check authorization - only Chair and Vice Chair
    const characterId = authData.character._id;
    const isChair = party.chairId?.equals(characterId);
    const isViceChair = party.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        forbidden("Only the Chair or Vice Chair can access NPP influence").toJson(),
        { status: 403 }
      );
    }

    const partyIdStr = String(party.sequentialId);

    // Get all player characters in this party (non-NPP)
    // Filter by countryId to prevent cross-country sequentialId collisions
    const partyCountry = party.countryId ?? "US";
    const playerCharacters = await db
      .collection<Character>("characters")
      .find({ party: partyIdStr, isNPP: { $ne: true }, countryId: partyCountry })
      .project({ homeState: 1 })
      .toArray();

    const statesWithPlayers = new Set(playerCharacters.map((c) => c.homeState));

    // Pull regions for this party's country directly from the states collection —
    // works uniformly for every country (US states, UK regions, JP prefectures,
    // DE Länder, …) without hardcoded per-country tables.
    const regionDocs = await db
      .collection<State>("states")
      .find({ countryId: partyCountry })
      .project<{ _id: string; name?: string }>({ _id: 1, name: 1 })
      .toArray();
    const allStates = regionDocs.map((s) => ({ id: s._id, name: s.name ?? s._id }));

    // Filter to states without player characters
    const nppOnlyStates = allStates.filter((s) => !statesWithPlayers.has(s.id));

    return NextResponse.json({
      states: nppOnlyStates,
      partyId: partyIdStr,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
