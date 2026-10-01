import { commodityMixWeight, type CommodityType } from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { DEMAND_PROBE_MARGIN } from "@/lib/turn/corporation/demandThrottle";

/**
 * Retool hint (ticket 1370 follow-up).
 *
 * The demand throttle holds a plant down when most of the VALUE it makes has
 * no buyer (`throttleSoldUnits`). For a mixed plant that is often a strategy
 * problem rather than a capacity one: a technology plant on the software
 * strategy in an oversupplied software market sells all of its electronics and
 * almost none of its software, while the hardware strategy of the same plant
 * would make mostly electronics into a shortage. Players read the result as
 * "demand limited for no reason" because nothing on the page names the lever.
 *
 * This finds that case and names the strategy that would sell. It is advisory
 * only: nothing here changes production, and the strategy change itself goes
 * through the normal retool command with its cost and transition.
 *
 * Fills for a candidate strategy are estimated from the sector's own market
 * book, with the plant's current output taken out and the candidate's output at
 * full capacity added in, so the hint never recommends a mix that would itself
 * flood the market it points at.
 */

/** A plant whose value-weighted fill clears this runs at full capacity under the throttle. */
export const RETOOL_HINT_SUSTAIN_FILL = 1 / (1 + DEMAND_PROBE_MARGIN);

/** A suggestion must sell at least this much more of its output value than today. */
export const RETOOL_HINT_MIN_GAIN = 0.15;

type Balance = { supply: number; demand: number };

export interface RetoolHint {
  currentStrategyId: string;
  /** The current mix's most valuable output and how much of it sold last turn. */
  currentMain: { commodity: CommodityType; valueShare: number; fill: number };
  /** Share of the current output's value that sold last turn, 0 to 1. */
  currentValueFill: number;
  suggestedStrategyId: string;
  suggestedStrategyName: string;
  /** The suggested mix's most valuable output and how short its market is. */
  suggestedMain: { commodity: CommodityType; valueShare: number; unmetShare: number };
  /** Estimated share of the suggested output's value buyers would take, 0 to 1. */
  suggestedValueFill: number;
}

export interface RetoolHintInput {
  currentStrategyId: string;
  /** The current strategy's supply mix, as the engine runs it. */
  currentSupply: Partial<Record<CommodityType, number>>;
  /** Last turn's fill per output (`sector.soldByCommodity`). */
  soldByCommodity: Partial<Record<string, number>> | null | undefined;
  /** Last turn's demand throttle (`sector.demandThrottleFactor`). */
  demandThrottleFactor: number | null | undefined;
  mothballed: boolean;
  /** A retool already in progress gets no new advice. */
  isTransitioning: boolean;
  /** Units the plant made last turn. */
  producedUnits: number | null | undefined;
  /** Installed capacity, units/day. */
  capacityUnits: number | null | undefined;
  /** Every strategy this sector type has, current included. */
  strategies: readonly SectorStrategy[];
  /** False for strategies the corporation cannot adopt (tech or decade locks). */
  isAvailable: (strategy: SectorStrategy) => boolean;
  /** The supply a strategy would actually yield here (extraction deposit filter). */
  supplyFor?: (strategy: SectorStrategy) => Partial<Record<CommodityType, number>>;
  /** Capacity rescale a retool from the current strategy to `toStrategyId` applies. */
  rescaleRatio: (toStrategyId: string) => number;
  /** Lagged price over base for one commodity in this sector's market. */
  priceRatioFor: (commodity: CommodityType) => number | null | undefined;
  /** This sector's market book for one commodity, lagged. */
  balanceFor: (commodity: CommodityType) => Balance | null | undefined;
  /** Base-price table the plant's units split on (the era ledger table). */
  basePrices: Record<CommodityType, number>;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function legs(supply: Partial<Record<CommodityType, number>>): [CommodityType, number][] {
  return (Object.entries(supply) as [CommodityType, number][]).filter(
    ([, rate]) => finite(rate) && rate > 0
  );
}

function valueWeight(rate: number, ratio: number | null | undefined): number {
  return rate * (finite(ratio) && ratio > 0 ? ratio : 1);
}

export function computeRetoolHint(input: RetoolHintInput): RetoolHint | null {
  if (input.mothballed || input.isTransitioning) return null;
  const throttle = input.demandThrottleFactor;
  if (!finite(throttle) || throttle >= 0.999) return null;
  const produced = finite(input.producedUnits) && input.producedUnits > 0 ? input.producedUnits : 0;
  const capacity = finite(input.capacityUnits) && input.capacityUnits > 0 ? input.capacityUnits : 0;
  if (!(capacity > 0) || !input.soldByCommodity) return null;

  // ── Today: what share of this plant's output value sold ────────────────────
  let currentWeight = 0;
  let currentSold = 0;
  let currentMain: RetoolHint["currentMain"] | null = null;
  let currentMainWeight = -1;
  for (const [commodity, rate] of legs(input.currentSupply)) {
    const fill = input.soldByCommodity[commodity];
    if (!finite(fill)) continue;
    const weight = valueWeight(rate, input.priceRatioFor(commodity));
    const clamped = Math.max(0, Math.min(1, fill));
    currentWeight += weight;
    currentSold += weight * clamped;
    if (weight > currentMainWeight) {
      currentMainWeight = weight;
      currentMain = { commodity, valueShare: 0, fill: clamped };
    }
  }
  if (!currentMain || !(currentWeight > 0)) return null;
  currentMain.valueShare = currentMainWeight / currentWeight;
  const currentValueFill = currentSold / currentWeight;
  // A plant whose output sells well enough is already climbing on its own.
  if (currentValueFill >= RETOOL_HINT_SUSTAIN_FILL) return null;

  // What this plant puts into each book today, so a candidate is not credited
  // with demand the plant is already serving or blamed for its own supply.
  const currentUnits = (commodity: CommodityType): number =>
    produced > 0
      ? produced * commodityMixWeight(input.currentSupply, input.basePrices, commodity)
      : 0;

  // ── Candidates: estimated value fill at full capacity ──────────────────────
  let best: { strategy: SectorStrategy; fill: number; main: RetoolHint["suggestedMain"] } | null =
    null;
  for (const strategy of input.strategies) {
    if (strategy.id === input.currentStrategyId || !input.isAvailable(strategy)) continue;
    const supply = input.supplyFor ? input.supplyFor(strategy) : strategy.supply;
    const candidateLegs = legs(supply);
    if (candidateLegs.length === 0) continue;
    const units = capacity * Math.max(0, input.rescaleRatio(strategy.id));
    let weightSum = 0;
    let soldSum = 0;
    let mainWeight = -1;
    let main: RetoolHint["suggestedMain"] | null = null;
    for (const [commodity, rate] of candidateLegs) {
      const weight = valueWeight(rate, input.priceRatioFor(commodity));
      const book = input.balanceFor(commodity);
      const demand = book && finite(book.demand) ? Math.max(0, book.demand) : 0;
      const otherSupply =
        book && finite(book.supply) ? Math.max(0, book.supply - currentUnits(commodity)) : 0;
      const ownUnits = units * commodityMixWeight(supply, input.basePrices, commodity);
      const offered = otherSupply + ownUnits;
      const fill = offered > 0 ? Math.min(1, demand / offered) : 0;
      weightSum += weight;
      soldSum += weight * fill;
      if (weight > mainWeight) {
        mainWeight = weight;
        const bookSupply = book && finite(book.supply) ? Math.max(0, book.supply) : 0;
        main = {
          commodity,
          valueShare: 0,
          unmetShare: demand > 0 ? Math.max(0, 1 - bookSupply / demand) : 0,
        };
      }
    }
    if (!main || !(weightSum > 0)) continue;
    main.valueShare = mainWeight / weightSum;
    const fill = soldSum / weightSum;
    if (!best || fill > best.fill) best = { strategy, fill, main };
  }
  if (!best) return null;
  if (best.fill < RETOOL_HINT_SUSTAIN_FILL) return null;
  if (best.fill < currentValueFill + RETOOL_HINT_MIN_GAIN) return null;

  return {
    currentStrategyId: input.currentStrategyId,
    currentMain,
    currentValueFill,
    suggestedStrategyId: best.strategy.id,
    suggestedStrategyName: best.strategy.name,
    suggestedMain: best.main,
    suggestedValueFill: best.fill,
  };
}
