/**
 * Physical market saturation for NPP placement: how hard the demand throttle is
 * holding the plants that already serve a state-sector cell.
 *
 * Plain data in, plain data out: no clock, rng or ambient state.
 *
 * Why not price or fill. The NPP entry and growth gates scored markets on the
 * commodity price ratio and on each plant's `soldFraction`. Neither sees a glut
 * once the throttle has done its job: the throttle cuts a plant's run to what
 * buyers take, so the plant sells most of what it makes (fill 0.6-0.9) while
 * running at a tenth of its capacity, and a world-wide price ratio of 2-3x base
 * read as shortage everywhere. On live turn 250, 399 producing sectors sat
 * below -100% margin, 292 of their 316 corps NPP-run, most founded in the
 * previous three days into cells whose existing plants were held at the 0.1
 * throttle floor. The throttle itself is the direct measure of unmet demand, so
 * placement reads it.
 *
 * Saturation of a cell is the capacity-weighted demand throttle of its plants.
 * Mothballed capacity counts at 0: it is capacity the market already refused.
 * A cell with no capacity carrying a throttle reading has no evidence and
 * returns null, which never blocks.
 */

import type { CommodityType } from "@/lib/constants/commodities";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { sectorDemandGapUnits } from "@/lib/market/sectorDemandGap";
import { COMMODITY_BASE_PRICES, commodityMixWeight } from "@/lib/constants/commodities";

/**
 * A cell has room for another plant only when its plants run, capacity-weighted,
 * at essentially their full capacity: the demand throttle is below 1 exactly
 * when a plant cannot sell all it could make, so any cell under this bar is
 * already demand-limited and a new plant only splits sales that are spoken for.
 * Stricter than the bar an incumbent must clear to grow (NPP_GROWTH_MIN_THROTTLE,
 * 0.9): growing a plant that sells 90% adds a little capacity to a market it
 * already serves, founding adds a whole new plant. Live turn 255, with a 0.9
 * bar: 78 of 90 AI foundings entered cells at 0.9 or above, and 357 of the 569
 * AI plants founded since turn 246 ran below half capacity.
 */
export const NPP_SATURATED_MARKET_THROTTLE = 0.98;

export interface SaturationSectorLike {
  stateId: string;
  sectorType: string;
  industryModel?: string | null;
  mediaDiscriminator?: string | null;
  capitalStock?: number | null;
  demandThrottleFactor?: number | null;
  mothballed?: boolean | null;
}

interface CellTally {
  capacity: number;
  runCapacity: number;
}

export type MarketSaturationIndex = ReadonlyMap<string, CellTally>;

/**
 * One sector's contribution to its cell, or null when it carries no reading.
 * Shared by the index and by `excluding` so the two can never disagree.
 */
function contributionOf(s: SaturationSectorLike): { capacity: number; run: number } | null {
  const capacity = s.capitalStock;
  if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0) return null;
  if (s.mothballed === true) return { capacity, run: 0 };
  if (typeof s.demandThrottleFactor === "number" && Number.isFinite(s.demandThrottleFactor)) {
    return { capacity, run: capacity * Math.max(0, Math.min(1, s.demandThrottleFactor)) };
  }
  // Mid-build, legacy or not yet cleared: no reading, no evidence.
  return null;
}

export function buildMarketSaturationIndex(
  sectors: readonly SaturationSectorLike[]
): MarketSaturationIndex {
  const index = new Map<string, CellTally>();
  for (const s of sectors) {
    const c = contributionOf(s);
    if (!c) continue;
    const key = bucketKey(s.stateId, s.sectorType, s.industryModel, s.mediaDiscriminator);
    const tally = index.get(key) ?? { capacity: 0, runCapacity: 0 };
    tally.capacity += c.capacity;
    tally.runCapacity += c.run;
    index.set(key, tally);
  }
  return index;
}

/**
 * Capacity-weighted throttle of a cell in [0, 1], or null without evidence.
 * `excluding` removes one sector's own contribution, so a mothballed plant
 * deciding whether to restart is judged on its rivals, not on its own cold
 * capacity.
 */
export function marketSaturationOf(
  index: MarketSaturationIndex,
  cell: {
    stateId: string;
    sectorType: string;
    industryModel?: string | null;
    mediaDiscriminator?: string | null;
  },
  excluding?: SaturationSectorLike
): number | null {
  const tally = index.get(
    bucketKey(cell.stateId, cell.sectorType, cell.industryModel, cell.mediaDiscriminator)
  );
  if (!tally) return null;
  const own = excluding ? contributionOf(excluding) : null;
  const capacity = tally.capacity - (own?.capacity ?? 0);
  const run = tally.runCapacity - (own?.run ?? 0);
  if (!(capacity > 1e-9)) return null;
  return Math.max(0, Math.min(1, run / capacity));
}

/**
 * NPP-run plants whose own throttle sits under this share of capacity for
 * NPP_FLOOR_MOTHBALL_TURNS consecutive glutted turns are mothballed, whatever
 * the price ratio says. Just above the 0.1 throttle floor and the 0.25 crew
 * floor: the plant pays a quarter of its crew and its upkeep to sell a tenth.
 */
export const NPP_FLOOR_MOTHBALL_THROTTLE = 0.25;

/**
 * Glutted-turn streak (`demandIdleTurns`) before the floor mothball applies.
 * Twice the idle-retirement grace, so retirement gets the first chance to
 * shrink a plant that is only somewhat oversized.
 */
export const NPP_FLOOR_MOTHBALL_TURNS = 12;

export function isStuckAtThrottleFloor(sector: {
  demandThrottleFactor?: number | null;
  demandIdleTurns?: number | null;
}): boolean {
  const t = sector.demandThrottleFactor;
  const streak = sector.demandIdleTurns;
  return (
    typeof t === "number" &&
    Number.isFinite(t) &&
    t < NPP_FLOOR_MOTHBALL_THROTTLE &&
    typeof streak === "number" &&
    streak >= NPP_FLOOR_MOTHBALL_TURNS
  );
}

export function isMarketSaturated(level: number | null | undefined): boolean {
  return (
    typeof level === "number" && Number.isFinite(level) && level < NPP_SATURATED_MARKET_THROTTLE
  );
}

/**
 * Share of a cell's measured unmet demand one AI founding may build for. The
 * entrant was sized off the unowned pool's headroom, which overstates what a
 * market still wants: on live turn 257, 47 of 54 AI foundings entered cells
 * whose plants sold out, and the young AI plants then made up 141 of the 263
 * plants running under a fifth of capacity, because a sold-out market that is
 * only slightly short cannot absorb a full-size new plant. Half leaves room for
 * a second entrant and for the incumbents' own probe.
 */
export const NPP_FOUNDING_UNMET_SHARE = 0.5;

/**
 * Unmet demand for one cell in sector output units, for the output mix the new
 * plant would actually run. "mean" is the rate-weighted mean gap
 * (sectorDemandGapUnits, the same helper the player build preview uses); "max"
 * is the deepest single leg, for critical-shortage entries whose shortage leg a
 * balanced co-product would otherwise dilute (logistics averages freight with
 * consulting). Null when no leg can be read, which never caps.
 */
export function cellUnmetDemandUnits(args: {
  supplyMix: Partial<Record<CommodityType, number>>;
  gapFor: (commodity: CommodityType) => number | null;
  aggregate?: "mean" | "max";
}): number | null {
  let readable = false;
  const gapOf = (commodity: CommodityType) => {
    const gap = args.gapFor(commodity);
    if (gap == null) return 0;
    readable = true;
    return Math.max(0, gap);
  };
  if (args.aggregate === "max") {
    let best = 0;
    for (const [commodity, rate] of Object.entries(args.supplyMix) as [CommodityType, number][]) {
      if (!(rate > 0)) continue;
      const weight = commodityMixWeight(args.supplyMix, COMMODITY_BASE_PRICES, commodity);
      if (!(weight > 0)) continue;
      best = Math.max(best, gapOf(commodity) / weight);
    }
    return readable ? best : null;
  }
  const units = sectorDemandGapUnits(args.supplyMix, gapOf);
  return readable ? units : null;
}

/**
 * Founding size and eligibility from a cell's unmet demand. The plant builds
 * for at most NPP_FOUNDING_UNMET_SHARE of it, and enters only when that share
 * covers one starter facility: flooring a smaller share up to a whole facility
 * would build more than the share. No reading never caps or blocks.
 */
export function foundingUnmetSizing(args: { unmetUnits: number | null; starterUnits: number }): {
  sizeCap: number;
  blocksEntry: boolean;
} {
  if (args.unmetUnits == null || !Number.isFinite(args.unmetUnits)) {
    return { sizeCap: Number.POSITIVE_INFINITY, blocksEntry: false };
  }
  const sizeCap = Math.max(0, args.unmetUnits) * NPP_FOUNDING_UNMET_SHARE;
  return { sizeCap, blocksEntry: sizeCap < args.starterUnits };
}
