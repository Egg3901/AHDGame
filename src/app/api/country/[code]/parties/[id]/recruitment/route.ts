// src/app/api/parties/[id]/recruitment/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  NPP_RECRUITMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppRecruitmentFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import type { NPP } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { getGameTime } from "@/lib/time/gameTime";
import {
  recruitmentCooldownRemainingTurns,
  recruitmentCooldownUntilIso,
} from "@/lib/npp/recruitmentCooldown";

// GET /api/country/[code]/parties/[id]/recruitment — Return NPP recruitment status and cooldown for the party
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
/**
 * GET /api/parties/[id]/recruitment
 * Returns recruitment status for a party.
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

    // Check if user is in this party
    if (auth.character.party !== String(party.sequentialId)) {
      return NextResponse.json({ error: "Not a member of this party" }, { status: 403 });
    }

    // Count party NPPs
    const partyNPPCount = await db
      .collection<NPP>("npps")
      .countDocuments({ party: String(party.sequentialId), retiredAt: null });

    const now = new Date();
    // Turn-first cooldown remaining (+ Date fallback in helper); read currentTurn
    // from the game clock so a paused/drifted real clock can't move the window.
    const gameTime = await getGameTime();
    const remainingTurns = recruitmentCooldownRemainingTurns(
      party,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime()
    );
    const cooldownRemaining = remainingTurns > 0 ? remainingTurns * 3600 : null;
    const cooldownUntil = recruitmentCooldownUntilIso(remainingTurns, Date.now());

    // NPP Recruitment spends a flat 5 Action Points from the national pool plus
    // a per-currency treasury cost.
    const apTier = resolvePartyTier(party);
    const apCap = nppActionPointCap("national", apTier);
    const availableAp = party.nppActionPoints ?? apCap;
    const recruitFund = nppRecruitmentFundCost(nppTreasuryCurrency(countryId));
    const treasury = party.treasury ?? 0;

    // Check if caller is Chair/VC
    const charId = auth.character._id.toString();
    const isChair = party.chairId?.toString() === charId;
    const isViceChair = party.viceChairId?.toString() === charId;
    const isNationalLeadership = isChair || isViceChair;
    const nppControl = await getPartyNppControlStatus({
      db,
      countryId,
      party,
      actor: auth.character,
      isAdmin: auth.isAdmin,
      now,
    });

    return NextResponse.json({
      cooldownUntil,
      cooldownRemaining,
      partyNPPCount,
      actionCost: NPP_RECRUITMENT_AP_COST,
      fundCost: recruitFund,
      treasury,
      nppActionPoints: availableAp,
      nppActionPointCap: apCap,
      nppActionPointRegen: nppActionPointRegen("national", apTier),
      canRecruit:
        !cooldownRemaining &&
        isNationalLeadership &&
        nppControl.ok &&
        availableAp >= NPP_RECRUITMENT_AP_COST &&
        treasury >= recruitFund,
      blockedReason: nppControl.ok ? null : nppControl.error,
      isNationalScope: isNationalLeadership,
      isLeadership: isNationalLeadership,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
