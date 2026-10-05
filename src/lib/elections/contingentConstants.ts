/** Pure contingent-election constants, free of server imports so client panels can reach them. */

/**
 * Modern-roster fallbacks: a majority of 50 House delegations and of 100
 * senators. The live ballot derives its thresholds from the rosters actually
 * voting (`contingentMajorityOf`), which reproduces these numbers exactly on
 * the modern roster and yields the era-correct 25-of-48 / 49-of-96 on 1950s
 * worlds. Kept exported as the no-roster fallback and for display defaults.
 */
export const HOUSE_CONTINGENT_THRESHOLD = 26;
export const SENATE_CONTINGENT_THRESHOLD = 51;

/** Majority of a contingent-ballot roster: more than half of its members. */
export function contingentMajorityOf(rosterSize: number, fallback: number): number {
  if (!Number.isFinite(rosterSize) || rosterSize <= 0) return fallback;
  return Math.floor(rosterSize / 2) + 1;
}
/** DC has EVs but no voting House delegation in a contingent election. */
export const CONTINGENT_EXCLUDED_HOUSE_STATE = "DC";
