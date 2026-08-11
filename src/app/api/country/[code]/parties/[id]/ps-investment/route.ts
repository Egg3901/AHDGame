import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "@/lib/turn/politicalStrength/strengthConstants";
import type { PoliticalParty } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

/**
 * Country-aware maximum acceptable per-turn PS investment budget for a
 * national party. Anything beyond this is wasted (capped at
 * `PS_INVESTMENT_MAX_TIERS` PS gain regardless), so the route rejects
 * over-cap values to keep treasury from being silently set up to drain.
 */
function maxNationalBudget(countryId: CountryId): number {
  return psInvestmentRate(countryId, "national") * PS_INVESTMENT_MAX_TIERS;
}

function buildPsInvestmentSchema(countryId: CountryId) {
  const max = maxNationalBudget(countryId);
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
 * POST /api/country/[code]/parties/[id]/ps-investment — set the chair's
 * per-turn USD budget for explicit Political Strength investment.
 *
 * Each turn, `min(budget, treasury)` is debited and converted to PS at
 * the country-scoped rate, up to the headroom below the hard cap (see
 * `partyActionGeneration.computePartyPsGain`).
 *
 * Auth: chair / vice-chair / treasurer / admin.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { code, id: partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const authResult = await requireAuthWithCharacter();
  if (!authResult.ok) return authResult.response;
  const authUser = authResult.user;

  const parsed = await parseJsonBody(request, buildPsInvestmentSchema(countryId));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const db = await getDb();
  const party = await findPartyBySequentialId(db, partyId, countryId);
  if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

  const isAdmin = authUser.isAdmin;
  const isChair = party.chairId?.equals(authUser.character._id);
  const isViceChair = party.viceChairId?.equals(authUser.character._id);
  const isTreasurer = party.treasurerId?.equals(authUser.character._id);
  if (!isAdmin && !isChair && !isViceChair && !isTreasurer) {
    return NextResponse.json(
      {
        error:
          "Only the party chair, vice chair, treasurer, or an admin can set the PS investment budget",
      },
      { status: 403 }
    );
  }

  const now = new Date();
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { _id: party._id },
      { $set: { psInvestmentBudget: parsed.data.budget, updatedAt: now } }
    );

  return NextResponse.json({
    ok: true,
    psInvestmentBudget: parsed.data.budget,
    expectedPsPerTurn: Math.min(
      PS_INVESTMENT_MAX_TIERS,
      parsed.data.budget / psInvestmentRate(countryId, "national")
    ),
  });
}
