/**
 * NPP minister resignation rule (epic #856, ticket #859).
 *
 * Rules core: plain data in, decision out. Randomness arrives as an injected
 * rng and time arrives as turns in post, with no database, wall clock,
 * or ambient reads, so the headless harness can run this
 * unchanged. The shell (`../nppResignation.ts`) loads the seat, applies the
 * outcome, and writes the confidence event.
 *
 * Design (uk-rework-design-2026-08-25): resignation is a deliberate act the
 * NPP AI chooses — a flat gauge hit each, so waves destabilise. Likelihood
 * rises as government approval falls below the confidence pivot; impact
 * weighting (Great Offices hit harder) lives in the gauge, not here.
 */

import { CONFIDENCE_APPROVAL_PIVOT } from "@/lib/uk/confidence/confidenceGauge";

export interface NppResignationInput {
  /** 0-100 government approval. */
  approval: number;
  /** Turns the NPP has held the seat. */
  turnsInPost: number;
}

/** Fresh appointees settle in before they consider quitting. */
export const NPP_RESIGNATION_GRACE_TURNS = 6;

/** Per-turn resignation chance for a settled minister of a popular government. */
export const NPP_RESIGNATION_BASE_CHANCE = 0.002;

/** Cap so a collapsing government loses ministers in waves, not all at once. */
export const NPP_RESIGNATION_MAX_CHANCE = 0.05;

/** Chance multiplier at zero approval relative to base. */
const APPROVAL_STRESS_MULTIPLIER = 9;

function clampApproval(approval: number): number {
  return Math.max(0, Math.min(100, approval));
}

/** Per-turn resignation probability for the input. Pure. */
export function nppResignationChance(input: NppResignationInput): number {
  if (input.turnsInPost < NPP_RESIGNATION_GRACE_TURNS) return 0;
  const approval = clampApproval(input.approval);
  const stress =
    approval >= CONFIDENCE_APPROVAL_PIVOT
      ? 0
      : (CONFIDENCE_APPROVAL_PIVOT - approval) / CONFIDENCE_APPROVAL_PIVOT;
  return Math.min(
    NPP_RESIGNATION_MAX_CHANCE,
    NPP_RESIGNATION_BASE_CHANCE * (1 + APPROVAL_STRESS_MULTIPLIER * stress)
  );
}

/** Roll the resignation decision with an injected rng. Pure. */
export function shouldNppMinisterResign(input: NppResignationInput, rng: () => number): boolean {
  return rng() < nppResignationChance(input);
}
