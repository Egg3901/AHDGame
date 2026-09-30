/**
 * Crisis displacement reduces available labour; damaged infrastructure reduces
 * potential growth. Recovery releases those constraints without creating people
 * or money. Stored exposure limits abrupt workforce changes and repeat turns.
 */
import type { LivingConflictState } from "../types";

export interface CrisisEconomicExposure {
  turn: number;
  displacedShare: number;
  hostingShare: number;
  infrastructureDamage: number;
}

const bounded = (value: number | undefined, max = 1) =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, value ?? 0)) : 0;
const approach = (previous: number, target: number, turns: number) =>
  previous + Math.max(-0.0005 * turns, Math.min(0.0005 * turns, target - previous));

export function crisisEconomicExposure(
  conflict: LivingConflictState | null,
  region: { _id: string; countryId: string },
  previous: CrisisEconomicExposure | undefined,
  turn: number,
  elapsedTurns = 1
): CrisisEconomicExposure {
  if (previous?.turn === turn) return previous;
  const steps = Math.max(1, Math.min(6, elapsedTurns));
  const active = conflict?.hasOpened && conflict.status !== "closed";
  const local =
    active &&
    (region.countryId === "YU" ||
      region._id.startsWith("YU_") ||
      conflict.representedActors?.some(
        (actor) => actor.regionIds.includes(region._id) || actor.countryId === region.countryId
      ));
  const host = active && !local && ["AT", "IT", "GR"].includes(region.countryId);
  const displacement = active ? bounded(conflict.tracks?.displacement, 100) / 100 : 0;
  const damage = active ? bounded(conflict.tracks?.infrastructureDamage, 100) / 100 : 0;
  const reconstruction = active ? bounded(conflict.tracks?.reconstruction, 100) / 100 : 0;
  return {
    turn,
    // At the extreme, at most a tenth of local civilian labour is displaced.
    // Movement per turn is capped at 0.05 percentage points of the population.
    displacedShare: approach(
      bounded(previous?.displacedShare, 0.1),
      local ? displacement * 0.1 : 0,
      steps
    ),
    hostingShare: approach(
      bounded(previous?.hostingShare, 0.005),
      host ? displacement * 0.005 : 0,
      steps
    ),
    infrastructureDamage: local ? damage * (1 - reconstruction) : 0,
  };
}

export function crisisParticipationMultiplier(exposure: CrisisEconomicExposure): number {
  return 1 - bounded(exposure.displacedShare, 0.1) - bounded(exposure.hostingShare, 0.005);
}

export function crisisPotentialGrowthPenalty(exposure: CrisisEconomicExposure): number {
  // Annual percentage points, a standing supply constraint rather than a new
  // cumulative debit on every crisis response window.
  return 2 * bounded(exposure.infrastructureDamage);
}

/** Held macro output loses at most 20% to damaged infrastructure. */
export function crisisMacroOutputMultiplier(exposure: CrisisEconomicExposure): number {
  return (
    crisisParticipationMultiplier(exposure) * (1 - 0.2 * bounded(exposure.infrastructureDamage))
  );
}
