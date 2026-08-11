import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId, getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "@/lib/turn/politicalStrength/strengthConstants";
import type { State, StatePartyOrg } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

function maxStateBudget(countryId: CountryId): number {
  return psInvestmentRate(countryId, "state") * PS_INVESTMENT_MAX_TIERS;
}

function buildPsInvestmentSchema(countryId: CountryId) {
  const max = maxStateBudget(countryId);
  return z.object({
    budget: z
      .number()
      .min(0, "Budget must be non-negative")
      .max(
        max,
        `Budget cannot exceed ${max.toLocaleString()} (cap is +${PS_INVESTMENT_MAX_TIERS} PS/turn)`
      ),
  });
}

/**
 * POST /api/country/[code]/region/[id]/party/[partyId]/ps-investment —
 * set the state-party's per-turn USD budget for explicit Political
 * Strength investment.
 *
 * Half-priced relative to the national equivalent: $125k = +1 PS/turn,
 * cap $500k = +4 PS/turn (matches the existing convention that state
 * PS is twice as efficient per dollar). Self-throttling debit + hard-cap
 * headroom limit live in `partyActionGeneration.computePartyPsGain`.
 *
 * Auth: state chair / vice / treasurer / national chair / admin.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, buildPsInvestmentSchema(countryId));
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
    if (!stateParty) {
      return NextResponse.json({ error: "Party has no presence in this state" }, { status: 404 });
    }

    const isAdmin = authUser.isAdmin;
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    const isStateChair = stateParty.chairId?.equals(authUser.character._id);
    const isStateViceChair = stateParty.viceChairId?.equals(authUser.character._id);
    const isStateTreasurer = stateParty.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, vice chair, treasurer, national chair, or an admin can set the PS investment budget",
        },
        { status: 403 }
      );
    }

    const now = new Date();
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: statePartyKey },
        { $set: { psInvestmentBudget: parsed.data.budget, updatedAt: now } }
      );

    return NextResponse.json({
      ok: true,
      psInvestmentBudget: parsed.data.budget,
      expectedPsPerTurn: Math.min(
        PS_INVESTMENT_MAX_TIERS,
        parsed.data.budget / psInvestmentRate(countryId, "state")
      ),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
