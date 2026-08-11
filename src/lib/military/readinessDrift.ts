import type { Posture } from "@/lib/db/types/militaryUnit";

/**
 * Where a unit's readiness settles, and how far it moves toward that each turn.
 *
 * A leaf module on purpose. Two places need these numbers — the turn processor,
 * which applies the drift (`militaryForceEffects.driftReadiness`), and the
 * conflict record, which PROJECTS it at the player ("+4%/turn · full in 6"). A
 * private copy on the reading side is a promise the tick is free to stop
 * keeping; importing the turn module instead would drag Mongo and the whole
 * collection layer into a page's view code.
 */
export const POSTURE_READINESS_BASELINE: Record<Posture, number> = {
  garrison: 60,
  standard: 72,
  forward: 84,
  alert: 92,
};

/** Readiness moves at most this far per turn, in either direction. */
export const READINESS_DRIFT_STEP = 4;

/**
 * How far a fully-unfunded force's readiness baseline sags. At 0.35 a nation paying none of
 * its upkeep settles toward 65% of each posture's normal baseline.
 *
 * Deliberately a suppressed TARGET rather than a decay counter: units walk toward it at the
 * existing ±4/turn and walk straight back when funding returns, so the mechanic is fully
 * reversible, needs no repair action, and can never remove a unit. On a one-hour turn clock
 * an irreversible drain would punish a player for sleeping.
 */
export const ARREARS_READINESS_WEIGHT = 0.35;

/**
 * The readiness a posture pulls toward, defaulting to `standard` for an unknown one and
 * suppressed by any unfunded share of the country's defence appropriation.
 *
 * `arrearsRatio` lives here, in the leaf both the turn processor and the conflict record
 * import, rather than in either caller: the record PROJECTS recovery at the player
 * ("+4%/turn · full in 6") from this same function, so a suppression applied in only one
 * of them would have the record promising a recovery the tick never delivers.
 */
export function readinessBaselineOf(posture: string, arrearsRatio = 0): number {
  const base =
    POSTURE_READINESS_BASELINE[posture as Posture] ?? POSTURE_READINESS_BASELINE.standard;
  const ratio = Math.min(1, Math.max(0, arrearsRatio));
  return Math.round(base * (1 - ratio * ARREARS_READINESS_WEIGHT));
}
