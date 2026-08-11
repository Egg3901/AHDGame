import { LAYER1_DEMOGRAPHICS } from "@/lib/utils/demographicAlignment";
import { applyDiminishingReturns } from "@/lib/utils/diminishingReturns";
import type { StateDemographicTurnout } from "@/lib/db/types";

// ─── GOTV / Budget Spend Calculations ────────────────────────────────────────

/**
 * Calculate the dollar amount to spend on GOTV this turn.
 * Prefers the percent-based formula; falls back to the legacy flat amount.
 *
 * @param revenue - Hourly revenue for this party / scope
 * @param gotvBudgetPercent - Percentage of revenue allocated to GOTV (0-25)
 * @param gotvBudgetPerTurn - Legacy flat spend per turn (used when gotvBudgetPercent is 0)
 * @returns Dollar amount to spend on GOTV this turn
 */
export function calculateGOTVSpend(
  revenue: number,
  gotvBudgetPercent: number,
  gotvBudgetPerTurn: number
): number {
  if (gotvBudgetPercent > 0) {
    return Math.floor(revenue * (gotvBudgetPercent / 100));
  }
  if (gotvBudgetPerTurn > 0) {
    return gotvBudgetPerTurn; // Legacy flat amount
  }
  return 0;
}

/**
 * Calculate the dollar amount to spend on a voter-registration drive this turn
 * (player suggestion #81). Mirrors `calculateGOTVSpend`'s percent-of-revenue
 * formula (no legacy flat-amount lane).
 *
 * @param revenue - Hourly revenue for this party / scope
 * @param registrationBudgetPercent - Percentage of revenue allocated to registration (0-25)
 * @returns Dollar amount to spend on the registration drive this turn
 */
export function calculateRegistrationDriveSpend(
  revenue: number,
  registrationBudgetPercent: number
): number {
  if (registrationBudgetPercent <= 0) return 0;
  return Math.floor(revenue * (registrationBudgetPercent / 100));
}

/**
 * Calculate the dollar amount to spend on voter suppression this turn.
 *
 * @param revenue - Hourly revenue for this party / scope
 * @param suppressionBudgetPercent - Percentage of revenue allocated to suppression (0-100)
 * @returns Dollar amount to spend on suppression this turn
 */
export function calculateSuppressionSpend(
  revenue: number,
  suppressionBudgetPercent: number
): number {
  if (suppressionBudgetPercent <= 0) return 0;
  return Math.floor(revenue * (suppressionBudgetPercent / 100));
}

/**
 * Calculate the dollar amount to spend on organization building this turn.
 *
 * @param revenue - Hourly revenue for this party / scope
 * @param orgBuildingPercent - Percentage of revenue allocated to org building (0-100)
 * @returns Dollar amount to spend on org building this turn
 */
export function calculateOrgBuildingSpend(revenue: number, orgBuildingPercent: number): number {
  if (orgBuildingPercent <= 0) return 0;
  return Math.floor(revenue * (orgBuildingPercent / 100));
}

// ─── Turnout Boost Calculations ───────────────────────────────────────────────

/**
 * Calculate the per-state GOTV turnout boost for a national spend.
 *
 * @param totalSpend - Total GOTV dollars being spent nationally
 * @param numStates - Number of states across which spend is divided
 * @param dollarsPerTurnoutPoint - Dollars required to move one turnout point
 * @param alignmentMultiplier - Alignment scaling factor (0.1–1.0)
 * @returns Turnout boost to apply in each state
 */
export function calculateNationalGOTVBoost(
  totalSpend: number,
  numStates: number,
  dollarsPerTurnoutPoint: number,
  alignmentMultiplier: number
): number {
  if (numStates === 0) return 0;
  const rawPerState = totalSpend / numStates;
  return (rawPerState / dollarsPerTurnoutPoint) * alignmentMultiplier;
}

/**
 * Calculate the GOTV turnout boost for a state-scoped spend.
 *
 * @param spend - Total GOTV dollars being spent in the state
 * @param dollarsPerTurnoutPoint - Dollars required to move one turnout point
 * @param alignmentMultiplier - Alignment scaling factor (0.1–1.0)
 * @returns Turnout boost to apply in the state
 */
export function calculateStateGOTVBoost(
  spend: number,
  dollarsPerTurnoutPoint: number,
  alignmentMultiplier: number
): number {
  return (spend / dollarsPerTurnoutPoint) * alignmentMultiplier;
}

/**
 * Apply a boost (positive or negative) to a specific demographic group within a
 * state's turnout modifiers. Applies diminishing returns and clamps the result to
 * the valid range of -20 to +20.
 *
 * NOTE: This function mutates the `state` argument in place.
 *
 * @param state - The state's demographic turnout record to modify
 * @param demo - The demographic category and group to target
 * @param boost - The raw boost amount (positive for GOTV, negative for suppression)
 */
export function applyBoost(
  state: StateDemographicTurnout,
  demo: { category: string; group: string },
  boost: number
): void {
  // DemographicModifiers is Record<string, Record<string, number>> — generic lookup works
  // for both legacy US documents (race/age/...) and new country-specific categories.
  const categoryModifiers = state.modifiers[demo.category];
  if (!categoryModifiers) return;

  const currentModifier = categoryModifiers[demo.group] ?? 0;
  const adjustedBoost = applyDiminishingReturns(currentModifier, boost);

  // Apply boost and clamp to +/-20
  const newModifier = Math.max(-20, Math.min(20, currentModifier + adjustedBoost));
  categoryModifiers[demo.group] = newModifier;
}

// ─── Organization Momentum Calculations ──────────────────────────────────────

/**
 * Calculate the momentum gained from an org-building spend.
 *
 * @param spend - Dollar amount spent on org building
 * @param dollarsPerMomentumPoint - Dollars required to gain one momentum point
 * @returns Raw momentum gain (before clamping)
 */
export function calculateMomentumGain(spend: number, dollarsPerMomentumPoint: number): number {
  return spend / dollarsPerMomentumPoint;
}

/**
 * Calculate the new momentum value after adding a gain, clamped to [-10, +10].
 *
 * @param currentMomentum - Current momentum value
 * @param momentumGain - Momentum gain to add (may be negative for losses)
 * @returns New momentum value, clamped to the range [-10, +10]
 */
export function calculateNewMomentum(currentMomentum: number, momentumGain: number): number {
  return Math.min(10, Math.max(-10, currentMomentum + momentumGain));
}

/**
 * Apply proportional decay to a momentum value, moving it toward zero each turn.
 * Values smaller than 0.1 in magnitude are snapped to zero.
 *
 * @param momentum - Current momentum value
 * @param decayRate - Fraction of current magnitude to decay per turn (e.g. 0.2 = 20%)
 * @returns New momentum value after decay, rounded to one decimal place
 */
export function applyMomentumDecay(momentum: number, decayRate: number): number {
  if (momentum === 0) return 0;
  const decayAmount = Math.abs(momentum) * decayRate;
  let newMomentum: number;
  if (momentum > 0) {
    newMomentum = Math.max(0, momentum - decayAmount);
  } else {
    newMomentum = Math.min(0, momentum + decayAmount);
  }
  newMomentum = Math.round(newMomentum * 10) / 10;
  if (Math.abs(newMomentum) < 0.1) newMomentum = 0;
  return newMomentum;
}

// ─── Canvassing Calculations ──────────────────────────────────────────────────

/**
 * Calculate the turnout boost from a single canvassing action.
 * Base effectiveness is 0.05 percentage points, scaled by ideological alignment
 * (0.1x–1.0x) and doubled during active campaign season.
 *
 * @param charPosition - The canvassing character's economic/social position
 * @param demoLean - The target demographic's economic/social lean
 * @param isActiveCampaignSeason - Whether the game is currently in campaign season
 * @returns Turnout boost in percentage points
 */
export function calculateCanvassingBoost(
  charPosition: { economic: number; social: number },
  demoLean: { economic: number; social: number },
  isActiveCampaignSeason: boolean
): number {
  const BASE_BOOST = 0.05; // 0.05 percentage points

  // Alignment multiplier: further from demographic lean = less effective
  const distance =
    Math.abs(charPosition.economic - demoLean.economic) +
    Math.abs(charPosition.social - demoLean.social);
  const alignmentMultiplier = Math.max(0.1, 1.0 - distance * 0.15);

  // Campaign season doubles effectiveness
  const seasonMultiplier = isActiveCampaignSeason ? 2.0 : 1.0;

  return BASE_BOOST * alignmentMultiplier * seasonMultiplier;
}

/**
 * Look up the economic and social lean for a demographic group from the
 * LAYER1_DEMOGRAPHICS constant. Returns (0, 0) for unknown groups.
 *
 * @param category - Demographic category (e.g. "age", "race")
 * @param group - Demographic group within the category (e.g. "young", "white")
 * @returns The demographic's economic and social lean values
 */
export function getDemographicLean(
  category: string,
  group: string
): { economic: number; social: number } {
  const demo = LAYER1_DEMOGRAPHICS.find((d) => d.category === category && d.group === group);
  return {
    economic: demo?.economicLean ?? 0,
    social: demo?.socialLean ?? 0,
  };
}
