import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId, getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import type { State, StatePartyOrg } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildStateTreasuryInsights } from "@/lib/treasury/partyTreasuryInsights";

// GET /api/country/[code]/region/[id]/party/[partyId]/treasury/insights â€” Leadership-only override history for a state party treasury
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: id, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: getStatePartyOrgDocumentId(id, party) });
    if (!stateParty) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    const actorId = auth.user.character._id;
    const isAdmin = auth.user.isAdmin;
    const isNationalChair = party.chairId?.equals(actorId);
    const isStateChair = stateParty.chairId?.equals(actorId);
    const isStateViceChair = stateParty.viceChairId?.equals(actorId);
    const isStateTreasurer = stateParty.treasurerId?.equals(actorId);
    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        { error: "Only party leadership can view treasury insights" },
        { status: 403 }
      );
    }

    const insights = await buildStateTreasuryInsights(db, party.name, state.name);
    return NextResponse.json(insights);
  } catch (error) {
    return handleRouteError(error);
  }
}
