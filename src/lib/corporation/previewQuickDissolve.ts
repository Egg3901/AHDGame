/**
 * Preview for the corporation CEO’s quick dissolve (`POST /api/corporations/[id]/dissolve`) —
 * not site-admin force-liquidate. Personal payout matches that route; commodity deltas use the
 * same supply/demand core as commodity turns but not drift, pegs, nudges, bonds, or healthcare
 * budgets.
 */
import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type {
  Bond,
  Character,
  Corporation,
  CorporateSector,
  State,
  StateMetrics,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { ApiError } from "@/lib/api/errors";
import { corporationDissolutionAgeBlock } from "@/lib/corporations/dissolutionAgeGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  allocateShareholderPool,
  type CorporateShareholderPayoutRow,
  type PublicFloatPayoutRow,
  type ShareholderPayoutRow,
} from "@/lib/bonds/corporateBondDefault";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { computeDissolutionSectorSalvageAnchor } from "@/lib/corporations/dissolutionSectorSalvage";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  COMMODITY_BASE_PRICES,
  COMMODITY_LABELS,
  COMMODITY_TYPES,
  computeMarketPrice,
  computeRawSupplyDemand,
  MARKETING_ADVERTISING_DEMAND_RATE,
  type CommodityType,
  type GdpGrowthData,
} from "@/lib/constants/commodities";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";

export type CommodityGlobalDeltaPreview = {
  commodity: CommodityType;
  label: string;
  /** Instantaneous equilibrium global price (no drift / pegs). */
  priceBefore: number;
  priceAfter: number;
  deltaPct: number;
};

export type QuickDissolvePreview = {
  outstandingBonds: number;
  canQuickDissolve: boolean;
  /** Turns left before the corp is old enough to dissolve (0 when eligible). */
  dissolutionAgeTurnsRemaining: number;
  returnedCapitalCorp: number;
  returnedCapitalHome: number;
  /** CEO's pro-rata share in their home currency. Equals returnedCapitalHome on private corps. */
  ceoShareHome: number;
  /** CEO's pro-rata share in anchor units (₳). */
  ceoShareAnchor: number;
  /** True when the requesting CEO is the sole entry in the cap table (effectively private). */
  ceoIsSoleShareholder: boolean;
  homeCurrency: string;
  forexEnabled: boolean;
  /** All character/imperial shareholder allocations (anchor units). */
  characterRows: ShareholderPayoutRow[];
  /** Corporate equity shareholder allocations (anchor units; will be credited to corp liquidCapital). */
  corporateRows: CorporateShareholderPayoutRow[];
  /** publicFloat allocation (anchor; routed to country central bank reserve). */
  publicFloatRow: PublicFloatPayoutRow | null;
  /** Global equilibrium snapshot; next turn also applies drift and regional blend. */
  commodityGlobalDeltas: CommodityGlobalDeltaPreview[];
};

function buildSectorRows(
  sectors: CorporateSector[],
  natcorpIds: Set<string>,
  currencyByCorpId: Map<string, { code: CurrencyCode | undefined; rate: number }>
): Parameters<typeof computeRawSupplyDemand>[0] {
  return sectors.map((s) => {
    const fx = currencyByCorpId.get(s.corporationId.toString());
    return {
      sectorType: s.sectorType,
      // Normalize per-sector revenue to ₳ — commodity flow rates are
      // ₳-calibrated and the aggregation sums across corps of different
      // home currencies.
      revenue: readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1),
      stateId: s.stateId,
      isNatcorp: natcorpIds.has(s.corporationId.toString()),
      strategyId: s.strategyId,
      transitionFromStrategyId: s.transitionFromStrategyId,
      transitionStartTurn: s.transitionStartTurn,
      productionPolicyLevel: s.productionPolicyLevel,
    };
  });
}

export async function previewQuickDissolve(
  db: Db,
  corporation: Corporation
): Promise<QuickDissolvePreview> {
  const corpIdStr = corporation._id.toString();

  const [outstandingBonds, heldBonds, fxByCurrency] = await Promise.all([
    db.collection<Bond>("bonds").countDocuments({ corporationId: corporation._id, matured: false }),
    db
      .collection<Bond>("bonds")
      .find({ "holders.corporationId": corporation._id, matured: false })
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);

  const corpFxRateForAssets = await getCorpFxRate(db, corporation);
  let assetValueInCorpCapital = 0;

  for (const bond of heldBonds) {
    const h = bond.holders.find(
      (holder) => holder.corporationId?.toString() === corporation._id.toString()
    );
    if (!h || h.units <= 0) continue;
    const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    const faceAnchor = corpCapitalToAnchor(h.units * BOND_UNIT_FACE_VALUE, bondCcy, bondRate);
    assetValueInCorpCapital += anchorToCorpLiquidCapital(
      faceAnchor,
      corporation,
      corpFxRateForAssets
    );
  }

  // Cross-corp equity holdings are distributed in-kind on dissolution (NOT
  // cashed at market price — that was the money-mint), so they no longer
  // contribute to the cash payout preview. Held bonds (redeemed at face),
  // liquidCapital, and the operating-sector salvage below form the returned cash.

  // Operating sectors are abandoned to the unowned market on dissolution, so a
  // salvage fraction of their capitalized NPV is realized as cash — mirrors the
  // dissolve route and the bond-default settlement. Same helper as the route so
  // the quote matches what executes.
  const sectorSalvageAnchor = await computeDissolutionSectorSalvageAnchor(
    db,
    corporation,
    fxByCurrency
  );
  const sectorSalvageInCorpCapital =
    sectorSalvageAnchor > 0
      ? anchorToCorpLiquidCapital(sectorSalvageAnchor, corporation, corpFxRateForAssets)
      : 0;

  // Mirror the dissolve route: share-buyback escrow nets into the payout pool
  // (positive reserve adds, negative debt subtracts), floored at 0.
  const returnedCapitalCorp = Math.max(
    0,
    Math.floor(
      corporation.liquidCapital +
        assetValueInCorpCapital +
        sectorSalvageInCorpCapital +
        (corporation.shareEscrowBalance ?? 0)
    )
  );

  const ceoChar = await db.collection<Character>("characters").findOne({ _id: corporation.ceoId });
  const forexEnabled = await isForexEnabled();

  let returnedCapitalHome = returnedCapitalCorp;
  let homeCurrency: CurrencyCode = "USD";
  let charFxRate = 1;

  if (ceoChar && returnedCapitalCorp > 0) {
    homeCurrency = getHomeCurrency(ceoChar);
    if (forexEnabled) {
      const charFxResult = await loadCharacterFxRate(db, homeCurrency);
      if (!charFxResult.ok) {
        throw new ApiError(503, "Exchange rate unavailable, try again shortly");
      }
      const corpFxRate = await getCorpFxRate(db, corporation);
      charFxRate = charFxResult.rate;
      returnedCapitalHome = (returnedCapitalCorp / corpFxRate) * charFxRate;
    }
  }

  // Bug #0540 fix: compute the per-shareholder allocation so the preview can
  // surface what the CEO actually receives (their pro-rata share) rather than
  // the total pool, plus the corporate and publicFloat slices for context.
  const shareholderPoolAnchor = corpLiquidCapitalToAnchor(
    returnedCapitalCorp,
    corporation,
    corpFxRateForAssets
  );
  const regularShareholderIds = (corporation.shareholders ?? [])
    .map((s) => s.characterId)
    .filter((id): id is ObjectId => id !== undefined);
  const imperialShareholderIds = (corporation.shareholders ?? [])
    .map((s) => s.imperialCharacterId)
    .filter((id): id is ObjectId => id !== undefined);
  const corpShareholderIds = (corporation.shareholders ?? [])
    .map((s) => s.corporationId)
    .filter((id): id is ObjectId => id !== undefined);
  const [shareholderChars, imperialShareholderChars, corpShareholderDocs] = await Promise.all([
    regularShareholderIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: regularShareholderIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : [],
    imperialShareholderIds.length > 0
      ? db
          .collection<ImperialCharacter>("imperialCharacters")
          .find({ _id: { $in: imperialShareholderIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : [],
    corpShareholderIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpShareholderIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : [],
  ]);
  const nameById = new Map<string, string>([
    ...shareholderChars.map((c) => [c._id.toString(), c.name] as const),
    ...imperialShareholderChars.map((c) => [c._id.toString(), c.name] as const),
    ...corpShareholderDocs.map((c) => [c._id.toString(), c.name as string] as const),
  ]);
  const allocation = allocateShareholderPool(corporation, shareholderPoolAnchor, nameById);
  const ceoIdStr = corporation.ceoId.toString();
  const ceoRow = allocation.characterRows.find((r) => r.characterId === ceoIdStr);
  const ceoShareAnchor = ceoRow?.payout ?? 0;
  // Convert CEO's anchor share → CEO home currency. Pre-forex this is identity.
  const ceoShareHome = forexEnabled ? ceoShareAnchor * charFxRate : ceoShareAnchor;
  const totalRealHolders =
    (corporation.shareholders ?? []).filter(
      (s) => s.characterId || s.imperialCharacterId || s.corporationId
    ).length + ((corporation.publicFloat ?? 0) > 0 ? 1 : 0);
  const ceoIsSoleShareholder = totalRealHolders <= 1 && !!ceoRow;

  const gameState = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? 0;

  const [allSectors, allCorps, allStates, stateMetrics, centralBanks] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {},
        {
          projection: {
            sectorType: 1,
            revenue: 1,
            stateId: 1,
            corporationId: 1,
            strategyId: 1,
            transitionFromStrategyId: 1,
            transitionStartTurn: 1,
            productionPolicyLevel: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        {},
        {
          projection: {
            _id: 1,
            marketingBudget: 1,
            countryOwnerId: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1, gdp: 1 } })
      .toArray(),
    db
      .collection<StateMetrics>("macroMetrics")
      .find({}, { projection: { "economic.gdpGrowth.value": 1 } })
      .toArray(),
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
  ]);

  const natcorpIds = new Set(
    allCorps.filter((c) => !!c.countryOwnerId).map((c) => c._id.toString())
  );

  // Per-corp FX lookup: sector.revenue and corp.marketingBudget are stored in
  // each corp's home currency post-v0.2.6; commodity math is ₳-calibrated.
  const currencyByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
  for (const c of allCorps) {
    currencyByCorpId.set(c._id.toString(), {
      code: resolveCorpLiquidCurrencyCode(c),
      rate: fxRateForCorpFromMap(c, fxByCurrency),
    });
  }

  const stateGdpMap = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    if (state.gdp && state.gdp > 0) stateGdpMap.set(state._id, state.gdp);
  }

  const gdpByState = new Map<string, number>();
  let gdpWeightedSum = 0;
  let totalGdpWeight = 0;
  for (const sm of stateMetrics) {
    const stateId = String(sm._id);
    if (NATIONAL_SCOPE_IDS.has(stateId)) continue;
    const gdpVal = sm.economic?.gdpGrowth?.value;
    const stateGdp = stateGdpMap.get(stateId) ?? 0;
    if (typeof gdpVal === "number" && stateGdp > 0) {
      gdpByState.set(stateId, gdpVal);
      gdpWeightedSum += gdpVal * stateGdp;
      totalGdpWeight += stateGdp;
    }
  }
  const nationalAvgGdp = totalGdpWeight > 0 ? gdpWeightedSum / totalGdpWeight : 0;
  const gdpGrowthData: GdpGrowthData = {
    nationalAverage: nationalAvgGdp,
    byState: gdpByState,
  };

  const centralBankByCountry = new Map(centralBanks.map((b) => [b.countryId, b.primeRate]));
  const primeRateByState = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    const r = centralBankByCountry.get(state.countryId);
    if (r !== undefined) primeRateByState.set(state._id, r);
  }

  const fullRows = buildSectorRows(allSectors, natcorpIds, currencyByCorpId);
  const withoutRows = buildSectorRows(
    allSectors.filter((s) => s.corporationId.toString() !== corpIdStr),
    natcorpIds,
    currencyByCorpId
  );

  const { global: globalWith } = computeRawSupplyDemand(
    fullRows,
    gdpGrowthData,
    stateGdpMap,
    currentTurn,
    primeRateByState
  );
  const { global: globalWithout } = computeRawSupplyDemand(
    withoutRows,
    gdpGrowthData,
    stateGdpMap,
    currentTurn,
    primeRateByState
  );

  const advertisingBase = COMMODITY_BASE_PRICES["advertising"];
  let totalMarketingUnits = 0;
  let corpMarketingUnits = 0;
  for (const c of allCorps) {
    const budgetLocal = c.marketingBudget ?? 0;
    if (budgetLocal <= 0) continue;
    // Normalize budget to ₳ — MARKETING_ADVERTISING_DEMAND_RATE and
    // advertisingBase are ₳-calibrated; a raw GBP budget would over-contribute
    // demand purely from GBP's FX rate against ₳.
    const fx = currencyByCorpId.get(c._id.toString());
    const budgetAnchor = readCorpEconomicAnchor(budgetLocal, fx?.code, fx?.rate ?? 1);
    const units = (budgetAnchor * MARKETING_ADVERTISING_DEMAND_RATE) / advertisingBase;
    totalMarketingUnits += units;
    if (c._id.toString() === corpIdStr) corpMarketingUnits = units;
  }

  const commodityGlobalDeltas: CommodityGlobalDeltaPreview[] = [];

  for (const commodity of COMMODITY_TYPES) {
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    const gw = globalWith.get(commodity)!;
    const go = globalWithout.get(commodity)!;

    let demandWith = gw.demand;
    let demandWithout = go.demand;
    if (commodity === "advertising") {
      demandWith += totalMarketingUnits;
      demandWithout += totalMarketingUnits - corpMarketingUnits;
    }

    const priceBefore = computeMarketPrice(basePrice, gw.supply, demandWith);
    const priceAfter = computeMarketPrice(basePrice, go.supply, demandWithout);
    const deltaPct = priceBefore > 0 ? ((priceAfter - priceBefore) / priceBefore) * 100 : 0;

    if (
      Math.abs(priceAfter - priceBefore) < 0.005 &&
      Math.abs(gw.supply - go.supply) < 1e-6 &&
      Math.abs(demandWith - demandWithout) < 1e-6
    ) {
      continue;
    }

    commodityGlobalDeltas.push({
      commodity,
      label: COMMODITY_LABELS[commodity],
      priceBefore,
      priceAfter,
      deltaPct,
    });
  }

  commodityGlobalDeltas.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const ageBlock = corporationDissolutionAgeBlock(corporation.foundedAtTurn, currentTurn);

  return {
    outstandingBonds,
    canQuickDissolve: outstandingBonds === 0 && !ageBlock.blocked,
    dissolutionAgeTurnsRemaining: ageBlock.turnsRemaining,
    returnedCapitalCorp,
    returnedCapitalHome,
    ceoShareHome,
    ceoShareAnchor,
    ceoIsSoleShareholder,
    homeCurrency,
    forexEnabled,
    characterRows: allocation.characterRows,
    corporateRows: allocation.corporationRows,
    publicFloatRow: allocation.publicFloatRow,
    commodityGlobalDeltas: commodityGlobalDeltas.slice(0, 18),
  };
}
