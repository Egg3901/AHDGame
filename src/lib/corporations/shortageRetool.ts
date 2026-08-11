import type { CommodityType } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES, type ExtractableResource } from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategies";

/**
 * Shortage-destination retooling discount (week-1 clearing balance pass, t900).
 *
 * Switching strategy costs 25% of daily revenue plus a 12-turn transition and
 * a cooldown — good anti-flip-flop friction in general, but it also taxes the
 * one move the economy is begging for: pointing extraction at a resource in
 * chronic shortage. Nobody re-strategizes a working oil operation into a 4×-
 * short rare-earth deposit through a fee and a quarter-year ramp.
 *
 * When the DESTINATION strategy meaningfully supplies an extractable resource
 * whose GLOBAL supply/demand is below the shortage threshold, the retool fee
 * is waived and the transition window halves. The discount is incentive-
 * shaped and self-deactivating: as supply catches up and s/d rises past the
 * threshold, switching costs return to normal.
 */

/** Global s/d below which a resource counts as a shortage destination. */
export const SHORTAGE_RETOOL_SD_THRESHOLD = 0.5;

/** Minimum supply rate for an output to qualify the strategy (ignore trace outputs). */
export const SHORTAGE_RETOOL_MIN_RATE = 0.1;

/** Transition-window multiplier for shortage destinations (12 → 6 turns). */
export const SHORTAGE_RETOOL_TRANSITION_FACTOR = 0.5;

/**
 * Turns to backdate `transitionStartTurn` so every consumer of the standard
 * `(currentTurn − startTurn) / STRATEGY_TRANSITION_TURNS` progress formula
 * sees a half-length window without schema or call-site changes.
 */
export const SHORTAGE_RETOOL_TRANSITION_HEADSTART = Math.round(
  STRATEGY_TRANSITION_TURNS * (1 - SHORTAGE_RETOOL_TRANSITION_FACTOR)
);

export interface ShortageRetoolDecision {
  qualifies: boolean;
  /** The shortage resource that qualified the switch (first by rate, desc). */
  resource: ExtractableResource | null;
  /** That resource's global s/d at decision time (for messaging/logs). */
  sd: number | null;
}

/**
 * Decide whether a strategy switch qualifies for the shortage discount.
 * `balances` are the lagged global supply/demand per commodity (from the
 * commodityPrices docs — same one-turn lag as every market input).
 */
export function shortageRetoolDecision(
  targetStrategy: Pick<SectorStrategy, "supply">,
  balances: ReadonlyMap<CommodityType, { supply: number; demand: number }>
): ShortageRetoolDecision {
  const candidates = EXTRACTABLE_RESOURCES.filter(
    (r) => (targetStrategy.supply[r] ?? 0) >= SHORTAGE_RETOOL_MIN_RATE
  ).sort((a, b) => (targetStrategy.supply[b] ?? 0) - (targetStrategy.supply[a] ?? 0));

  for (const resource of candidates) {
    const bal = balances.get(resource);
    if (!bal || !(bal.demand > 0)) continue;
    const sd = Math.max(0, bal.supply) / bal.demand;
    if (sd < SHORTAGE_RETOOL_SD_THRESHOLD) {
      return { qualifies: true, resource, sd };
    }
  }
  return { qualifies: false, resource: null, sd: null };
}
