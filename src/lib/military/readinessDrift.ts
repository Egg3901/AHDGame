import type { Posture } from "@/lib/db/types/militaryUnit";
import { TIER_FORCE_MODIFIER } from "@/lib/constants/military";

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

/**
 * Readiness moves at most this far per turn, in either direction.
 *
 * Raised from 4 once the battle ledger started recording readiness correctly. The drop a
 * battle takes GROWS with how worn a formation already is (`READINESS_TEMPO_K`), while
 * this recovery is flat, so the two only balance above a threshold: at 4 a formation spent
 * to the floor was knocked straight back down by its next engagement at every realistic
 * fighting cadence, and needed 23 uninterrupted turns to climb out. It never got them.
 * At 8 the climb is 12 turns and a war can be fought out of, not just into.
 *
 * Player-facing recovery copy reads this constant rather than restating it, so the war
 * room's "+N%/turn, full in M" follows automatically.
 */
export const READINESS_DRIFT_STEP = 8;

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
 *
 * `tier` is the DEPARTMENT-WIDE readiness setting the defence seat holds
 * (reduced / standard / elevated), not the unit's own posture. Ticket #1140: it used to
 * scale only the in-memory aggregate inside `aggregateForce`, so an Elevated department
 * charged 1.25x upkeep nationally and moved no unit's readiness by a single point. A
 * setting whose whole description is "higher force readiness" must move the number the
 * player is looking at, so it scales the BASELINE each unit walks toward. Capped at 100:
 * Elevated on High Alert (92 x 1.1) would otherwise target 101.
 */
export function readinessBaselineOf(
  posture: string,
  arrearsRatio = 0,
  tier?: string | null
): number {
  const base =
    POSTURE_READINESS_BASELINE[posture as Posture] ?? POSTURE_READINESS_BASELINE.standard;
  const tierMult = TIER_FORCE_MODIFIER[tier ?? "standard"]?.readinessMult ?? 1;
  const ratio = Math.min(1, Math.max(0, arrearsRatio));
  return Math.min(100, Math.round(base * tierMult * (1 - ratio * ARREARS_READINESS_WEIGHT)));
}
