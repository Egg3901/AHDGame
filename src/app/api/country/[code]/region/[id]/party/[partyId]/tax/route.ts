import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { taxRateSchema } from "@/lib/api/schemas/settings";
import type { StatePartyOrg, State } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/tax — Set the state party tax rate on member fund generation
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Verify authentication
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, taxRateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const rate = parsed.data.taxRate;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    // Check authorization: admin, national chair, state chair, vice chair, or state treasurer
    const isAdmin = authUser.isAdmin;
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    const isStateChair = stateParty?.chairId?.equals(authUser.character._id);
    const isStateViceChair = stateParty?.viceChairId?.equals(authUser.character._id);
    const isStateTreasurer = stateParty?.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, vice chair, treasurer, national chair, or an admin can set the tax rate",
        },
        { status: 403 }
      );
    }

    const now = new Date();

    // Update or create the state party org
    await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      { _id: statePartyKey },
      {
        $set: {
          stateTaxRate: rate,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: statePartyKey,
          countryId,
          stateId,
          partyId: partyKey,
          organization: 0,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          treasury: 0,
          politicalStrength: 0,
          hasPresence: false,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    // Log the action
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "tax_rate_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `State tax rate for ${state.name} ${party.name} changed to ${rate}%`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `State tax rate set to ${rate}%`,
      taxRate: rate,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
