import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

/** Max stacked regional-condition margin swing (percentage points). */
export const REGIONAL_CONDITION_MARGIN_CAP = 3;

/**
 * Default margin effect from an approval modifier: 75% of the approval delta,
 * rounded to one decimal. Address bumps do not affect margins.
 */
export function defaultMarginEffectForApproval(approvalEffect: number): number {
  return Math.round(approvalEffect * 0.75 * 10) / 10;
}

/** Per-modifier margin weight (1 = default 0.75× approval; 0 = approval-only). */
export const MODIFIER_MARGIN_FACTOR: Record<string, number> = {
  // Strong economic / business climate
  economic_boom: 1.33,
  recession: 1.33,
  high_unemployment: 1.33,
  slow_growth: 1.2,
  strong_growth: 1.2,
  cost_of_living_crisis: 1.33,
  affordable_living: 1.2,
  housing_crisis: 1.33,
  housing_stress: 1.33,
  affordable_housing: 1.2,
  innovation_economy: 1.33,
  research_hub: 1.5,
  heavy_public_debt: 1.1,
  slow_energy_transition: 1.1,
  // Right-coded positive — business / fiscal climate
  economic_freedom: 1.2,
  fiscal_discipline: 1.1,
  // Corruption drags operating environment
  high_corruption: 1.5,
  corruption_concerns: 1.5,
  // Safety affects commerce
  safe_streets: 1.2,
  crime_wave: 1.2,
  high_violent_crime: 1.1,
  // Weak environment / civic — partial business pass-through
  poor_air_quality: 0.5,
  high_carbon: 0.5,
  green_transition: 0.6,
  clean_environment: 0.8,
  // Mostly political / social sentiment — approval-only
  free_press: 0,
  high_voter_turnout: 0,
  civic_flourishing: 0,
  informed_society: 0,
  media_polarization: 0,
  information_disorder: 0,
  press_suppression: 0,
  high_immigration: 0,
  population_boom: 0,
  youth_surge: 0,
  brain_gain: 0,
  negative_net_migration: 0,
  declining_population: 0,
  aging_population: 0,
  high_public_trust: 0,
  low_public_trust: 0,
  social_cohesion: 0,
  social_breakdown: 0,
  // Right-coded positive — political / sentiment only
  strong_defense: 0,
  national_confidence: 0,
  secure_border: 0,
  broad_firearm_rights: 0,

  // The war block. Purely political: it moves approval and nothing else. This
  // registration is load-bearing rather than defensive — an unregistered id
  // takes the 0.75 default below, and war exhaustion reaches -25, so leaving it
  // out puts -18.75 into every region's margins and clamps at the cap.
  //
  // One entry per chip, because the block is now one chip per term. `war` is the
  // retired combined id and stays registered: the previous turn's chips are
  // stored on the approval document, so a country carries old-style entries
  // until its next snapshot overwrites them.
  war: 0,
  war_exhaustion: 0,
  war_effort: 0,
  alliance_contribution: 0,
};

export function marginEffectForModifier(approvalEffect: number, modifierId: string): number {
  const factor = MODIFIER_MARGIN_FACTOR[modifierId] ?? 1;
  if (factor === 0) return 0;
  return Math.round(approvalEffect * 0.75 * factor * 10) / 10;
}

/** Sum active metric conditions into a capped regional margin modifier. */
export function computeRegionalConditionMargin(modifiers: ActiveModifier[]): number {
  const raw = modifiers
    .filter((m) => m.source !== "address")
    .reduce((sum, m) => {
      const margin =
        m.marginEffect ?? (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id));
      return sum + margin;
    }, 0);
  return Math.max(
    -REGIONAL_CONDITION_MARGIN_CAP,
    Math.min(REGIONAL_CONDITION_MARGIN_CAP, Math.round(raw * 10) / 10)
  );
}
