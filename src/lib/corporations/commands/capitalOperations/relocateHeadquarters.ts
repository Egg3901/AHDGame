import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import type { Corporation, State } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  SECTOR_FX_SPREAD,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { logWireEvent } from "@/lib/wireEvent";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCountryAccess } from "@/lib/countryAccess";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { computeCorpRelocationCost } from "@/lib/corporations/relocationCost";
import { previewRelocationBond, issueRelocationBond } from "@/lib/corporations/issueRelocationBond";
import {
  convertCorpCurrency,
  type ConvertCorpCurrencySuccess,
} from "@/lib/corporations/convertCorpCurrency";
import { doesCeoResideAtHeadquarters } from "@/lib/corporations/ceoResidency";

const relocateSchema = z.object({
  targetStateId: z.string().min(1, "Target state/region ID required"),
  // Optional for back-compat; required to disambiguate cross-country state-ID
  // collisions (e.g. CN HB / DE HB). When omitted we fall back to the
  // corporation's current country, preserving prior behavior for same-country moves.
  targetCountryId: z.string().min(2).max(3).optional(),
  paymentMethod: z.enum(["cash", "bond"]),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/relocate
 * Relocate corporation HQ. CEO only. Cost 7% of market cap in-country,
 * 14% cross-country. Payment via corp Liquid Capital or 7-year bond.
 * If the CEO does not reside at the new HQ state, CEO is auto-vacated.
 *
 * Cross-country moves additionally convert the corp's home currency to the
 * new country's currency (liquidCapital, sharePrice, budgets, ceoSalary, all
 * sector revenue). Open share orders and listings are cancelled + refunded
 * first — their prices are denominated in the pre-conversion currency.
 * Existing bonds retain their original currencyCode (design contract:
 * denomination fixed at issuance).
 */
export async function relocateHeadquarters(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, relocateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetStateId, targetCountryId, paymentMethod } = parsed.data;
    const normalizedTarget = targetStateId.trim();
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const resolvedTargetCountryId = (targetCountryId ??
      corporation.countryId) as typeof corporation.countryId;
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: normalizedTarget, countryId: resolvedTargetCountryId });
    if (!targetState) {
      return NextResponse.json({ error: "Invalid target state or region" }, { status: 400 });
    }
    if (corporation.headquartersState === normalizedTarget) {
      return NextResponse.json(
        { error: "Corporation is already headquartered in this state" },
        { status: 400 }
      );
    }

    if (!corporation.isPrivate && targetState.countryId) {
      const passedVote = await db.collection("corporationVotes").findOne({
        corporationId: corporation._id,
        type: "relocation",
        status: "passed",
        "payload.destinationCountryId": targetState.countryId,
        "payload.destinationStateCode": normalizedTarget,
      });
      if (!passedVote) {
        return NextResponse.json(
          {
            error:
              "Public corporations require a passed shareholder relocation vote. Propose one from the admin tab.",
          },
          { status: 403 }
        );
      }
    }

    if (targetState.countryId) {
      const targetAccess = await getCountryAccess(targetState.countryId);
      // Every econ-only nation is closed to relocation, not just the ones
      // carrying the `economyPreview` flag — the old condition let a corp move
      // its HQ into a coming-soon country (the whole Eastern bloc).
      if (targetAccess.econOnly) {
        return NextResponse.json(
          {
            error: `Cannot relocate to ${targetState.name} — ${targetState.countryId} is an econ-only nation and not open for corporate relocation.`,
          },
          { status: 400 }
        );
      }
    }

    let corpCountryId: CountryId | undefined = corporation.countryId;
    if (!corpCountryId && corporation.headquartersState) {
      const currentHq = await db
        .collection<State>("states")
        .findOne({ _id: corporation.headquartersState }, { projection: { countryId: 1 } });
      corpCountryId = currentHq?.countryId;
    }
    if (!corpCountryId) {
      return NextResponse.json(
        { error: "Corporation has no resolvable home country" },
        { status: 400 }
      );
    }

    // Load FX rates once — used for cost math and any currency conversion.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);

    // Cost is 7% in-country, 14% cross-country. Helper returns ₳.
    const { cost: relocationCost, crossCountry } = computeCorpRelocationCost(
      { ...corporation, countryId: corpCountryId },
      targetState.countryId,
      corpFxRate
    );
    if (relocationCost <= 0) {
      return NextResponse.json(
        { error: "Cannot relocate — market capitalization is too low" },
        { status: 400 }
      );
    }

    const isImperialCeo = corporation.ceoType === "imperial";
    const ceoChar = isImperialCeo
      ? await db
          .collection<ImperialCharacter>("imperialCharacters")
          .findOne({ _id: corporation.ceoId }, { projection: { userId: 1, homeState: 1 } })
      : await db
          .collection<Character>("characters")
          .findOne({ _id: corporation.ceoId }, { projection: { userId: 1, homeState: 1 } });
    if (!ceoChar) {
      return NextResponse.json({ error: "CEO record not found" }, { status: 400 });
    }
    if (ceoChar.userId.toString() !== auth.user.userId) {
      return NextResponse.json({ error: "Only the CEO can perform this action" }, { status: 403 });
    }
    const ceoVacated = !doesCeoResideAtHeadquarters(ceoChar.homeState, normalizedTarget);

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const now = new Date();

    const baseCorpSet: Partial<Corporation> = {
      headquartersState: normalizedTarget,
      countryId: targetState.countryId,
      ...(ceoVacated ? { ceoVacant: true } : {}),
      updatedAt: now,
    };

    // Cross-country moves across a currency boundary trigger full treasury
    // conversion. Same-country moves (or moves to a country with the same
    // currency) skip this entirely — liquidCurrencyCode stays unchanged.
    const newCurrency = COUNTRY_CURRENCY_MAP[targetState.countryId] as CurrencyCode | undefined;
    const oldCurrency = resolveCorpLiquidCurrencyCode(corporation);
    const needsCurrencyConversion =
      crossCountry && newCurrency !== undefined && newCurrency !== oldCurrency;
    // Cross-currency HQ relocation pays the reduced sector FX spread on the
    // relocation cost (the treasury crosses a currency boundary). Routed after
    // the move commits, on the cash path.
    const relocationSpreadAnchor = needsCurrencyConversion ? relocationCost * SECTOR_FX_SPREAD : 0;

    // ── No-mutation validations first so partial failures are minimized ──
    if (paymentMethod === "cash") {
      // Affordability check in ₳ (currency-invariant).
      const corpCapitalAnchor = corpLiquidCapitalToAnchor(
        corporation.liquidCapital,
        corporation,
        corpFxRate
      );
      if (corpCapitalAnchor < relocationCost + relocationSpreadAnchor) {
        return NextResponse.json(
          {
            error: `Insufficient cash. Need ${Math.round(relocationCost + relocationSpreadAnchor).toLocaleString()}, have ${Math.round(corporation.liquidCapital).toLocaleString()}.`,
          },
          { status: 400 }
        );
      }
    }

    // Bond preflight runs BEFORE any mutation. On failure we return without
    // cancelling orders or touching the currency.
    let bondPreflight: Awaited<ReturnType<typeof previewRelocationBond>> | null = null;
    if (paymentMethod === "bond") {
      bondPreflight = await previewRelocationBond(
        db,
        corporation,
        relocationCost,
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

    // ── Mutations begin ──
    let currencyConversion: ConvertCorpCurrencySuccess | null = null;
    let workingCorp: Corporation = corporation;
    let workingFxRate = corpFxRate;

    if (needsCurrencyConversion && newCurrency) {
      const forexEnabled = await isForexEnabled();
      const convResult = await convertCorpCurrency(
        db,
        corporation,
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
      // Only refetch when conversion actually mutated the corp — skipping the
      // round trip on no-op conversions keeps same-currency moves cheap.
      if (convResult.converted) {
        const refreshed = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id });
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
      const relocationInCorpCapital = anchorToCorpLiquidCapital(
        relocationCost + relocationSpreadAnchor,
        workingCorp,
        workingFxRate
      );

      await db.collection<Corporation>("corporations").updateOne(
        { _id: workingCorp._id },
        {
          $set: baseCorpSet,
          ...(ceoVacated ? { $unset: { ceoId: "", userId: "" } } : {}),
          $inc: { liquidCapital: -relocationInCorpCapital },
        }
      );

      // Route the cross-currency relocation spread (old → new currency).
      if (relocationSpreadAnchor > 0 && oldCurrency && newCurrency) {
        await safeDistributeConversionSpread(
          db,
          Math.round(anchorToCorpLiquidCapital(relocationSpreadAnchor, workingCorp, workingFxRate)),
          oldCurrency as CurrencyCode,
          newCurrency
        );
      }

      if (ceoVacated && corporation.ceoId) {
        await closeCeoTenure(db, workingCorp._id, {
          holderId: corporation.ceoId,
          turn: currentTurn,
        });
      }

      logWireEvent(
        "corporation_relocated",
        wireHeadlineCorpRelocated(corporation.name, targetState.name, relocationCost),
        { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
      );

      return NextResponse.json({
        success: true,
        paymentMethod: "cash",
        cost: relocationCost,
        crossCountry,
        newHeadquarters: normalizedTarget,
        newHeadquartersName: targetState.name,
        newCountryId: targetState.countryId,
        ceoVacated,
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
      });
    }

    // Bond path — preflight already validated above. Issue the bond now; it
    // stamps the (possibly new) corp currency.
    if (!bondPreflight) {
      return NextResponse.json({ error: "Internal bond-path error" }, { status: 500 });
    }
    const bondResult = await issueRelocationBond(
      db,
      workingCorp,
      relocationCost,
      currentTurn,
      bondPreflight,
      fxByCurrency
    );
    if (!bondResult.ok) return bondResult.response;
    const { bondFaceValue, couponRate, creditRating } = bondResult.data;

    const netDeltaInCorpCapital = anchorToCorpLiquidCapital(
      bondFaceValue - relocationCost,
      workingCorp,
      workingFxRate
    );
    await db.collection<Corporation>("corporations").updateOne(
      { _id: workingCorp._id },
      {
        $set: baseCorpSet,
        ...(ceoVacated ? { $unset: { ceoId: "", userId: "" } } : {}),
        $inc: { liquidCapital: netDeltaInCorpCapital },
      }
    );

    if (ceoVacated && corporation.ceoId) {
      await closeCeoTenure(db, workingCorp._id, {
        holderId: corporation.ceoId,
        turn: currentTurn,
      });
    }

    logWireEvent(
      "corporation_relocated",
      wireHeadlineCorpRelocated(corporation.name, targetState.name, relocationCost),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );

    return NextResponse.json({
      success: true,
      paymentMethod: "bond",
      cost: relocationCost,
      crossCountry,
      bondFaceValue,
      couponRate,
      creditRating,
      newHeadquarters: normalizedTarget,
      newHeadquartersName: targetState.name,
      newCountryId: targetState.countryId,
      ceoVacated,
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
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const CORP_RELOCATED_TEMPLATES = [
  (name: string, dest: string, costLabel: string) =>
    `RELOCATION: ${name} moves headquarters to ${dest} — ${costLabel} in moving costs`,
  (name: string, dest: string, costLabel: string) =>
    `HQ MOVE: ${name} relocates to ${dest}, spending ${costLabel}`,
  (name: string, dest: string, _costLabel: string) =>
    `CORPORATE MOVE: ${name} packs up, sets new HQ in ${dest}`,
  (name: string, dest: string, costLabel: string) =>
    `NEW ADDRESS: ${name} relocates headquarters to ${dest} at a cost of ${costLabel}`,
];

function wireHeadlineCorpRelocated(name: string, destination: string, cost: number): string {
  const costLabel = formatFundsCompact(Math.round(cost));
  const tpl = CORP_RELOCATED_TEMPLATES[Math.floor(Math.random() * CORP_RELOCATED_TEMPLATES.length)];
  return tpl(name, destination, costLabel);
}
