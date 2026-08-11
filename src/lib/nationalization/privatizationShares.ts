import type { Corporation } from "@/lib/db/types";
import { CEO_INITIAL_SHARES, MIN_SHARE_PRICE } from "@/lib/constants/corporations";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { GOLDEN_SHARE_MAX, RENATIONALIZE_COOLDOWN_TURNS } from "./constants";

export interface SpunOutShareStructure {
  /** Standard issued-share base (matches founding). */
  totalShares: number;
  /** Offering / floor price in the corp's home (country) currency. */
  sharePrice: number;
  /** State-retained golden shares (held by the primary National Corporation). */
  goldenShares: number;
  /** Shares released to the public float (the IPO tranche). */
  floatShares: number;
  /** Divestiture proceeds = floatShares × sharePrice, in country currency. */
  proceedsLocal: number;
}

/**
 * Cap table for a privatization spin-out (spec §13.1/§13.2). Price is the carve
 * valuation spread over the era's share base (floored at MIN_SHARE_PRICE); the
 * state keeps `goldenSharePercent` (clamped to GOLDEN_SHARE_MAX) and floats the
 * rest. Pure — all money already in the country's currency.
 *
 * `preset` deflates the share base with the era, matching founding: an era
 * valuation spread over a fixed 10M-share base prices below MIN_SHARE_PRICE
 * and floors, overstating the float's proceeds. Omit for modern behaviour.
 */
export function computeSpunOutShareStructure(input: {
  valuationLocal: number;
  goldenSharePercent: number;
  preset?: string;
}): SpunOutShareStructure {
  const totalShares = getEraFounderShares(CEO_INITIAL_SHARES, input.preset);
  const sharePrice = Math.max(
    MIN_SHARE_PRICE,
    Math.round((Math.max(0, input.valuationLocal) / totalShares) * 100) / 100
  );
  const goldenFraction = Math.min(GOLDEN_SHARE_MAX, Math.max(0, input.goldenSharePercent));
  const goldenShares = Math.round(totalShares * goldenFraction);
  const floatShares = totalShares - goldenShares;
  const proceedsLocal = Math.round(floatShares * sharePrice);
  return { totalShares, sharePrice, goldenShares, floatShares, proceedsLocal };
}

/** True while a spun-out corp is still inside the re-nationalization cooldown (spec §13.4). */
export function isWithinRenationalizeCooldown(
  corp: Pick<Corporation, "privatizedAtTurn">,
  currentTurn: number
): boolean {
  if (corp.privatizedAtTurn == null) return false;
  return currentTurn - corp.privatizedAtTurn < RENATIONALIZE_COOLDOWN_TURNS;
}
