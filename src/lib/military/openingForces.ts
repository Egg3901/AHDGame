/**
 * Select a small, comparable opening force from each side's reserve roster.
 * This is deliberately a deployment planner, not a unit generator: a country
 * with no era-valid roster cannot be given invented troops by the conflict
 * system.
 */

export interface OpeningForceCandidate {
  id: string;
  countryId: string;
  basePower: number;
}

export interface OpeningForcePlan {
  sideAIds: string[];
  sideBIds: string[];
  sideAPower: number;
  sideBPower: number;
}

const OPENING_FORCE_SHARE = 0.2;

function positivePower(units: OpeningForceCandidate[]): number {
  return units.reduce((total, unit) => total + Math.max(0, unit.basePower), 0);
}

function chooseOpeningForce(
  units: OpeningForceCandidate[],
  targetPower: number
): { ids: string[]; power: number } {
  const selected: OpeningForceCandidate[] = [];
  let power = 0;

  // Use the smallest formations first so one oversized unit does not turn a
  // modest opening commitment into an all-in deployment.
  for (const unit of [...units].sort(
    (a, b) => a.basePower - b.basePower || a.id.localeCompare(b.id)
  )) {
    if (selected.length > 0 && power >= targetPower) break;
    selected.push(unit);
    power += Math.max(0, unit.basePower);
  }

  return { ids: selected.map((unit) => unit.id), power };
}

/**
 * Plan an opening deployment for a two-sided conflict.
 *
 * Both sides commit the same share of the weaker reserve pool. If either side
 * has no reserve force, nothing is moved: the caller must not manufacture an
 * army merely to make the opening look balanced.
 */
export function planOpeningForceDeployment(
  units: OpeningForceCandidate[],
  sideACountries: string[],
  sideBCountries: string[]
): OpeningForcePlan {
  const sideA = units.filter((unit) => sideACountries.includes(unit.countryId));
  const sideB = units.filter((unit) => sideBCountries.includes(unit.countryId));
  const availableA = positivePower(sideA);
  const availableB = positivePower(sideB);

  if (availableA <= 0 || availableB <= 0) {
    return { sideAIds: [], sideBIds: [], sideAPower: 0, sideBPower: 0 };
  }

  const targetPower = Math.max(
    1,
    Math.floor(Math.min(availableA, availableB) * OPENING_FORCE_SHARE)
  );
  const selectedA = chooseOpeningForce(sideA, targetPower);
  const selectedB = chooseOpeningForce(sideB, targetPower);

  return {
    sideAIds: selectedA.ids,
    sideBIds: selectedB.ids,
    sideAPower: selectedA.power,
    sideBPower: selectedB.power,
  };
}
