/**
 * Tier-2 sphere-macro countries refresh their aggregate kernel on a fixed
 * six-turn cadence. Buckets are staggered by entity id so a future roster
 * does not all tick on the same turn.
 */

export const MACRO_TICK_INTERVAL = 6;

/** Deterministic schedule bucket in `[0, MACRO_TICK_INTERVAL)`. */
export function macroTickBucket(entityId: string): number {
  let hash = 0;
  for (let i = 0; i < entityId.length; i++) {
    hash = (hash * 31 + entityId.charCodeAt(i)) >>> 0;
  }
  return hash % MACRO_TICK_INTERVAL;
}

/**
 * True when `turn` is a macro-kernel tick for `entityId`.
 * Turns are 1-indexed; bucket 0 ticks on 1, 7, 13, …
 */
export function isMacroTickTurn(turn: number, entityId: string): boolean {
  if (!Number.isFinite(turn) || turn < 1) return false;
  const bucket = macroTickBucket(entityId);
  const phase =
    (((turn - 1 - bucket) % MACRO_TICK_INTERVAL) + MACRO_TICK_INTERVAL) % MACRO_TICK_INTERVAL;
  return phase === 0;
}
