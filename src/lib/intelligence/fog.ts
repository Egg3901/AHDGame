import { INTEL_FOG_MAX_DEVIATION, INTEL_FOG_WINDOW_TURNS } from "./config";

/**
 * Deterministic fog for intelligence readings.
 *
 * DELIBERATELY NOT `campaigns/fogOfWar.applyFog`. That one is `Math.random()`,
 * and its only non-test callers write a persisted per-turn snapshot. Fogging
 * live inside a read endpoint with a random source is re-samplable: a player
 * refreshes until the noise averages out and the fog is gone. The whole reason
 * `financialFogOfWar` is a hash is that the reading must be STABLE for a given
 * subject and window, and this mirrors it rather than inventing a second style.
 *
 * The factor itself is never served. Publishing it makes the fog trivially
 * invertible, which `financialFogOfWar` records as the mistake it had to fix.
 */
function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (((h << 5) + h) ^ seed.charCodeAt(i)) | 0;
  }
  return h;
}

/** The window a reading is stable within. Changes only when the window rolls. */
export function fogWindow(turn: number): number {
  return Math.floor(turn / INTEL_FOG_WINDOW_TURNS);
}

/**
 * A stable multiplier in [1 - deviation, 1 + deviation] for one subject, window
 * and figure.
 *
 * `variant` MUST differ between independent figures drawn for the same subject.
 * Two figures sharing one factor publish their exact ratio, because the factor
 * cancels when you divide them - the trap `applyFogToSectorPhysicals` documents.
 */
export function fogFactor(subject: string, turn: number, variant: string): number {
  const normalized =
    (Math.abs(hash(`${subject}:${fogWindow(turn)}:${variant}`)) % 100_000) / 100_000;
  return 1 - INTEL_FOG_MAX_DEVIATION + normalized * (2 * INTEL_FOG_MAX_DEVIATION);
}

/** A fogged whole number. Never returns a negative count. */
export function fogInteger(value: number, subject: string, turn: number, variant: string): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * fogFactor(subject, turn, variant)));
}
