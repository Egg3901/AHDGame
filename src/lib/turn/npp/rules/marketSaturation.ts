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

import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";

/**
 * A cell whose plants run, capacity-weighted, below this share of their
 * capacity has no room for another plant. Half: the incumbents could double
 * their output before the market would need a new entrant.
 */
export const NPP_SATURATED_MARKET_THROTTLE = 0.5;

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
