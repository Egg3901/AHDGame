/**
 * Market-tier realization legs: clearing, throughput, and capital (#588).
 *
 * Pure computation split out of processSector. Below plants these legs are
 * unchanged byte-for-byte; under plants they feed the revenue governor and
 * the P1 production chain. No reads or writes here, only the turn inputs.
 */
import { capacityHaircutFactor } from "@/lib/extraction/capacityHaircut";
import { computePriceRealization } from "@/lib/market/priceRealization";
import { computeThroughput, inputAvailability } from "@/lib/market/throughput";
import { isStateScopedCommodity } from "@/lib/market/rules/commodityMarketScope";
import {
  MARKET_REALIZATION_DEVIATION_CAP,
  advanceCapitalStock,
  capitalUtilizationFactor,
  impliedOutputUnits,
  seedCapitalStock,
} from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import type { CorporateSector } from "@/lib/db/types";
import { retoolOperatingCapacityRatio } from "@/lib/corporations/retooling/rules";
import type { SectorClearingResult } from "@/lib/market/clearing";
import type { MarketContext } from "@/lib/market/marketContext";
import type { CorporationLookups } from "../types";

export interface MarketTiersInput {
  sector: Pick<
    CorporateSector,
    | "_id"
    | "clearingStartTurn"
    | "throughputStartTurn"
    | "capitalStock"
    | "sectorType"
    | "industryModel"
    | "mediaDiscriminator"
    | "strategyId"
    | "transitionFromStrategyId"
    | "transitionStartTurn"
    | "retoolRescaleApplied"
  >;
  market: MarketContext;
  priceRatioByCommodity: CorporationLookups["priceRatioByCommodity"];
  stateInputAvailabilityByState: CorporationLookups["stateInputAvailabilityByState"];
  strategySupply: Partial<Record<CommodityType, number>> | undefined;
  strategyDemand: Partial<Record<CommodityType, number>> | undefined;
  wideCommodityBalances: CorporationLookups["globalCommodityBalances"];
  /** The sector's state's raw balances, for state-scoped input availability. */
  stateBalances?: ReadonlyMap<CommodityType, { supply: number; demand: number }>;
  stateId: string;
  currentTurn: number;
  preFlipNameplateRevenue: number;
  perTurnGrowthRate: number;
  eraUnitScale: CorporationLookups["eraUnitScale"];
}

export interface MarketTiersResult {
  clearing: SectorClearingResult | undefined;
  clearingStartTurn: number | undefined;
  clearingFactor: number;
  priceRealization: number;
  throughputRaw: { throughput: number; bindingInput: CommodityType | null };
  throughputStartTurn: number | undefined;
  throughputFactor: number;
  governorCap: number;
  nameplateUnits: number;
  impliedUnits: number;
  newCapitalStock: number;
  capitalFactor: number;
}

export function computeMarketTiers(input: MarketTiersInput): MarketTiersResult {
  const {
    sector,
    market,
    priceRatioByCommodity,
    stateInputAvailabilityByState,
    strategySupply,
    strategyDemand,
    wideCommodityBalances,
    stateBalances,
    stateId,
    currentTurn,
    preFlipNameplateRevenue,
    perTurnGrowthRate,
    eraUnitScale,
  } = input;

  // Price realization (marketSystemMode >= "realization", audit t806 Fix 1):
  // realized revenue is scaled by the lagged market price of the sector's
  // output mix, so shortages finally reward producers and gluts bleed them.
  // Weighted by pre-clamp strategy supply rates (the mix the sector sells),
  // lagged one turn via lookups.priceRatioByCommodity, damped + clamped in
  // computePriceRealization. Exactly 1 when the mode is off.
  // Clearing (marketSystemMode >= "clearing", Fix 2): the pre-pass factor
  // (soldFraction × (1+posture) × price leg) SUBSUMES plain realization —
  // when clearing is on it replaces the Tier-1 multiplier, ramped in per
  // sector so posture/volume shocks fade in like every other constraint.
  const clearing = market.clearingEnabled
    ? market.clearingBySectorId?.get(sector._id.toString())
    : undefined;
  const clearingStartTurn =
    market.clearingEnabled && clearing && clearing.factor < 1
      ? (sector.clearingStartTurn ?? currentTurn)
      : (sector.clearingStartTurn ?? undefined);
  // Ramp only softens sub-1 factors (capacityHaircutFactor returns 1 for
  // factor >= 1); premium upside applies immediately — upside needs no
  // bankruptcy protection.
  const clearingFactor = clearing
    ? clearing.factor >= 1
      ? clearing.factor
      : capacityHaircutFactor(clearing.factor, clearingStartTurn, currentTurn)
    : 1;
  const priceRealization =
    market.realizationEnabled && !market.clearingEnabled
      ? computePriceRealization(strategySupply ?? {}, priceRatioByCommodity)
      : 1;
  // Throughput coupling (marketSystemMode >= "clearing", audit t806 D1):
  // realized output is throttled by the scarcest available input (Leontief),
  // using lagged local delivery availability when freight settlement is active
  // and lagged global balances otherwise. A throttled sector therefore cannot
  // deepen the shortage that throttled it within the same turn. Ramped in per
  // sector over the same 240-turn window as the capacity haircut.
  const coordinated = market.groupSupplyAvailabilityBySector?.get(sector._id.toString());
  const priorityAvailability =
    coordinated ?? market.internalInputAvailabilityBySectorId?.get(sector._id.toString());
  // Internal/group supply can only RAISE availability: its book residual is
  // country-wide, so overwriting a state-local delivery figure with it could
  // throttle a plant whose own state market fully covers its input.
  const localAvailability = stateInputAvailabilityByState.get(stateId);
  let mergedAvailability: Map<CommodityType, number> | undefined;
  if (priorityAvailability) {
    mergedAvailability = new Map(localAvailability ?? []);
    for (const [commodity, value] of priorityAvailability) {
      const local = mergedAvailability.get(commodity);
      mergedAvailability.set(commodity, typeof local === "number" ? Math.max(local, value) : value);
    }
  } else if (localAvailability) {
    mergedAvailability = new Map(localAvailability);
  }
  // State-scoped inputs (freight and local services) have no freight class, so
  // freight settlement writes no state-local availability for them and they
  // would fall back to the country book. They trade only in their own state,
  // so read availability from that state's balance when one exists. An
  // internal-supply value for such an input is a country-wide residual, so it
  // can only raise the state figure, never replace it.
  if (stateBalances) {
    for (const commodity of Object.keys(strategyDemand ?? {}) as CommodityType[]) {
      if (!isStateScopedCommodity(commodity)) continue;
      if (localAvailability?.has(commodity)) continue;
      const stateBalance = stateBalances.get(commodity);
      if (!stateBalance) continue;
      const stateAvail = inputAvailability(stateBalance);
      mergedAvailability ??= new Map();
      const existing = mergedAvailability.get(commodity);
      mergedAvailability.set(
        commodity,
        typeof existing === "number" ? Math.max(existing, stateAvail) : stateAvail
      );
    }
  }
  const throughputRaw = market.throughputEnabled
    ? computeThroughput(strategyDemand ?? {}, wideCommodityBalances, mergedAvailability)
    : { throughput: 1, bindingInput: null };
  const throughputStartTurn =
    market.throughputEnabled && throughputRaw.throughput < 1
      ? (sector.throughputStartTurn ?? currentTurn)
      : (sector.throughputStartTurn ?? undefined);
  // capacityHaircutFactor already ramps throughput in from 1 (flip = no-op).
  // The launch-safety governor adds only the downside floor: an input-starved
  // sector's revenue can't be cut more than `cap` below the ledger baseline
  // (throughput's baseline is 1 — ledger has no input gate). No second ramp.
  const throughputRamped = capacityHaircutFactor(
    throughputRaw.throughput,
    throughputStartTurn,
    currentTurn
  );
  const governorCap = market.governorCap ?? MARKET_REALIZATION_DEVIATION_CAP;
  const throughputFactor = market.throughputEnabled
    ? Math.max(throughputRamped, 1 - governorCap)
    : throughputRamped;
  // Capital tier (marketSystemMode >= "capital", Fix 4 v1): capacity is
  // seeded with headroom at first exposure (mode flip = no-op), advances
  // with the growth slider minus depreciation, and gates realized output
  // like geological capacity gates extraction. No ramp needed — the seed
  // headroom IS the grace period; only sustained non-investment bites.
  // Nameplate output units of the sector's (pre-realization) revenue base, on
  // the same DAILY basis as `newRevenue`. Computed unconditionally because the
  // P1 units telemetry below reports it in every mode; the capital tier still
  // only gates on it when capital mode is on (0 otherwise, as before).
  // `preFlipNameplateRevenue === newRevenue` in every mode below "plants", so
  // this whole block is byte-identical outside plants; under plants it computes
  // the pre-flip baseline the governor anchors on, and the authoritative plants
  // capacity is derived from it just below.
  const nameplateUnits = impliedOutputUnits(
    preFlipNameplateRevenue,
    strategySupply ?? {},
    COMMODITY_BASE_PRICES,
    eraUnitScale
  );
  const impliedUnits = market.capitalEnabled ? nameplateUnits : 0;
  const newCapitalStock = market.capitalEnabled
    ? advanceCapitalStock({
        prevStock:
          typeof sector.capitalStock === "number"
            ? sector.capitalStock
            : seedCapitalStock(
                preFlipNameplateRevenue,
                strategySupply ?? {},
                COMMODITY_BASE_PRICES,
                eraUnitScale
              ),
        currentGrowthRate: perTurnGrowthRate,
      })
    : 0;
  // Ticket 1424: mid-retool, owned stock sits on the DESTINATION strategy's
  // units while `impliedUnits` is measured on the BLENDED recipe. Comparing
  // them raw read a standard to vehicle_assembly plant as ~2% utilized (2.26
  // vehicle units against 85 blended units) and the governor baseline, which
  // carries this factor, cut realized revenue to ~3% of nameplate while inputs
  // were still billed on the full operating capacity. Express the stock in the
  // same blended units the plants tier operates (1 off-transition and for any
  // stock not yet converted, so non-retool sectors are byte-identical).
  const capitalStockOnImpliedBasis =
    market.capitalEnabled && market.plantsEnabled
      ? newCapitalStock * retoolOperatingCapacityRatio({ ...sector, currentTurn })
      : newCapitalStock;
  const capitalFactor = market.capitalEnabled
    ? capitalUtilizationFactor(capitalStockOnImpliedBasis, impliedUnits)
    : 1;

  return {
    clearing,
    clearingStartTurn,
    clearingFactor,
    priceRealization,
    throughputRaw,
    throughputStartTurn,
    throughputFactor,
    governorCap,
    nameplateUnits,
    impliedUnits,
    newCapitalStock,
    capitalFactor,
  };
}
