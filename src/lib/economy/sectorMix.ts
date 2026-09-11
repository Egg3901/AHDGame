/**
 * National sector-mix aggregation for the Economic Outlook surfaces.
 *
 * Read-path only: aggregates each (state, sectorType) market across a country.
 * Below plants it uses the host-state FX basis and the legacy owned-plus-unowned
 * revenue path. Under plants, market size is built plant capacity plus latent
 * output demand from the commodity ledger; authored unowned-sector rows do not
 * set the industry denominator. No writes.
 */

import type { Db } from "mongodb";
import type {
  CommodityPrice,
  CorporateSector,
  GameState,
  State,
  UnownedSector,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import {
  COMMODITY_TYPES,
  commodityMixWeight,
  eraScaledBasePrices,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import {
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { effectiveMarketAnchor, gdpDerivedMarketAnchor } from "@/lib/corporations/marketShare";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { defaultSupplyRates, unitYieldForSupply } from "@/lib/constants/capacityEconomy";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

export interface CountrySectorMixEntry {
  type: CorporationType;
  label: string;
  /** Σ effective (state, sector) markets across the country, ₳/day. */
  totalMarketAnchor: number;
  /** Corporate-owned share of the national market, 0–100 (1dp). */
  ownedPercent: number;
  /** State with the largest effective market for this sector. */
  largestState: { stateId: string; stateName: string } | null;
  /** Mean legacy slider growth (%/yr), or null when plants mode has no slider signal. */
  avgGrowth: number | null;
}

interface PlantsSectorMarketInput {
  type: CorporationType;
  stateId: string;
  revenueAnchor: number;
  capitalStock?: number;
  operatingCapacityUnits?: number;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  mothballed?: boolean;
}

interface PlantsMarketAggregation {
  ownedByBucket: Map<string, number>;
  marketByBucket: Map<string, number>;
}

interface CommodityBalance {
  supply: number;
  demand: number;
}

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;

function valueInRecord(record: Record<string, number> | undefined, key: string): number | null {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) return null;
  return finiteNonNegative(record[key]) ?? 0;
}

function sumStateValues(
  record: Record<string, number> | undefined,
  stateIds: readonly string[]
): number | null {
  if (!record) return null;
  let found = false;
  let total = 0;
  for (const stateId of stateIds) {
    const value = valueInRecord(record, stateId);
    if (value == null) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

function nationalCommodityBalance(
  price: CommodityPrice,
  countryId: string,
  stateIds: readonly string[]
): CommodityBalance | null {
  const directSupply = valueInRecord(price.nationalSupply, countryId);
  const directDemand = valueInRecord(price.nationalDemand, countryId);
  const stateSupply = sumStateValues(price.stateSupply, stateIds);
  const stateDemand = sumStateValues(price.stateDemand, stateIds);
  if (directSupply == null && directDemand == null && stateSupply == null && stateDemand == null) {
    return null;
  }
  return {
    supply: directSupply ?? stateSupply ?? 0,
    demand: directDemand ?? stateDemand ?? 0,
  };
}

function stateCommodityBalance(price: CommodityPrice, stateId: string): CommodityBalance | null {
  const supply = valueInRecord(price.stateSupply, stateId);
  const demand = valueInRecord(price.stateDemand, stateId);
  if (supply == null && demand == null) return null;
  return { supply: supply ?? 0, demand: demand ?? 0 };
}

/**
 * Demand that has no current supply. The persisted truncation leg is allocated
 * by the scope's share of visible global demand because the price document
 * records that hidden demand globally, not by country or state.
 */
function latentDemandUnits(
  price: CommodityPrice,
  balance: CommodityBalance,
  demandShareDenominator: number
): number {
  const visibleGap = Math.max(0, balance.demand - balance.supply);
  const truncated = finiteNonNegative(price.demandTruncatedUnits) ?? 0;
  const share =
    demandShareDenominator > 0
      ? Math.max(0, Math.min(1, balance.demand / demandShareDenominator))
      : 0;
  return visibleGap + truncated * share;
}

function outputRatesForSector(
  sector: PlantsSectorMarketInput,
  currentTurn: number | undefined
): Partial<Record<CommodityType, number>> {
  const transitionActive =
    sector.transitionFromStrategyId && sector.transitionStartTurn != null && currentTurn != null;
  return getEffectiveStrategyRates(
    sector.type,
    sector.strategyId ?? "standard",
    transitionActive ? sector.transitionFromStrategyId : null,
    transitionActive ? sector.transitionStartTurn : null,
    currentTurn ?? 0
  ).supply;
}

function storedCapacityUnits(sector: PlantsSectorMarketInput): number | null {
  for (const value of [sector.operatingCapacityUnits, sector.capitalStock]) {
    const capacity = finiteNonNegative(value);
    if (capacity != null) return capacity;
  }
  return null;
}

interface OutputContribution {
  /** Output-unit capacity contribution used to split a commodity market. */
  units: number;
  /** ₳ of sector nameplate per one unit of this commodity output. */
  anchorPerUnit: number;
}

type OutputWeights = Map<CommodityType, Map<CorporationType, OutputContribution>>;

function addOutputWeight(
  weights: OutputWeights,
  commodity: CommodityType,
  type: CorporationType,
  units: number,
  anchorPerUnit: number
): void {
  if (!(units > 0) || !Number.isFinite(units) || !(anchorPerUnit > 0)) return;
  const byType = weights.get(commodity) ?? new Map<CorporationType, OutputContribution>();
  const previous = byType.get(type);
  const previousUnits = previous?.units ?? 0;
  const totalUnits = previousUnits + units;
  const totalAnchor = previousUnits * (previous?.anchorPerUnit ?? 0) + units * anchorPerUnit;
  byType.set(type, { units: totalUnits, anchorPerUnit: totalAnchor / totalUnits });
  weights.set(commodity, byType);
}

function fallbackOutputWeights(
  commodity: CommodityType,
  basePrices: Record<CommodityType, number>,
  eraUnitScale: number
): Map<CorporationType, OutputContribution> {
  const weights = new Map<CorporationType, OutputContribution>();
  for (const type of CORPORATION_TYPES) {
    const mix = defaultSupplyRates(type);
    const weight = commodityMixWeight(mix, basePrices, commodity);
    const unitYield = unitYieldForSupply(mix, eraUnitScale);
    if (weight > 0 && unitYield > 0) {
      weights.set(type, { units: weight, anchorPerUnit: 1 / unitYield / weight });
    }
  }
  return weights;
}

function weightsForCommodity(
  commodity: CommodityType,
  stateWeights: OutputWeights,
  nationalWeights: OutputWeights,
  basePrices: Record<CommodityType, number>,
  eraUnitScale: number
): Map<CorporationType, OutputContribution> {
  const state = stateWeights.get(commodity);
  if (state && [...state.values()].some((contribution) => contribution.units > 0)) return state;
  const national = nationalWeights.get(commodity);
  if (national && [...national.values()].some((contribution) => contribution.units > 0)) {
    return national;
  }
  return fallbackOutputWeights(commodity, basePrices, eraUnitScale);
}

function addAllocatedLatent(
  target: Map<string, number>,
  stateId: string,
  commodity: CommodityType,
  latentUnits: number,
  stateWeights: OutputWeights,
  nationalWeights: OutputWeights,
  basePrices: Record<CommodityType, number>,
  eraUnitScale: number,
  bucketKey: (stateId: string, type: CorporationType) => string
): void {
  // Convert commodity demand back through the same strategy mix that prices
  // plant capacity. Using the commodity's sticker price directly would break
  // the plants identity for a rate such as automobiles' 0.5 vehicles per ₳.
  if (!(latentUnits > 0)) return;
  const weights = weightsForCommodity(
    commodity,
    stateWeights,
    nationalWeights,
    basePrices,
    eraUnitScale
  );
  const totalWeight = [...weights.values()].reduce(
    (sum, contribution) => sum + Math.max(0, contribution.units),
    0
  );
  if (!(totalWeight > 0)) return;
  for (const [type, contribution] of weights) {
    if (!(contribution.units > 0) || !(contribution.anchorPerUnit > 0)) continue;
    const anchor = ((latentUnits * contribution.units) / totalWeight) * contribution.anchorPerUnit;
    const key = bucketKey(stateId, type);
    target.set(key, (target.get(key) ?? 0) + anchor);
  }
}

function buildPlantsMarketAggregation(args: {
  countryId: string;
  sectors: PlantsSectorMarketInput[];
  states: Array<{ stateId: string; gdp: number }>;
  prices: CommodityPrice[];
  eraUnitScale: number;
  currentTurn?: number;
  bucketKey: (stateId: string, type: CorporationType) => string;
}): PlantsMarketAggregation {
  const { sectors, states, prices, eraUnitScale, currentTurn, bucketKey } = args;
  const eraBasePrices = eraScaledBasePrices(eraUnitScale);
  const ownedByBucket = new Map<string, number>();
  const nationalOutputWeights: OutputWeights = new Map();
  const stateOutputWeights = new Map<string, OutputWeights>();

  for (const sector of sectors) {
    if (!CORPORATION_TYPES.includes(sector.type)) continue;
    if (sector.mothballed) continue;
    const rates = outputRatesForSector(sector, currentTurn);
    const unitYield = unitYieldForSupply(rates, eraUnitScale);
    const capacity = storedCapacityUnits(sector);
    const ownedAnchor =
      capacity != null
        ? unitYield > 0
          ? capacity / unitYield
          : 0
        : Math.max(0, sector.revenueAnchor);
    if (ownedAnchor > 0) {
      const key = bucketKey(sector.stateId, sector.type);
      ownedByBucket.set(key, (ownedByBucket.get(key) ?? 0) + ownedAnchor);
    }

    const outputUnits =
      capacity != null ? capacity : unitYield > 0 ? Math.max(0, ownedAnchor) * unitYield : 0;
    if (!(outputUnits > 0)) continue;
    let stateWeights = stateOutputWeights.get(sector.stateId);
    if (!stateWeights) {
      stateWeights = new Map();
      stateOutputWeights.set(sector.stateId, stateWeights);
    }
    for (const commodity of Object.keys(rates) as CommodityType[]) {
      const weight = commodityMixWeight(rates, eraBasePrices, commodity);
      if (!(weight > 0)) continue;
      const output = outputUnits * weight;
      const anchorPerOutputUnit = unitYield > 0 ? 1 / unitYield / weight : 0;
      addOutputWeight(nationalOutputWeights, commodity, sector.type, output, anchorPerOutputUnit);
      addOutputWeight(stateWeights, commodity, sector.type, output, anchorPerOutputUnit);
    }
  }

  const priceByCommodity = new Map<CommodityType, CommodityPrice>();
  for (const price of prices) {
    const commodity = price.commodity as CommodityType;
    if (!COMMODITY_TYPES.includes(commodity)) continue;
    const previous = priceByCommodity.get(commodity);
    if (!previous || (price.turn ?? 0) >= (previous.turn ?? 0)) {
      priceByCommodity.set(commodity, price);
    }
  }

  const stateIds = states.map((state) => state.stateId);
  const nationalLatentByCommodity = new Map<CommodityType, number>();
  const stateLatentByCommodity = new Map<CommodityType, Map<string, number>>();
  for (const commodity of COMMODITY_TYPES) {
    const price = priceByCommodity.get(commodity);
    if (!price) continue;
    const nationalBalance = nationalCommodityBalance(price, args.countryId, stateIds);
    if (nationalBalance) {
      const globalDemand = finiteNonNegative(price.globalDemand) ?? 0;
      const latent = latentDemandUnits(price, nationalBalance, globalDemand);
      if (latent > 0) nationalLatentByCommodity.set(commodity, latent);
    }
    const stateLatent = new Map<string, number>();
    for (const state of states) {
      const balance = stateCommodityBalance(price, state.stateId);
      if (!balance) continue;
      const globalDemand = finiteNonNegative(price.globalDemand) ?? 0;
      const latent = latentDemandUnits(price, balance, globalDemand);
      if (latent > 0) stateLatent.set(state.stateId, latent);
    }
    if (stateLatent.size > 0) stateLatentByCommodity.set(commodity, stateLatent);
  }

  const latentByBucket = new Map<string, number>();
  for (const commodity of COMMODITY_TYPES) {
    const price = priceByCommodity.get(commodity);
    const nationalLatent = nationalLatentByCommodity.get(commodity) ?? 0;
    if (!price || !(nationalLatent > 0)) continue;
    const rawStateLatent = stateLatentByCommodity.get(commodity);
    const rawTotal = rawStateLatent
      ? [...rawStateLatent.values()].reduce((sum, value) => sum + value, 0)
      : 0;
    if (rawTotal > 0 && rawStateLatent) {
      for (const state of states) {
        const raw = rawStateLatent.get(state.stateId) ?? 0;
        const latent = (raw * nationalLatent) / rawTotal;
        addAllocatedLatent(
          latentByBucket,
          state.stateId,
          commodity,
          latent,
          stateOutputWeights.get(state.stateId) ?? new Map(),
          nationalOutputWeights,
          eraBasePrices,
          eraUnitScale,
          bucketKey
        );
      }
      continue;
    }

    const distributionTotal = states.reduce((sum, state) => sum + Math.max(0, state.gdp), 0);
    for (const state of states) {
      const share =
        distributionTotal > 0
          ? Math.max(0, state.gdp) / distributionTotal
          : states.length > 0
            ? 1 / states.length
            : 0;
      addAllocatedLatent(
        latentByBucket,
        state.stateId,
        commodity,
        nationalLatent * share,
        stateOutputWeights.get(state.stateId) ?? new Map(),
        nationalOutputWeights,
        eraBasePrices,
        eraUnitScale,
        bucketKey
      );
    }
  }

  const marketByBucket = new Map<string, number>(ownedByBucket);
  for (const [key, latent] of latentByBucket) {
    marketByBucket.set(key, (marketByBucket.get(key) ?? 0) + latent);
  }
  return { ownedByBucket, marketByBucket };
}

export async function aggregateCountrySectorMix(
  db: Db,
  countryId: CountryId
): Promise<CountrySectorMixEntry[]> {
  const [states, sectors, fxByCurrency, preset, marketMode, worldState, prices] = await Promise.all(
    [
      db
        .collection<State>("states")
        .find({ countryId })
        .project<Pick<State, "_id" | "name" | "gdp">>({ name: 1, gdp: 1 })
        .toArray(),
      db.collection<CorporateSector>("corporateSectors").find({ countryId }).toArray(),
      loadFxRatesByCurrency(db),
      loadWorldPreset(db),
      getMarketSystemModeForDb(db),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
    ]
  );
  const plantsMode = marketAtLeast(marketMode, "plants");
  const unownedDocs = plantsMode
    ? []
    : await db.collection<UnownedSector>("unownedSectors").find({ countryId }).toArray();
  const eraUnitScale = getEraUnitScale(preset);
  const currentTurn =
    typeof worldState?.currentTurn === "number" && Number.isFinite(worldState.currentTurn)
      ? worldState.currentTurn
      : undefined;

  // Every sector here is physically in `countryId`, so they all share one
  // host-state functional currency (the currency their revenue is stored in,
  // regardless of which corp owns them). Resolve the ₳ conversion rate once
  // from the host country rather than per owning corp.
  const hostCode = resolveSectorHostCurrencyCode({ countryId }, null);
  const hostRate = fxRateForSectorHostFromMap({ countryId }, null, fxByCurrency);

  // Legacy owned revenue per (state, sectorType) bucket, ₳-normalized; and the
  // running sum/count of current growth per sector type for the national mean.
  // Plants replaces the revenue buckets below with physical capacity.
  const bucketKey = (stateId: string, type: CorporationType) => `${stateId}::${type}`;
  const ownedByBucket = new Map<string, number>();
  const growthSumByType = new Map<CorporationType, number>();
  const growthCountByType = new Map<CorporationType, number>();
  const plantsMarketInputs: PlantsSectorMarketInput[] = [];
  for (const s of sectors) {
    const anchor = readCorpEconomicAnchor(s.revenue, hostCode, hostRate);
    const type = s.sectorType as CorporationType;
    ownedByBucket.set(
      bucketKey(s.stateId, type),
      (ownedByBucket.get(bucketKey(s.stateId, type)) ?? 0) + anchor
    );
    if (plantsMode) {
      plantsMarketInputs.push({
        type,
        stateId: s.stateId,
        revenueAnchor: anchor,
        capitalStock: s.capitalStock,
        operatingCapacityUnits: s.operatingCapacityUnits,
        strategyId: s.strategyId,
        transitionFromStrategyId: s.transitionFromStrategyId,
        transitionStartTurn: s.transitionStartTurn,
        mothballed: s.mothballed,
      });
    }
    const growth = s.currentGrowthRate ?? s.targetGrowthRate ?? s.growthRate ?? 0;
    growthSumByType.set(type, (growthSumByType.get(type) ?? 0) + growth);
    growthCountByType.set(type, (growthCountByType.get(type) ?? 0) + 1);
  }
  const unownedByBucket = new Map<string, number>();
  for (const u of unownedDocs) {
    const key = bucketKey(u.stateId, u.sectorType);
    unownedByBucket.set(key, (unownedByBucket.get(key) ?? 0) + (u.revenue ?? 0));
  }

  const plantsMarket = plantsMode
    ? buildPlantsMarketAggregation({
        countryId,
        sectors: plantsMarketInputs,
        states: states.map((state) => ({ stateId: state._id, gdp: state.gdp ?? 0 })),
        prices,
        eraUnitScale,
        currentTurn,
        bucketKey,
      })
    : null;

  return CORPORATION_TYPES.map((type) => {
    let totalMarket = 0;
    let totalOwned = 0;
    let largest: { stateId: string; stateName: string; market: number } | null = null;
    for (const state of states) {
      const key = bucketKey(state._id, type);
      let owned = ownedByBucket.get(key) ?? 0;
      const gdpFallback = gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset);
      let market: number;
      if (!plantsMode) {
        market = effectiveMarketAnchor(owned, unownedByBucket.get(key), gdpFallback);
      } else {
        owned = plantsMarket?.ownedByBucket.get(key) ?? 0;
        market = plantsMarket?.marketByBucket.get(key) ?? owned;
      }
      totalMarket += market;
      totalOwned += owned;
      if (market > 0 && (largest == null || market > largest.market)) {
        largest = { stateId: state._id, stateName: state.name, market };
      }
    }
    const gCount = growthCountByType.get(type) ?? 0;
    return {
      type,
      label: CORPORATION_TYPE_LABELS[type],
      totalMarketAnchor: Math.round(totalMarket),
      ownedPercent: totalMarket > 0 ? Math.round((totalOwned / totalMarket) * 1000) / 10 : 0,
      largestState: largest ? { stateId: largest.stateId, stateName: largest.stateName } : null,
      // `currentGrowthRate` is intentionally zero in plants: capacity moves
      // through paid build orders, not the legacy growth slider. A displayed
      // 0.00% therefore looks like a measured national contraction/expansion
      // when it is actually "not applicable".
      avgGrowth:
        !plantsMode && gCount > 0
          ? Math.round(((growthSumByType.get(type) ?? 0) / gCount) * 100) / 100
          : null,
    };
  });
}
