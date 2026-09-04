import type { NetworkFunding } from "@/lib/db/types/intelligence";
import {
  ACTION_COST_GDP_FRACTION,
  NETWORK_UPKEEP_GDP_FRACTION,
  OP_COST_GDP_FRACTION,
} from "./config";

/**
 * Zero on an unusable GDP rather than NaN or a throw.
 *
 * This runs inside a per-turn sweep over every country, so a data gap must not take down the
 * turn loop. Zero is also the safe direction: an invented charge would silently starve a
 * whole service over a missing figure, where a free turn is visible and self-correcting.
 */
function priceAt(fraction: number, gdp: number): number {
  if (!Number.isFinite(gdp) || gdp <= 0) return 0;
  return fraction * gdp;
}

/** What one operation costs the ordering country, in that country's own currency. */
export function operationCost(kind: "collect" | "action", gdp: number): number {
  return priceAt(kind === "action" ? ACTION_COST_GDP_FRACTION : OP_COST_GDP_FRACTION, gdp);
}

/** What one network costs its owner per turn, in the owner's own currency. */
export function networkUpkeep(funding: NetworkFunding, gdp: number): number {
  return priceAt(NETWORK_UPKEEP_GDP_FRACTION[funding] ?? 0, gdp);
}
