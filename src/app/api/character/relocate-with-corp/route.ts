/**
 * POST /api/character/relocate-with-corp
 *
 * Combined character + corporation relocation. CEO only.
 * - Character pipeline runs via performRelocation with skipCeoResignForCorpId
 *   so the CEO role is preserved.
 * - Corp HQ + countryId updated; cost 7% in-country, 14% cross-country.
 * - Imperial CEO flows as `paymentMethod: "imperial-free"` with cost 0.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { State, Corporation } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { performRelocation } from "@/lib/character/performRelocation";
import { getCountryAccess } from "@/lib/countryAccess";
import { getGameState } from "@/lib/gameState";
import { getGameTime } from "@/lib/time/gameTime";
import { logWireEvent } from "@/lib/wireEvent";
import { formatFundsCompact } from "@/lib/utils/formatters";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { computeCorpRelocationCost } from "@/lib/corporations/relocationCost";
import { previewRelocationBond, issueRelocationBond } from "@/lib/corporations/issueRelocationBond";
import {
  convertCorpCurrency,
  type ConvertCorpCurrencySuccess,
} from "@/lib/corporations/convertCorpCurrency";
import { findActiveResidentCeoCorporation } from "@/lib/corporations/ceoResidency";
import {
  getRelocationCooldownStatus,
  RELOCATION_COOLDOWN_TURNS,
} from "@/lib/character/relocationCooldown";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { isUsResidentPoliticalRegion } from "@/lib/elections/statehoodAdmission";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";

const bodySchema = z.object({
  targetStateId: z.string().min(1, "Target state/region ID required"),
  // Optional for back-compat; falls back to the character's current country
  // when omitted (in-country relocations). Required for cross-country moves
  // when state-IDs could collide (e.g. CN HB / DE HB).
  targetCountryId: z.string().min(2).max(3).optional(),
  paymentMethod: z.enum(["cash", "bond", "imperial-free"]),
});

// POST /api/character/relocate-with-corp
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(auth.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetStateId, targetCountryId, paymentMethod } = parsed.data;
    const normalizedTarget = targetStateId.trim();
    const resolvedTargetCountryId = (
      targetCountryId ?? auth.character.countryId
    ).toUpperCase() as import("@/lib/constants/countries").CountryId;

    const db = await getDb();

    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: normalizedTarget, countryId: resolvedTargetCountryId });
    if (!targetState) {
      return NextResponse.json({ error: "Invalid target state or region" }, { status: 400 });
    }
    if (resolvedTargetCountryId === "US") {
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
    // Turn-first relocation cooldown (72 turns); legacy Date fallback in helper.
    const cooldownGameTime = await getGameTime();
    const cooldown = getRelocationCooldownStatus(
      auth.character,
      cooldownGameTime.currentTurn,
      cooldownGameTime.effectiveNow.getTime(),
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

    const corp = await findActiveResidentCeoCorporation(
      db,
      auth.character._id,
      auth.character.homeState
    );
    if (!corp) {
      return NextResponse.json(
        { error: "You are not a CEO — use /api/character/relocate instead." },
        { status: 400 }
      );
    }

    const isImperial = corp.ceoType === "imperial";
    if (paymentMethod === "imperial-free" && !isImperial) {
      return NextResponse.json(
        { error: "Imperial-free payment only valid for imperial CEOs." },
        { status: 400 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrency);

    // Helper returns cost in ₳; pass corpFxRate so JPY/GBP corps are normalized.
    const { cost: relocationCost, crossCountry } = computeCorpRelocationCost(
      corp,
      targetState.countryId,
      corpFxRate
    );
    const effectiveCost = paymentMethod === "imperial-free" ? 0 : relocationCost;
    const now = new Date();

    let bondFaceValue: number | undefined;
    let couponRate: number | undefined;
    let creditRating: string | undefined;

    const baseCorpSet: Partial<Corporation> = {
      headquartersState: normalizedTarget,
      countryId: targetState.countryId,
      updatedAt: now,
    };

    // Cross-country cross-currency moves convert the corp's treasury + sectors
    // before cost is deducted; see player-relocate route for the full contract.
    const newCurrency = COUNTRY_CURRENCY_MAP[targetState.countryId] as CurrencyCode | undefined;
    const oldCurrency = resolveCorpLiquidCurrencyCode(corp);
    const needsCurrencyConversion =
      crossCountry && newCurrency !== undefined && newCurrency !== oldCurrency;

    // ── No-mutation validations first ──
    if (paymentMethod === "cash") {
      const capitalAnchor = corpLiquidCapitalToAnchor(corp.liquidCapital, corp, corpFxRate);
      if (capitalAnchor < effectiveCost) {
        return NextResponse.json(
          {
            error: `Insufficient cash. Need ${effectiveCost.toLocaleString()}, have ${Math.round(corp.liquidCapital).toLocaleString()}.`,
          },
          { status: 400 }
        );
      }
    }

    let bondPreflight: Awaited<ReturnType<typeof previewRelocationBond>> | null = null;
    if (paymentMethod === "bond") {
      bondPreflight = await previewRelocationBond(
        db,
        corp,
        effectiveCost,
        currentTurn,
        fxByCurrency
      );
      if (bondPreflight.cooldownTurnsRemaining != null) {
        return NextResponse.json(
          {
            error: `Bond issuance on cooldown. ${bondPreflight.cooldownTurnsRemaining} turns remaining.`,
          },
          { status: 400 }
        );
      }
      if (!bondPreflight.ok) {
        return NextResponse.json(
          {
            error: `Bond issuance would exceed leverage limit. Current debt: ${Math.round(bondPreflight.existingDebt).toLocaleString()}, equity: ${Math.round(bondPreflight.totalEquity).toLocaleString()}.`,
          },
          { status: 400 }
        );
      }
    }

    // ── Mutations ──
    let currencyConversion: ConvertCorpCurrencySuccess | null = null;
    let workingCorp: Corporation = corp;
    let workingFxRate = corpFxRate;
    if (needsCurrencyConversion && newCurrency) {
      const forexEnabled = await isForexEnabled();
      const convResult = await convertCorpCurrency(
        db,
        corp,
        newCurrency,
        fxByCurrency,
        now,
        forexEnabled
      );
      if (!convResult.ok) {
        return NextResponse.json(
          { error: convResult.error },
          { status: convResult.rateUnavailable ? 503 : 400 }
        );
      }
      currencyConversion = convResult;
      if (convResult.converted) {
        const refreshed = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corp._id });
        if (!refreshed) {
          return NextResponse.json(
            { error: "Corporation not found after currency conversion" },
            { status: 500 }
          );
        }
        workingCorp = refreshed;
        workingFxRate = fxRateForCorpFromMap(workingCorp, fxByCurrency);
      }
    }

    if (paymentMethod === "cash") {
      const deltaInCorp = anchorToCorpLiquidCapital(effectiveCost, workingCorp, workingFxRate);
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: workingCorp._id },
          { $set: baseCorpSet, $inc: { liquidCapital: -deltaInCorp } }
        );
    } else if (paymentMethod === "bond") {
      if (!bondPreflight) {
        return NextResponse.json({ error: "Internal bond-path error" }, { status: 500 });
      }
      const bondResult = await issueRelocationBond(
        db,
        workingCorp,
        effectiveCost,
        currentTurn,
        bondPreflight,
        fxByCurrency
      );
      if (!bondResult.ok) return bondResult.response;
      bondFaceValue = bondResult.data.bondFaceValue;
      couponRate = bondResult.data.couponRate;
      creditRating = bondResult.data.creditRating;
      const netDelta = anchorToCorpLiquidCapital(
        bondFaceValue - effectiveCost,
        workingCorp,
        workingFxRate
      );
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: workingCorp._id },
          { $set: baseCorpSet, $inc: { liquidCapital: netDelta } }
        );
    } else {
      // imperial-free — no payment, no bond, just move
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: workingCorp._id }, { $set: baseCorpSet });
    }

    const outcome = await performRelocation(db, auth.character, targetState, {
      skipCeoResignForCorpId: corp._id,
    });

    logWireEvent(
      "corporation_relocated",
      `RELOCATION: ${corp.name} and CEO move to ${targetState.name} — ${formatFundsCompact(Math.round(effectiveCost))}`,
      { href: `/corporation/${corp.sequentialId ?? corp._id}` }
    );

    const notes: string[] = [];
    if (outcome.resignedFromOffice) notes.push(`Resigned from ${outcome.resignedFromOffice}.`);
    if (outcome.chairResignedFrom)
      notes.push(`Resigned as central bank chair (${outcome.chairResignedFrom}).`);
    if (outcome.leftPartyName) notes.push(`Left ${outcome.leftPartyName}; now independent.`);

    // Cooldown begins now (72 turns). Project from real time → drift-immune.
    return NextResponse.json({
      success: true,
      character: {
        homeState: normalizedTarget,
        homeStateName: targetState.name,
        cooldownUntil: new Date(Date.now() + RELOCATION_COOLDOWN_TURNS * MS_PER_TURN).toISOString(),
        notes,
        countryChanged: outcome.countryChanged,
        withdrawnGeneralElections: outcome.withdrawnGeneralElections,
        withdrawnStatePartyElections: outcome.withdrawnStatePartyElections,
        withdrawnNationalPartyElections: outcome.withdrawnNationalPartyElections,
        withdrawnCommitteeElections: outcome.withdrawnCommitteeElections,
        resignedFromOffice: outcome.resignedFromOffice,
        chairResignedFrom: outcome.chairResignedFrom,
        leftPartyName: outcome.leftPartyName,
      },
      corporation: {
        corpId: corp._id.toString(),
        corpName: corp.name,
        newHeadquarters: normalizedTarget,
        newHeadquartersName: targetState.name,
        newCountryId: targetState.countryId,
        cost: effectiveCost,
        crossCountry,
        paymentMethod,
        ...(bondFaceValue !== undefined ? { bondFaceValue, couponRate, creditRating } : {}),
        currencyConversion: currencyConversion?.converted
          ? {
              from: currencyConversion.fromCurrency,
              to: currencyConversion.toCurrency,
              scale: currencyConversion.scale,
              sectorsConverted: currencyConversion.sectorsConverted,
              ordersCancelled: currencyConversion.ordersCancelled,
              listingsCancelled: currencyConversion.listingsCancelled,
            }
          : null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
