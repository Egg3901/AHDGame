// src/app/api/parties/[id]/recruitment/states/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { calculateRecruitmentSlots } from "@/lib/npp/recruitment";
import {
  NPP_RECRUITMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppRecruitmentFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import type { State, StatePartyOrg, NPP } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// GET /api/country/[code]/parties/[id]/recruitment/states — Return eligible states with NPP slot and cost info for recruitment
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
/**
 * GET /api/parties/[id]/recruitment/states
 * Returns eligible states with slot/cost info for recruitment.
 */
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
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);
    const charId = auth.character._id.toString();
    const isChair = party.chairId?.toString() === charId;
    const isViceChair = party.viceChairId?.toString() === charId;

    if (!isChair && !isViceChair && !auth.isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Get all states in country
    const states = await db.collection<State>("states").find({ countryId: countryId }).toArray();

    // Get state party org for this party
    const statePartyOrgs = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ partyId: partyIdStr, countryId: countryId })
      .toArray();
    const orgByState = new Map(statePartyOrgs.map((o) => [o.stateId, o]));

    // Count NPPs per state
    const nppAgg = await db
      .collection<NPP>("npps")
      .aggregate<{ _id: string; count: number }>([
        { $match: { party: partyIdStr, retiredAt: null } },
        { $group: { _id: "$homeState", count: { $sum: 1 } } },
      ])
      .toArray();
    const nppByState = new Map(nppAgg.map((a) => [a._id, a.count]));

    // Total party NPPs
    const partyNPPCount = nppAgg.reduce((sum, a) => sum + a.count, 0);

    // NPP Recruitment spends a flat 5 Action Points from the national pool plus
    // a per-currency treasury cost.
    const apTier = resolvePartyTier(party);
    const recruitCost = NPP_RECRUITMENT_AP_COST;
    const recruitFund = nppRecruitmentFundCost(nppTreasuryCurrency(countryId));
    const partyActionPoints = party.nppActionPoints ?? nppActionPointCap("national", apTier);
    const partyTreasury = party.treasury ?? 0;

    // States that already have a state Chair or Vice Chair. We surface this as
    // an informational flag to the UI but no longer filter such states out —
    // national leadership can recruit anywhere within their country.
    const statesWithLeadership = new Set(
      statePartyOrgs.filter((o) => o.chairId || o.viceChairId).map((o) => o.stateId)
    );

    const result = states.map((state) => {
      const org = orgByState.get(state._id);
      const stateOrg = org?.organization ?? 0;
      const currentNPPs = nppByState.get(state._id) ?? 0;
      const maxSlots = calculateRecruitmentSlots(stateOrg);
      const availableSlots = Math.max(0, maxSlots - currentNPPs);

      const hasStateLeadership = statesWithLeadership.has(state._id);
      const canRecruit =
        availableSlots > 0 && partyActionPoints >= recruitCost && partyTreasury >= recruitFund;

      return {
        stateId: state._id,
        stateName: state.name,
        stateOrg,
        currentNPPs,
        maxSlots,
        availableSlots,
        actionCost: recruitCost,
        canRecruit,
        hasStateLeadership,
      };
    });

    return NextResponse.json({
      states: result,
      nppActionPoints: partyActionPoints,
      nppActionPointCap: nppActionPointCap("national", apTier),
      nppActionPointRegen: nppActionPointRegen("national", apTier),
      recruitFundCost: recruitFund,
      partyTreasury,
      partyNPPCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
