/**
 * Pure math for FX intervention — no DB access.
 *
 * Given the current rate, an active band, and available reserves, compute the
 * synthetic trade volume the CB should inject into the volume-pressure channel
 * this turn, plus the reserve cost. Sign convention: positive synthetic volume
 * = buying home currency (strengthens rate against weakening breach); negative
 * = selling home currency (weakens rate against appreciation).
 *
 * Spend scales with breach distance × INTERVENTION_AGGRESSIVENESS in internal
 * FX-volume units, truncated by available reserves converted into those same
 * units. The forex turn phase is responsible for converting reserve-currency
 * balances, feeding the result into the combined pressure term, and clamping
 * against the shared VOLUME_PRESSURE_CAP.
 */

import { INTERVENTION_AGGRESSIVENESS } from "@/lib/constants/currencies";
import type { InterventionPolicy } from "@/lib/db/types/exchangeRate";

export interface InterventionResult {
  /** Signed synthetic volume in internal units. 0 means no intervention. */
  syntheticVolume: number;
  /** Absolute reserve spend in internal FX-volume units. */
  reserveCost: number;
  direction: "buy" | "sell" | "none";
}

export function isInBand(rate: number, band: InterventionPolicy): boolean {
  return rate >= band.floor && rate <= band.ceiling;
}

/**
 * Signed breach fraction. Positive = rate above ceiling (weak currency, needs
 * defensive buying). Negative = rate below floor (strong currency, needs
 * defensive selling). Zero when in band.
 */
export function breachDistance(rate: number, band: InterventionPolicy): number {
  if (rate > band.ceiling) return (rate - band.ceiling) / band.ceiling;
  if (rate < band.floor) return (rate - band.floor) / band.floor; // negative
  return 0;
}

export function computeInterventionPressure(
  rate: number,
  band: InterventionPolicy,
  availableReserves: number
): InterventionResult {
  const breach = breachDistance(rate, band);
  if (breach === 0 || availableReserves <= 0) {
    return { syntheticVolume: 0, reserveCost: 0, direction: "none" };
  }

  // Desired spend scales with absolute breach × aggressiveness. Reserve balances
  // are converted to internal units before reaching this pure function, matching
  // tradeHistory volume pressure.
  // Sign of syntheticVolume opposes breach direction (buying to push rate down
  // toward the ceiling if rate is above, selling if below floor).
  const desiredAbsolute = Math.abs(breach) * INTERVENTION_AGGRESSIVENESS;
  const actualAbsolute = Math.min(desiredAbsolute, availableReserves);

  // Rate above ceiling (breach > 0): CB buys home currency (positive volume).
  // Rate below floor (breach < 0): CB sells home currency (negative volume).
  const sign = breach > 0 ? 1 : -1;

  return {
    syntheticVolume: sign * actualAbsolute,
    reserveCost: actualAbsolute,
    direction: breach > 0 ? "buy" : "sell",
  };
}
