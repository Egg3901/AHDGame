import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { savePartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { getTreasuryReserveSummary } from "@/lib/partyTreasuryPlan";
import type { State, StatePartyOrg } from "@/lib/db/types";
import { getTreasuryPresetLabel, type TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

const treasuryPlanSchema = z.object({
  transferReserveAmount: z.number().min(0).max(500_000_000),
  memberSupportReserveAmount: z.number().min(0).max(500_000_000),
  nppRecruitmentReserveAmount: z.number().min(0).max(500_000_000),
  gotvBudgetPercent: z.number().min(0).max(25),
  suppressionBudgetPercent: z.number().min(0).max(25),
  treasuryPreset: z.enum(["custom", "growth", "election_push", "member_support", "reserve_first"]),
});

// POST /api/country/[code]/region/[id]/party/[partyId]/treasury-plan — Save state Treasurer reserve targets for soft treasury planning
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

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, treasuryPlanSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });
    const actor = auth.user.character;
    const isAdmin = auth.user.isAdmin;
    const isStateTreasurer = stateParty?.treasurerId?.equals(actor._id);
    // When the state Treasurer seat is vacant, the same officers already
    // allowed to run state treasury actions (national chair, state chair,
    // state VC) act as Treasurer for the plan so it isn't permanently locked.
    const isNationalChair = party.chairId?.equals(actor._id);
    const isStateChair = stateParty?.chairId?.equals(actor._id);
    const isStateViceChair = stateParty?.viceChairId?.equals(actor._id);
    const canActAsTreasurer =
      !stateParty?.treasurerId && (isNationalChair || isStateChair || isStateViceChair);
    if (!isAdmin && !isStateTreasurer && !canActAsTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state treasurer (or national chair / state chair / vice-chair when the seat is vacant) or an admin can set treasury targets",
        },
        { status: 403 }
      );
    }

    const now = new Date();
    const partyKey = getPartyIdString(party);
    const collection = await getPartyBudgetCollection();
    await savePartyBudgetForScope(
      collection,
      { countryId, partyId: partyKey, scope: "state", stateId },
      parsed.data,
      now
    );

    const summary = getTreasuryReserveSummary(stateParty?.treasury ?? 0, parsed.data);
    const presetLabel = getTreasuryPresetLabel(parsed.data.treasuryPreset as TreasuryPresetId);

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "state_treasury_plan_changed",
      username: auth.user.username,
      characterName: actor.name,
      adminUsername: isAdmin ? auth.user.username : undefined,
      details: `State treasury plan for ${state.name} ${party.name} updated: ${presetLabel} posture, GOTV ${parsed.data.gotvBudgetPercent}%, suppression ${parsed.data.suppressionBudgetPercent}%, transfer reserve $${summary.transferReserveAmount.toLocaleString()}, member support reserve $${summary.memberSupportReserveAmount.toLocaleString()}, NPP recruitment reserve $${summary.nppRecruitmentReserveAmount.toLocaleString()}`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: "Treasury planning targets updated",
      ...summary,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
