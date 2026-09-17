import type { Db } from "mongodb";
import type { CommodityPrice } from "@/lib/db/types";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import type { TurnReferenceData } from "@/lib/corporations/turnReferenceData";
import type { CommodityType } from "@/lib/constants/commodities";
import { buildMarketShareBySectorId } from "@/lib/corporations/marketShare";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { buildNationalCommodityBalances } from "@/lib/commodity-map";

export interface MarketViewContext {
  marketShareBySectorId: Map<string, number>;
  globalBalances: Map<CommodityType, { supply: number; demand: number }>;
  nationalBalancesByCountry: Map<string, Map<CommodityType, { supply: number; demand: number }>>;
  rawStateBalances: Map<string, Map<CommodityType, { supply: number; demand: number }>>;
  /** Lagged global price-over-base ratios, the same map the turn engine feeds
   * computeInputsCost. Rebuilds the physical input bill per sector so the
   * margin drilldown can explain a physically-derived margin. */
  globalPriceRatioByCommodity: Map<CommodityType, number>;
}

export interface MarketViewInputs {
  corporation: Corporation;
  sectors: CorporateSector[];
  states: TurnReferenceData["allStates"];
  stateCountryMap: Map<string, string>;
  uniqueStateIds: string[];
  fxByCurrency: Map<CurrencyCode, number>;
  gameState: GameState | null;
  commodityPrices: CommodityPrice[];
}

/**
 * Market-share + commodity-balance context for the corporation detail view (#587).
 *
 * Builds the per-sector market-share lookup for this corp's buckets (so the
 * dominance margin penalty the turn loop charges on growth-cost math also
 * shows in the displayed effective profit margin), plus the global/national/
 * state commodity balances the margin stack blends over.
 */
export async function loadMarketViewContext(
  db: Db,
  inputs: MarketViewInputs
): Promise<MarketViewContext> {
  const {
    corporation,
    sectors,
    states,
    stateCountryMap,
    uniqueStateIds,
    fxByCurrency,
    gameState,
    commodityPrices,
  } = inputs;

  const globalBalances = new Map<CommodityType, { supply: number; demand: number }>();
  const nationalBalancesByCountry = new Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  const rawStateBalances = new Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  const corpStateIdSet = new Set(uniqueStateIds);
  for (const cp of commodityPrices) {
    globalBalances.set(cp.commodity, { supply: cp.globalSupply, demand: cp.globalDemand });

    const perCountry = buildNationalCommodityBalances(cp, stateCountryMap);
    for (const [countryId, balance] of perCountry) {
      if (!nationalBalancesByCountry.has(countryId)) {
        nationalBalancesByCountry.set(countryId, new Map());
      }
      nationalBalancesByCountry.get(countryId)!.set(cp.commodity, balance);
    }

    for (const stateId of corpStateIdSet) {
      const supply = cp.stateSupply[stateId] ?? 0;
      const demand = cp.stateDemand[stateId] ?? 0;
      if (!rawStateBalances.has(stateId)) {
        rawStateBalances.set(stateId, new Map());
      }
      rawStateBalances.get(stateId)!.set(cp.commodity, { supply, demand });
    }
  }

  // Build a per-sector market-share lookup for this corp's buckets so the
  // dominance margin penalty (applied by the turn loop on growth-cost math)
  // also shows up in the displayed effective profit margin. We only query
  // the (state, sectorType) buckets this corp actually operates in.
  const corpBuckets = sectors.map((s) => ({
    stateId: s.stateId,
    sectorType: s.sectorType,
  }));
  const bucketFilter =
    corpBuckets.length > 0
      ? { $or: corpBuckets.map((b) => ({ stateId: b.stateId, sectorType: b.sectorType })) }
      : null;

  const [siblingSectors, unownedSectors] = bucketFilter
    ? await Promise.all([
        db.collection<CorporateSector>("corporateSectors").find(bucketFilter).toArray(),
        db.collection<UnownedSector>("unownedSectors").find(bucketFilter).toArray(),
      ])
    : [[] as CorporateSector[], [] as UnownedSector[]];

  const siblingCorpIds = [...new Set(siblingSectors.map((s) => s.corporationId.toString()))];
  const siblingCorps =
    siblingCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: siblingSectors.map((s) => s.corporationId) } })
          .project<Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>({
            _id: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
          })
          .toArray()
      : [];

  const corpById = new Map<string, Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>(
    siblingCorps.map((c) => [c._id.toString(), c])
  );
  // Ensure THIS corp is in the map even if no siblings returned (e.g. solo monopoly).
  corpById.set(corporation._id.toString(), {
    _id: corporation._id,
    liquidCurrencyCode: corporation.liquidCurrencyCode,
    countryId: corporation.countryId,
  });

  const stateById = new Map(
    states.map((s) => [s._id, { _id: s._id, gdp: s.gdp ?? 0, countryId: s.countryId }])
  );

  const marketShareBySectorId = buildMarketShareBySectorId({
    sectors: siblingSectors.length > 0 ? siblingSectors : sectors,
    corpById,
    stateById,
    unownedSectors,
    exchangeRatesByCurrency: fxByCurrency,
    // Era-correct GDP→₳ normalization for the GDP-derived market fallback
    // (refs #3778). `gameState` is already projected with `preset` above.
    preset: resolvePresetIdFromGameState(gameState),
  });

  const globalPriceRatioByCommodity = new Map<CommodityType, number>();
  for (const cp of commodityPrices) {
    if (
      typeof cp.globalPrice === "number" &&
      typeof cp.basePrice === "number" &&
      cp.globalPrice > 0 &&
      cp.basePrice > 0 &&
      Number.isFinite(cp.globalPrice / cp.basePrice)
    ) {
      globalPriceRatioByCommodity.set(cp.commodity, cp.globalPrice / cp.basePrice);
    }
  }

  return {
    marketShareBySectorId,
    globalBalances,
    nationalBalancesByCountry,
    rawStateBalances,
    globalPriceRatioByCommodity,
  };
}
