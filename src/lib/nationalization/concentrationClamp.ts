/** Pure SOCI clamp, kept free of server imports so client views can reach it. */

/** Clamp any value into the SOCI range [0,100]; non-finite ⇒ 0. */
export function clampConcentration(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
