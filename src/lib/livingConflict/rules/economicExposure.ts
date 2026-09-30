/**
 * Crisis displacement reduces available labour; damaged infrastructure reduces
 * potential growth. Recovery releases those constraints without creating people
 * or money. Stored exposure limits abrupt workforce changes and repeat turns.
 */
import { arabEconomicTarget } from "./arabRegional";
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
  conflict: LivingConflictState | readonly LivingConflictState[] | null,
  region: { _id: string; countryId: string },
  previous: CrisisEconomicExposure | undefined,
  turn: number,
  elapsedTurns = 1
): CrisisEconomicExposure {
  if (previous?.turn === turn) return previous;
  const steps = Math.max(1, Math.min(6, elapsedTurns));
  const conflicts: readonly LivingConflictState[] = !conflict
    ? []
    : Array.isArray(conflict)
      ? conflict
      : [conflict as LivingConflictState];
  let displaced = 0;
  let hosted = 0;
  let infrastructureDamage = 0;
  for (const current of conflicts) {
    if (!current.hasOpened || current.status === "closed") continue;
    if (current.defKey === "arab_uprisings") {
      const target = arabEconomicTarget(current, region.countryId);
      displaced += target.displacedShare;
      hosted += target.hostingShare;
      infrastructureDamage += target.infrastructureDamage;
      continue;
    }
    const ukraine = current.defKey === "russia_ukraine_security";
    const origin = ukraine ? "UKR" : "YU";
    const local =
      region.countryId === origin ||
      region._id.startsWith(`${origin}_`) ||
      current.representedActors?.some(
        (actor) => actor.regionIds.includes(region._id) || actor.countryId === region.countryId
      );
    const host =
      !local &&
      (ukraine ? ["PL", "RO", "HU", "TR", "DE"] : ["AT", "IT", "GR"]).includes(region.countryId);
    const displacement = bounded(current.tracks?.displacement, 100) / 100;
    const damage = bounded(current.tracks?.infrastructureDamage, 100) / 100;
    const reconstruction = bounded(current.tracks?.reconstruction, 100) / 100;
    displaced += local ? displacement * 0.1 : 0;
    hosted += host ? displacement * 0.005 : 0;
    infrastructureDamage += local ? damage * (1 - reconstruction) : 0;
  }
  return {
    turn,
    // At the extreme, at most a tenth of local civilian labour is displaced.
    // Movement per turn is capped at 0.05 percentage points of the population.
    displacedShare: approach(
      bounded(previous?.displacedShare, 0.1),
      bounded(displaced, 0.1),
      steps
    ),
    hostingShare: approach(bounded(previous?.hostingShare, 0.005), bounded(hosted, 0.005), steps),
    infrastructureDamage: bounded(infrastructureDamage),
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
