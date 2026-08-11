import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import type { StatePartyOrg, State, Election } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { primaryOpenFilter } from "@/lib/elections/electionDeadlineFilters";
import { z } from "zod";

const schema = z.object({
  method: z.union([z.literal("PR"), z.literal("WTA"), z.null()]),
});

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/primary-allocation — Set the delegate-allocation method used in this state's presidential primary
// Auth: requireAuthWithCharacter (state chair / vice chair / treasurer / national chair / admin)
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { method } = parsed.data;

    const db = await getDb();

    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    // Chair/vice-chair/treasurer/national-chair/admin may change allocation.
    // Same auth surface as the tax route for the state party.
    const isAdmin = authUser.isAdmin;
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    const isStateChair = stateParty?.chairId?.equals(authUser.character._id);
    const isStateViceChair = stateParty?.viceChairId?.equals(authUser.character._id);
    const isStateTreasurer = stateParty?.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, vice chair, treasurer, national chair, or an admin can change primary allocation",
        },
        { status: 403 }
      );
    }

    // Lock the setting once a presidential primary is active for this country.
    // Admins may override — their action is logged separately. The goal is to
    // prevent a chair from flipping allocation mid-primary to game outcomes.
    const { currentTurn, effectiveNow } = await getGameTime();
    const activePresPrimary = await db.collection<Election>("elections").findOne({
      countryId,
      electionType: "president",
      status: "active",
      ...primaryOpenFilter(currentTurn, effectiveNow),
    });
    if (activePresPrimary && !isAdmin) {
      return NextResponse.json(
        {
          error:
            "Presidential primary is currently active — allocation is locked for this cycle. Admins may override.",
        },
        { status: 409 }
      );
    }

    const now = new Date();

    await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      { _id: statePartyKey },
      method === null
        ? {
            $unset: { primaryAllocation: "" },
            $set: { updatedAt: now },
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
              stateTaxRate: 0,
              politicalStrength: 0,
              hasPresence: false,
              createdAt: now,
            },
          }
        : {
            $set: { primaryAllocation: method, updatedAt: now },
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
              stateTaxRate: 0,
              politicalStrength: 0,
              hasPresence: false,
              createdAt: now,
            },
          },
      { upsert: true }
    );

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "primary_allocation_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `Primary allocation for ${state.name} ${party.name} set to ${method ?? "default"}${isAdmin && activePresPrimary ? " (admin override during active primary)" : ""}`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `Primary allocation set to ${method ?? "default"}`,
      method,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
