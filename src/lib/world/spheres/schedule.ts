/**
 * NPP sphere-sponsor decisions run on a staggered six-turn cadence, matching
 * the Tier-1 "six-hour batch" strategic-decision window and the Tier-2 macro
 * tick interval. Player-controlled sponsors use the same capability surface
 * but are not throttled by this schedule.
 */

export const SPHERE_SPONSOR_TICK_INTERVAL = 6;

/** Deterministic schedule bucket in `[0, SPHERE_SPONSOR_TICK_INTERVAL)`. */
export function sphereSponsorTickBucket(sponsorId: string): number {
  let hash = 0;
  for (let i = 0; i < sponsorId.length; i++) {
    hash = (hash * 31 + sponsorId.charCodeAt(i)) >>> 0;
  }
  return hash % SPHERE_SPONSOR_TICK_INTERVAL;
}

/**
 * True when `turn` is an NPP sphere-sponsor decision turn for `sponsorId`.
 * Turns are 1-indexed; bucket 0 ticks on 1, 7, 13, …
 */
export function isSphereSponsorDecisionTurn(turn: number, sponsorId: string): boolean {
  if (!Number.isFinite(turn) || turn < 1) return false;
  const bucket = sphereSponsorTickBucket(sponsorId);
  const phase =
    (((turn - 1 - bucket) % SPHERE_SPONSOR_TICK_INTERVAL) + SPHERE_SPONSOR_TICK_INTERVAL) %
    SPHERE_SPONSOR_TICK_INTERVAL;
  return phase === 0;
}
