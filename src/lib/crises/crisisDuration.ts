/**
 * Minimum lifetime, in turns, for any crisis or auto-disaster. Every fixed-
 * duration crisis is floored to this so effects have time to taper (effects ramp
 * linearly from full strength at onset to zero at expiry — see `crisisTurn.ts`).
 * Crises with `null` duration are indefinite and are left untouched.
 */
export const MIN_CRISIS_DURATION_TURNS = 24;

/**
 * Apply the minimum-duration floor. `null` (indefinite) passes through unchanged;
 * any finite value is raised to at least `MIN_CRISIS_DURATION_TURNS`.
 */
export function floorCrisisDuration(duration: number | null): number | null {
  if (duration === null) return null;
  return Math.max(MIN_CRISIS_DURATION_TURNS, duration);
}
