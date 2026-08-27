import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { computeEffectivePower } from "@/lib/constants/military";
import { computeCard, navalReach } from "@/lib/military/combat";

/**
 * The national combat-power pool committable across theaters — the sum of every
 * live unit's effective power (posture × tech × veterancy × equipment).
 */
export function theaterPool(units: MilitaryUnit[]): number {
  return units.reduce((total, unit) => total + computeEffectivePower(unit), 0);
}

/**
 * The share of a pool that can actually be brought to bear at ONE front.
 *
 * `theaterPool` answers "what does this nation own", which is the right question for a
 * committable national pool and the wrong one for reading an enemy across a front: a
 * carrier group parked off a landlocked war contributes its whole effective power to
 * the first figure and almost none of it to the fight. Weighting by `navalReach` keeps
 * the conflict record's coarse enemy read agreeing with the war room's odds, which are
 * computed from `battleForecast` and have always been reach-aware since reach existed.
 *
 * Non-naval formations are untouched, so for an army this is exactly `theaterPool`.
 */
export function engageablePool(units: MilitaryUnit[], seaAccess: boolean | undefined): number {
  return units.reduce(
    (total, unit) =>
      total +
      computeEffectivePower(unit) *
        navalReach({ seaAccess }, unit.domain, computeCard(unit).traitKeys),
    0
  );
}
