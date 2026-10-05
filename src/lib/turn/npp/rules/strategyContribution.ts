/**
 * NPP mining strategy forecasts use damped prices, deposit room and input availability.
 * forecastStrategyContribution estimates recipe contribution with the market's ramps;
 * aggregate sellability is a lagged estimate, rather than an individual order fill.
 */
import {
  EXTRACTABLE_RESOURCES,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { capacityHaircutFactor } from "@/lib/extraction/capacityHaircut";
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";
import { PRICE_REALIZATION_MAX, priceRealizationFactor } from "@/lib/market/priceRealization";
import { computeThroughput } from "@/lib/market/throughput";

type CommodityValues<T> = Partial<Record<CommodityType, T>>;

export interface StrategyContributionContext {
  mode: Exclude<MarketSystemMode, "off">;
  priceRatios: CommodityValues<number | null>;
  /** The live plants bill caps reachable input prices at world prices. */
  inputPriceRatios?: CommodityValues<number | null>;
  balances: CommodityValues<{ supply: number; demand: number }>;
  localInputAvailability?: CommodityValues<number>;
  /** Estimated fraction of output a seller can place in the host market. */
  sellableShares: CommodityValues<number>;
  headroom: Partial<Record<ExtractableResource, number>>;
  currentTurn: number;
  clearingStartTurn?: number;
  throughputStartTurn?: number;
  governorCap?: number;
}

function bounded(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

/** Missing balances are neutral; a known glut lowers expected sellability. */
export function expectedSellableShare(
  balance: { supply: number; demand: number } | undefined
): number {
  if (!balance || !Number.isFinite(balance.supply) || !Number.isFinite(balance.demand)) return 1;
  if (balance.supply < 0 || balance.demand < 0) return 1;
  if (balance.supply === 0) return balance.demand > 0 ? 1 : 0;
  return Math.min(1, balance.demand / balance.supply);
}

/**
 * Per-nameplate recipe contribution, before labor, fixed costs, policy and finance.
 * Plants inputs use rate times damped input price: the billing base price cancels.
 * Clearing and throughput reuse the live downside ramps and governor floor.
 */
export function forecastStrategyContribution(
  recipe: Pick<SectorStrategy, "supply" | "demand">,
  context: StrategyContributionContext
): { score: number; outputValue: number; inputCost: number; throughput: number } {
  const clearing = MARKET_MODE_ORDER.indexOf(context.mode) >= MARKET_MODE_ORDER.indexOf("clearing");
  let outputRate = 0;
  let pricedOutput = 0;
  for (const [key, rate] of Object.entries(recipe.supply) as [CommodityType, number][]) {
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const room = (EXTRACTABLE_RESOURCES as readonly string[]).includes(key)
      ? bounded(context.headroom[key as ExtractableResource], 1)
      : 1;
    const potential = rate * room;
    outputRate += potential;
    pricedOutput +=
      potential *
      priceRealizationFactor(context.priceRatios[key]) *
      (clearing ? bounded(context.sellableShares[key], 1) : 1);
  }

  const rawOutputFactor = outputRate > 0 ? pricedOutput / outputRate : 1;
  const outputFactor =
    clearing && rawOutputFactor < 1
      ? capacityHaircutFactor(
          rawOutputFactor,
          context.clearingStartTurn ?? context.currentTurn,
          context.currentTurn
        )
      : Math.min(PRICE_REALIZATION_MAX, rawOutputFactor);
  const rawThroughput = clearing
    ? computeThroughput(
        recipe.demand,
        new Map(
          Object.entries(context.balances) as [CommodityType, { supply: number; demand: number }][]
        ),
        new Map(Object.entries(context.localInputAvailability ?? {}) as [CommodityType, number][])
      ).throughput
    : 1;
  const cap = bounded(context.governorCap, 0.15);
  const throughput = clearing
    ? Math.max(
        1 - cap,
        capacityHaircutFactor(
          rawThroughput,
          context.throughputStartTurn ?? context.currentTurn,
          context.currentTurn
        )
      )
    : 1;
  const outputValue = outputRate * outputFactor * throughput;
  let inputCost = 0;
  if (context.mode === "plants") {
    for (const [key, rate] of Object.entries(recipe.demand) as [CommodityType, number][]) {
      if (!Number.isFinite(rate) || rate <= 0) continue;
      inputCost +=
        rate *
        priceRealizationFactor((context.inputPriceRatios ?? context.priceRatios)[key]) *
        throughput;
    }
  }
  return { score: outputValue - inputCost, outputValue, inputCost, throughput };
}
