/**
 * POST /api/character/relocate
 *
 * Relocate character to a new state/region.
 * - Regional political capital (politicalInfluence, donorBaseLevel, groupFavorability) always resets to 0.
 * - nationalInfluence, partyInfluence, and party only reset on country change.
 * - Active candidacies (general/primary, state-party, national-party, committee) are auto-withdrawn.
 * - State/region-bound currentOffice seats auto-resign; country-scoped offices (VP, President,
 *   cabinet, …) only resign on country change. CEO role always resigns (unless NatCorp same-country
 *   / relocate-with-corp). Central-bank chair resigns on country change only.
 * - A "relocated" entry is appended to careerHistory.
 *
 * Blocking conditions:
 *   - target must exist and differ from current homeState
 *   - 72-turn (3 real day) cooldown since lastRelocatedTurn / lastRelocatedAt
 *   - destination country must be enabledForPlayers (admins bypass)
 */

import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { getActiveCandidacySummary } from "@/lib/character/relocationCampaigns";
import { performRelocation } from "@/lib/character/performRelocation";
import { getCountryAccess } from "@/lib/countryAccess";
import { getGameState } from "@/lib/gameState";
import { getGameTime } from "@/lib/time/gameTime";
import { getCorpFxRate, corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { computeCorpRelocationCost } from "@/lib/corporations/relocationCost";
import { previewRelocationBond } from "@/lib/corporations/issueRelocationBond";
import { findActiveResidentCeoCorporation } from "@/lib/corporations/ceoResidency";
import {
  getRelocationCooldownStatus,
  RELOCATION_COOLDOWN_TURNS,
  RELOCATION_COOLDOWN_DAYS,
} from "@/lib/character/relocationCooldown";
import { officeHasStateResidency } from "@/lib/character/officeResignsOnRelocation";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { isUsResidentPoliticalRegion } from "@/lib/elections/statehoodAdmission";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";

const relocateBodySchema = z.object({
  targetStateId: z.string().min(1, "Target state/region ID required"),
  // Optional for back-compat; if omitted we use the character's current country
  // (in-country relocations only). Required to enable cross-country moves
  // safely against cross-country state-ID collisions.
  targetCountryId: z.string().min(2).max(3).optional(),
});

// POST /api/character/relocate — Run the relocation pipeline for the authenticated character.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(auth.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, relocateBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const normalizedTarget = parsed.data.targetStateId.trim();
    const targetCountryId = (
      parsed.data.targetCountryId ?? auth.character.countryId
    ).toUpperCase() as import("@/lib/constants/countries").CountryId;

    const db = await getDb();

    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: normalizedTarget, countryId: targetCountryId });
    if (!targetState) {
      return NextResponse.json({ error: "Invalid target state or region" }, { status: 400 });
    }

    if (targetCountryId === "US") {
      const { admittedIds, preset } = await loadUsPoliticalStateIds(db);
      if (!isUsResidentPoliticalRegion(normalizedTarget, preset, admittedIds)) {
        return NextResponse.json(
          { error: unplayableTerritoryHomeError(targetState.name) },
          { status: 400 }
        );
      }
    }

    if (auth.character.homeState === normalizedTarget) {
      return NextResponse.json({ error: "Already in this state/region" }, { status: 400 });
    }

    // Turn-first relocation cooldown (72 turns); legacy Date fallback inside the
    // helper. Game clock used so a paused/drifted real clock can't move it.
    const gameTime = await getGameTime();
    const cooldown = getRelocationCooldownStatus(
      auth.character,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime(),
      Date.now()
    );
    if (cooldown.onCooldown) {
      return NextResponse.json(
        {
          error: `Relocation cooldown active. You can relocate again in ${cooldown.cooldownRemainingDays} day(s).`,
          cooldownRemainingDays: cooldown.cooldownRemainingDays,
        },
        { status: 429 }
      );
    }

    const currentCountryId = auth.character.countryId ?? "US";
    const isChangingCountry = targetState.countryId !== currentCountryId;
    if (isChangingCountry && auth.isAdmin !== true) {
      const { enabledForPlayers } = await getCountryAccess(targetState.countryId);
      if (!enabledForPlayers) {
        return NextResponse.json(
          { error: "Relocation to this country is not currently available." },
          { status: 403 }
        );
      }
    }

    const outcome = await performRelocation(db, auth.character, targetState);

    const notes: string[] = [];
    if (outcome.resignedFromOffice) notes.push(`Resigned from ${outcome.resignedFromOffice}.`);
    if (outcome.ceoResignedFrom) notes.push(`Removed as CEO of ${outcome.ceoResignedFrom}.`);
    if (outcome.chairResignedFrom)
      notes.push(`Resigned as central bank chair (${outcome.chairResignedFrom}).`);
    if (outcome.leftPartyName) notes.push(`Left ${outcome.leftPartyName}; now independent.`);
    const totalWithdrawals =
      outcome.withdrawnGeneralElections +
      outcome.withdrawnStatePartyElections +
      outcome.withdrawnNationalPartyElections +
      outcome.withdrawnCommitteeElections;
    if (totalWithdrawals > 0)
      notes.push(`Withdrew from ${totalWithdrawals} active candidacy(ies).`);

    // Cooldown begins now (72 turns). Project the end instant from real time so
    // the value the client shows is drift-immune.
    return NextResponse.json({
      success: true,
      message: `Relocated to ${targetState.name}.${notes.length ? " " + notes.join(" ") : ""}`,
      homeState: normalizedTarget,
      homeStateName: targetState.name,
      cooldownUntil: new Date(Date.now() + RELOCATION_COOLDOWN_TURNS * MS_PER_TURN).toISOString(),
      resignedFromOffice: outcome.resignedFromOffice,
      ceoResignedFrom: outcome.ceoResignedFrom,
      chairResignedFrom: outcome.chairResignedFrom,
      leftPartyName: outcome.leftPartyName,
      withdrawnGeneralElections: outcome.withdrawnGeneralElections,
      withdrawnStatePartyElections: outcome.withdrawnStatePartyElections,
      withdrawnNationalPartyElections: outcome.withdrawnNationalPartyElections,
      withdrawnCommitteeElections: outcome.withdrawnCommitteeElections,
      countryChanged: outcome.countryChanged,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/character/relocate — Return cooldown status and a preview of the candidacies/roles that will be affected.
// Auth: requireAuthWithCharacter
// Errors: 401
export async function GET() {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const gameTime = await getGameTime();
    const cooldown = getRelocationCooldownStatus(
      auth.character,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime(),
      Date.now()
    );
    const onCooldown = cooldown.onCooldown;
    const cooldownRemainingDays = cooldown.cooldownRemainingDays;
    const cooldownUntil = cooldown.cooldownUntil;

    const db = await getDb();
    const characterId = auth.character._id;

    const candidacies = await getActiveCandidacySummary(db, characterId);

    const ceoCorp = await findActiveResidentCeoCorporation(
      db,
      characterId,
      auth.character.homeState
    );

    let corpRelocation: {
      corpId: string;
      corpName: string;
      currentHqState: string;
      currentCountryId: string;
      isImperialCeo: boolean;
      marketCap: number;
      liquidCapitalAnchor: number;
      bondCooldownTurnsRemaining: number | null;
      bondLeverageAvailable: number;
    } | null = null;

    if (ceoCorp) {
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 1;
      const corpFxRate = await getCorpFxRate(db, ceoCorp);
      const liquidAnchor = corpLiquidCapitalToAnchor(ceoCorp.liquidCapital, ceoCorp, corpFxRate);
      // Use in-country cost as the base preview; the UI doubles when the
      // target country differs from the corp's home country.
      // baseMarketCap is ₳; pass corpFxRate so JPY/GBP corps are normalized.
      const { baseMarketCap } = computeCorpRelocationCost(ceoCorp, ceoCorp.countryId, corpFxRate);
      // Preview bond capacity using a 1-unit hypothetical cost so the
      // leverage/availability numbers don't depend on a target.
      const preflight = await previewRelocationBond(db, ceoCorp, 1, currentTurn);
      corpRelocation = {
        corpId: ceoCorp._id.toString(),
        corpName: ceoCorp.name,
        currentHqState: ceoCorp.headquartersState,
        currentCountryId: ceoCorp.countryId,
        isImperialCeo: ceoCorp.ceoType === "imperial",
        marketCap: Math.round(baseMarketCap),
        liquidCapitalAnchor: Math.round(liquidAnchor),
        bondCooldownTurnsRemaining: preflight.cooldownTurnsRemaining,
        bondLeverageAvailable: Math.round(preflight.availableBondCapacity),
      };
    }

    return NextResponse.json({
      canRelocate: !onCooldown,
      remainingTurns: cooldown.remainingTurns,
      cooldownRemainingDays,
      cooldownUntil,
      cooldownDays: RELOCATION_COOLDOWN_DAYS,
      homeState: auth.character.homeState,
      hasOffice: !!auth.character.currentOffice,
      // True when an in-country move would vacate the seat (governor/house/…).
      // Country-scoped offices (VP/President/cabinet) only resign on country change.
      officeRequiresStateResidency: officeHasStateResidency(auth.character.currentOffice),
      isCeo: !!ceoCorp,
      ceoCorpName: ceoCorp?.name ?? null,
      activeCandidacies: candidacies,
      corpRelocation,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
