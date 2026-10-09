import { FIELD_OFFICE_RAMP_TURNS, type FieldOfficeScopeRules } from "./rules";

/**
 * Field-office effect math. Pure: no DB, no clock, so the vote engines, the
 * campaign UI preview and tests all read the same numbers.
 *
 * The effect is a turnout multiplier on one candidate's votes in one region:
 *
 *   regional = cap * (1 - exp(-sum(ramp * perOffice) / cap))
 *   local    = sum(ramp * subdivisionPct * electorateShare * yield)
 *   mult     = 1 + (regional + local) / 100
 *
 * The regional term saturates, so the tenth office in a state buys much less
 * than the first. The local term is linear in the county's size, so a large
 * county is the prize, and `yield` (frozen when the office opens) rewards
 * mobilising your own base over knocking doors where you are outnumbered.
 */

export interface FieldOfficeEffectInput {
  openedTurn: number;
  electorateShare: number;
  /** Candidate yield in the subdivision, 0.25..1.75. Missing = 1. */
  yieldFactor?: number;
}

export function fieldOfficeRamp(openedTurn: number, currentTurn: number): number {
  const age = currentTurn - openedTurn + 1;
  if (age <= 0) return 0;
  return Math.min(1, age / FIELD_OFFICE_RAMP_TURNS);
}

export interface FieldOfficeRegionEffect {
  regionalPct: number;
  localPct: number;
  multiplier: number;
}

export function fieldOfficeRegionEffect(
  offices: readonly FieldOfficeEffectInput[],
  rules: FieldOfficeScopeRules,
  currentTurn: number
): FieldOfficeRegionEffect {
  let presence = 0;
  let localPct = 0;
  for (const office of offices) {
    const ramp = fieldOfficeRamp(office.openedTurn, currentTurn);
    if (ramp === 0) continue;
    presence += ramp * rules.regionPerOfficePct;
    const share = Math.min(1, Math.max(0, office.electorateShare));
    localPct += ramp * rules.subdivisionPct * share * (office.yieldFactor ?? 1);
  }
  const regionalPct =
    rules.regionCapPct > 0
      ? rules.regionCapPct * (1 - Math.exp(-presence / rules.regionCapPct))
      : 0;
  return { regionalPct, localPct, multiplier: 1 + (regionalPct + localPct) / 100 };
}

/**
 * How many more of a candidate's voters an office turns out in a subdivision,
 * relative to the region. `orientation` is +1 for a right-of-centre candidate,
 * -1 for left, 0 for centrists; `relativeLean` is the subdivision PVI minus
 * the region PVI (positive = more right than the region).
 */
export function fieldOfficeYield(orientation: number, relativeLean: number): number {
  if (!Number.isFinite(relativeLean) || orientation === 0) return 1;
  const raw = 1 + (Math.sign(orientation) * relativeLean) / 30;
  return Math.min(1.75, Math.max(0.25, raw));
}
