import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CountryId } from "@/lib/constants/countries";
import { commandEconomyRelocationBlock } from "@/lib/corporations/relocationCommandEconomyGate";
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
import {
  acquireRelocationBondFundingLease,
  hasProtectedRelocationProperty,
  relocationBondSourceSnapshotFilter,
  releaseRelocationBondFundingLease,
} from "@/lib/corporations/relocationBondFunding";
import {
  reserveSectorsForTransition,
  releaseConstructionPropertyTransition,
} from "@/lib/corporations/securedConstructionProperty";

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

class RelocationUnderwritingLeaseConflict extends Error {}

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
      return errorResponse(parsed.status, parsed.error);
    }

    const { targetStateId, targetCountryId, paymentMethod } = parsed.data;
    const normalizedTarget = targetStateId.trim();
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (corporation.primaryUnderwritingIncomingFunding || corporation.bankUnderwritingFunding) {
      return errorResponse(
        409,
        "Primary underwriting cash is settling; retry relocation after settlement"
      );
    }

    const propertySectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .toArray();
    if (
      hasProtectedRelocationProperty(
        propertySectors,
        corporation._id,
        corporation.headquartersRelocationBondFunding
      )
    ) {
      return errorResponse(
        409,
        "Resolve secured construction before relocating corporate headquarters"
      );
    }

    if (corporation.federationPendingHeadquartersId) {
      return errorResponse(
        409,
        "Choose this firm's new headquarters through its pending federation settlement."
      );
    }

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const resolvedTargetCountryId = (targetCountryId ??
      corporation.countryId) as typeof corporation.countryId;
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: normalizedTarget, countryId: resolvedTargetCountryId });
    if (!targetState) {
      return errorResponse(400, "Invalid target state or region");
    }
    if (corporation.headquartersState === normalizedTarget) {
      return errorResponse(400, "Corporation is already headquartered in this state");
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
        return errorResponse(
          403,
          "Public corporations require a passed shareholder relocation vote. Propose one from the admin tab."
        );
      }
    }

    if (targetState.countryId) {
      const targetAccess = await getCountryAccess(targetState.countryId);
      // Every econ-only nation is closed to relocation, not just the ones
      // carrying the `economyPreview` flag — the old condition let a corp move
      // its HQ into a coming-soon country (the whole Eastern bloc).
      if (targetAccess.econOnly) {
        return errorResponse(
          400,
          `Cannot relocate to ${targetState.name} — ${targetState.countryId} is an econ-only nation and not open for corporate relocation.`
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
      return errorResponse(400, "Corporation has no resolvable home country");
    }

    const commandEconomyBlock = await commandEconomyRelocationBlock(
      db,
      corporation,
      corpCountryId,
      targetState.countryId
    );
    if (commandEconomyBlock) {
      return errorResponse(400, commandEconomyBlock);
    }

    // Load FX rates once — used for cost math and any currency conversion.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);

    // Cost is 7% in-country, 14% cross-country. Helper returns ₳.
    const computedCost = computeCorpRelocationCost(
      { ...corporation, countryId: corpCountryId },
      targetState.countryId,
      corpFxRate
    );
    const existingBondLease = corporation.headquartersRelocationBondFunding;
    if (
      existingBondLease &&
      (existingBondLease.targetStateId !== normalizedTarget ||
        existingBondLease.targetCountryId !== targetState.countryId)
    ) {
      return errorResponse(
        409,
        "A relocation bond is awaiting publication; retry its original headquarters move"
      );
    }
    if (existingBondLease && paymentMethod !== "bond") {
      return errorResponse(
        409,
        "A relocation bond is awaiting publication; retry its original payment method"
      );
    }
    const relocationCost = existingBondLease?.relocationCostAnchor ?? computedCost.cost;
    const crossCountry = existingBondLease?.crossCountry ?? computedCost.crossCountry;
    if (relocationCost <= 0) {
      return errorResponse(400, "Cannot relocate — market capitalization is too low");
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
      return errorResponse(400, "CEO record not found");
    }
    if (ceoChar.userId.toString() !== auth.user.userId) {
      return errorResponse(403, "Only the CEO can perform this action");
    }
    const ceoVacated =
      existingBondLease?.ceoVacated ??
      !doesCeoResideAtHeadquarters(ceoChar.homeState, normalizedTarget);

    const gameState = await getGameState();
    const currentTurn = existingBondLease?.turn ?? gameState?.currentTurn ?? 1;

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
        return errorResponse(
          400,
          `Insufficient cash. Need ${Math.round(relocationCost + relocationSpreadAnchor).toLocaleString()}, have ${Math.round(corporation.liquidCapital).toLocaleString()}.`
        );
      }
    }

    // Bond preflight runs BEFORE any mutation. On failure we return without
    // cancelling orders or touching the currency.
    let bondPreflight: Awaited<ReturnType<typeof previewRelocationBond>> | null = null;
    if (paymentMethod === "bond" && existingBondLease) {
      bondPreflight = existingBondLease.preflight;
    } else if (paymentMethod === "bond") {
      bondPreflight = await previewRelocationBond(
        db,
        corporation,
        relocationCost,
        currentTurn,
        fxByCurrency
      );
      if (bondPreflight.cooldownTurnsRemaining != null) {
        return errorResponse(
          400,
          `Bond issuance on cooldown. ${bondPreflight.cooldownTurnsRemaining} turns remaining.`
        );
      }
      if (!bondPreflight.ok) {
        return errorResponse(
          400,
          `Bond issuance would exceed leverage limit. Current debt: ${Math.round(bondPreflight.existingDebt).toLocaleString()}, equity: ${Math.round(bondPreflight.totalEquity).toLocaleString()}.`
        );
      }
    }

    // ── Mutations begin ──
    let currencyConversion: ConvertCorpCurrencySuccess | null = null;
    let workingCorp: Corporation = corporation;
    let workingFxRate = corpFxRate;
    let frozenBondLease = existingBondLease;

    if (needsCurrencyConversion && newCurrency) {
      const forexEnabled = await isForexEnabled();
      const convResult = await convertCorpCurrency(
        db,
        corporation,
        newCurrency,
        fxByCurrency,
        now,
        forexEnabled,
        propertySectors
      );
      if (!convResult.ok) {
        return errorResponse(convResult.rateUnavailable ? 503 : 400, convResult.error);
      }
      currencyConversion = convResult;
      // Only refetch when conversion actually mutated the corp — skipping the
      // round trip on no-op conversions keeps same-currency moves cheap.
      if (convResult.converted) {
        const refreshed = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id });
        if (!refreshed) {
          return errorResponse(500, "Corporation not found after currency conversion");
        }
        workingCorp = refreshed;
        workingFxRate = fxRateForCorpFromMap(workingCorp, fxByCurrency);
      }
    }

    if (paymentMethod === "bond" && needsCurrencyConversion && !existingBondLease) {
      const postConversionPreflight = await previewRelocationBond(
        db,
        workingCorp,
        relocationCost,
        currentTurn,
        fxByCurrency
      );
      if (postConversionPreflight.cooldownTurnsRemaining != null || !postConversionPreflight.ok) {
        return errorResponse(
          409,
          "Relocation bond capacity changed during currency conversion; retry"
        );
      }
      bondPreflight = postConversionPreflight;
    }

    // Currency conversion reserves these same sector rows while it runs. For
    // same-currency relocations, hold a property marker through the final
    // cash or bond write so construction cannot be claimed after the read.
    const hqTransitionKeys = needsCurrencyConversion
      ? null
      : await reserveSectorsForTransition(
          db,
          propertySectors,
          "headquarters_relocation",
          `headquarters:${corporation._id.toHexString()}:${normalizedTarget}`,
          true
        );
    if (!needsCurrencyConversion && !hqTransitionKeys) {
      return errorResponse(
        409,
        "A sector changed or acquired secured construction during relocation"
      );
    }
    const releaseHqTransition = async () => {
      if (!hqTransitionKeys) return;
      await Promise.all(
        propertySectors.map((sector, index) =>
          releaseConstructionPropertyTransition(db, sector._id, hqTransitionKeys[index])
        )
      );
    };

    try {
      if (paymentMethod === "cash") {
        const relocationInCorpCapital = anchorToCorpLiquidCapital(
          relocationCost + relocationSpreadAnchor,
          workingCorp,
          workingFxRate
        );

        const updateResult = await db.collection<Corporation>("corporations").updateOne(
          {
            _id: workingCorp._id,
            primaryUnderwritingIncomingFunding: { $exists: false },
            bankUnderwritingFunding: { $exists: false },
            headquartersRelocationBondFunding: { $exists: false },
          },
          {
            $set: baseCorpSet,
            ...(ceoVacated ? { $unset: { ceoId: "", userId: "" } } : {}),
            $inc: { liquidCapital: -relocationInCorpCapital },
          }
        );
        if (updateResult.matchedCount !== 1) {
          return errorResponse(
            409,
            "Primary underwriting cash is settling; retry relocation after settlement"
          );
        }

        // Route the cross-currency relocation spread (old → new currency).
        if (relocationSpreadAnchor > 0 && oldCurrency && newCurrency) {
          await safeDistributeConversionSpread(
            db,
            Math.round(
              anchorToCorpLiquidCapital(relocationSpreadAnchor, workingCorp, workingFxRate)
            ),
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
        return errorResponse(500, "Internal bond-path error");
      }
      if (!frozenBondLease) {
        const operationKey = `hq-bond:${workingCorp._id.toHexString()}:${targetState.countryId}:${normalizedTarget}:${currentTurn}`;
        const acquiredLease = await acquireRelocationBondFundingLease(db, workingCorp, {
          operationKey,
          targetStateId: normalizedTarget,
          targetCountryId: targetState.countryId,
          turn: currentTurn,
          relocationCostAnchor: relocationCost,
          crossCountry,
          relocationSpreadAnchor,
          currencyCode: resolveCorpLiquidCurrencyCode(workingCorp) ?? "USD",
          nativeFxRate: workingFxRate,
          sourceCountryIdPresent: Object.hasOwn(workingCorp, "countryId"),
          ...(Object.hasOwn(workingCorp, "countryId")
            ? { sourceCountryId: workingCorp.countryId }
            : {}),
          sourceLiquidCurrencyCodePresent: Object.hasOwn(workingCorp, "liquidCurrencyCode"),
          ...(Object.hasOwn(workingCorp, "liquidCurrencyCode")
            ? { sourceLiquidCurrencyCode: workingCorp.liquidCurrencyCode }
            : {}),
          bondId: new ObjectId(),
          preflight: bondPreflight,
          ceoVacated,
          ...(workingCorp.ceoId ? { ceoId: workingCorp.ceoId } : {}),
          ...(workingCorp.ceoType ? { ceoType: workingCorp.ceoType } : {}),
        });
        if (!acquiredLease) {
          return errorResponse(409, "Corporate funding changed during relocation; retry the move");
        }
        frozenBondLease = acquiredLease;
      }
      if (frozenBondLease.currencyCode !== resolveCorpLiquidCurrencyCode(workingCorp)) {
        return errorResponse(
          409,
          "The frozen relocation bond quote no longer matches corporate currency"
        );
      }
      const bondCommit = await runTransactionWithSessionRetry(getMongoClient, async (session) => {
        if (!session) return { status: "transactions_unavailable" as const };
        const leaseFreeFilter = {
          _id: workingCorp._id,
          "headquartersRelocationBondFunding.operationKey": frozenBondLease!.operationKey,
          ...relocationBondSourceSnapshotFilter(frozenBondLease!),
          ...(frozenBondLease!.ceoId
            ? {
                ceoId: frozenBondLease!.ceoId,
                ...(frozenBondLease!.ceoType !== undefined
                  ? { ceoType: frozenBondLease!.ceoType }
                  : { ceoType: { $exists: false } }),
              }
            : { ceoId: { $exists: false }, ceoType: { $exists: false } }),
          primaryUnderwritingIncomingFunding: { $exists: false },
          bankUnderwritingFunding: { $exists: false },
        };
        const leaseFree = await db
          .collection<Corporation>("corporations")
          .findOne(leaseFreeFilter, { projection: { _id: 1 }, session });
        if (!leaseFree) return { status: "underwriting_busy" as const };

        const frozenFxByCurrency = new Map(fxByCurrency);
        frozenFxByCurrency.set(frozenBondLease!.currencyCode, frozenBondLease!.nativeFxRate);
        const bondResult = await issueRelocationBond(
          db,
          workingCorp,
          frozenBondLease!.relocationCostAnchor,
          frozenBondLease!.turn,
          frozenBondLease!.preflight,
          frozenFxByCurrency,
          session,
          frozenBondLease!.bondId
        );
        if (!bondResult.ok)
          return { status: "bond_refused" as const, response: bondResult.response };
        const netDeltaInCorpCapital = anchorToCorpLiquidCapital(
          bondResult.data.bondFaceValue - frozenBondLease!.relocationCostAnchor,
          workingCorp,
          frozenBondLease!.nativeFxRate
        );
        const updateResult = await db.collection<Corporation>("corporations").updateOne(
          leaseFreeFilter,
          {
            $set: baseCorpSet,
            $unset: {
              headquartersRelocationBondFunding: "",
              ...(ceoVacated ? { ceoId: "", userId: "" } : {}),
            },
            $inc: { liquidCapital: netDeltaInCorpCapital },
          },
          { session }
        );
        if (updateResult.matchedCount !== 1) throw new RelocationUnderwritingLeaseConflict();
        return { status: "committed" as const, data: bondResult.data };
      }).catch((error: unknown) => {
        if (error instanceof RelocationUnderwritingLeaseConflict) {
          return { status: "underwriting_busy" as const };
        }
        throw error;
      });
      if (bondCommit.status === "transactions_unavailable") {
        return errorResponse(
          503,
          "Bond relocation requires atomic database transactions; try again later"
        );
      }
      if (bondCommit.status === "underwriting_busy") {
        return errorResponse(
          409,
          "Primary underwriting cash is settling; retry relocation after settlement"
        );
      }
      if (bondCommit.status === "bond_refused") {
        await releaseRelocationBondFundingLease(db, workingCorp._id, frozenBondLease.operationKey);
        return bondCommit.response;
      }
      const { bondFaceValue, couponRate, creditRating } = bondCommit.data;

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
    } finally {
      await releaseHqTransition();
    }
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
