/**
 * Game Formulas and Calculations
 * Shared between frontend (for display) and backend (for execution)
 *
 * Note: Action-specific formulas (fundraise, campaign, ads, donor base, etc.)
 * live in src/lib/actions.ts as the single source of truth.
 */

/** Favorability is stable at or below this value unless other systems reduce it. */
export const FAVORABILITY_NATURAL_DECAY_THRESHOLD = 60;

/** Political influence decays by 0.75% of current value per turn. */
export const POLITICAL_INFLUENCE_DECAY_RATE = 0.0075;

/**
 * NPPs are seeded at 10 influence and are meant to never decay below it — the
 * "decay floor" referenced in the NPP generator. Unlike players (who command a
 * large action budget and can out-campaign the 0.75% decay), NPPs replenish at
 * roughly half the rate with a hard per-cycle action cap, so the same decay
 * would otherwise bleed them toward 0. Players keep a floor of 0.
 */
export const NPP_POLITICAL_INFLUENCE_FLOOR = 10;

/**
 * Favorability Above-Threshold Penalty
 * Favorability is stable at or below 60%. When above 60%, a per-turn
 * penalty pulls it back down — the further above 60%, the steeper the drain.
 * Penalty = (favorability − 60) × 0.05 per turn
 * Examples:
 *   60%  → 0 / turn
 *   70%  → −0.5 / turn
 *   80%  → −1.0 / turn
 *   90%  → −1.5 / turn
 *   100% → −2.0 / turn
 */
export function calculateFavorabilityAboveThresholdPenalty(favorability: number): number {
  const THRESHOLD = FAVORABILITY_NATURAL_DECAY_THRESHOLD;
  const clampedFavorability = Math.max(0, Math.min(100, favorability));
  if (clampedFavorability <= THRESHOLD) return 0;
  return (clampedFavorability - THRESHOLD) * 0.05;
}

/** Infamy at or below this value causes no favorability drain. */
export const INFAMY_FAVORABILITY_DRAIN_THRESHOLD = 20;

/**
 * Infamy Favorability Drain
 * Matches the advertised formula on the profile / character pages and the
 * stats wiki: above 20 infamy, favorability drains by
 * (infamy − 20) × 0.05 points per turn.
 * Examples:
 *   20 → 0 / turn
 *   40 → −1.0 / turn
 *   60 → −2.0 / turn
 *   100 → −4.0 / turn
 */
export function calculateInfamyFavorabilityDrain(infamy: number): number {
  const clamped = Math.max(0, Math.min(100, infamy));
  if (clamped <= INFAMY_FAVORABILITY_DRAIN_THRESHOLD) return 0;
  return (clamped - INFAMY_FAVORABILITY_DRAIN_THRESHOLD) * 0.05;
}

/**
 * Political influence decay per turn.
 * Lower than the old 1% slope so high-influence characters can maintain a base
 * without spending nearly their full action budget on upkeep.
 */
export function calculatePoliticalInfluenceDecay(currentInfluence: number): number {
  return Math.max(0, Math.min(100, currentInfluence)) * POLITICAL_INFLUENCE_DECAY_RATE;
}

/**
 * Apply one turn of political-influence decay with a lower barrier at `floor`.
 *
 * The floor is a barrier decay cannot cross, not a value that pulls influence
 * up: decay never drives influence below `floor`, but an entity already sitting
 * under the floor (e.g. a deliberately low-profile shell NPP at 1) is held in
 * place rather than inflated up to it. Players pass the default floor of 0, so
 * `Math.min(current, 0)` is always 0 and their behavior is unchanged. NPPs pass
 * NPP_POLITICAL_INFLUENCE_FLOOR so the player-tuned decay can't bleed a seeded
 * (10) NPP toward 0.
 */
export function applyPoliticalInfluenceDecay(currentInfluence: number, floor = 0): number {
  const decayed = currentInfluence - calculatePoliticalInfluenceDecay(currentInfluence);
  const lowerBound = Math.min(currentInfluence, floor);
  return Math.min(100, Math.max(lowerBound, decayed));
}

/**
 * Passive NPI gain per turn from current state influence.
 * This intentionally remains tied to the old 1% divisor so national reputation
 * growth keeps pace with the established presidential progression.
 */
export function calculateNationalInfluenceGain(currentInfluence: number): number {
  return Math.max(0, Math.min(100, currentInfluence)) / 100;
}

/**
 * Legislation effect delta
 * Returns a small change to apply to a state metric when a policy bill is signed.
 * effectDirection: -1 (decrease), 0 (neutral), +1 (increase)
 * Used by the effect applicator to update StateMetrics.
 */
export function getLegislationEffectDelta(effectDirection: number): number {
  if (effectDirection === 0) return 0;
  const magnitude = 0.5; // Small fixed magnitude per signed bill
  return effectDirection > 0 ? magnitude : -magnitude;
}

// Policy Effect Constants
export const POLICY_TAU = 139; // Time constant for metric decay (turns) - ~96 turn half-life (2 in-game years)
export const REACTION_HALF_LIFE = 12; // Turns until policy reaction is 50%
export const VOTE_IMPACT_HALF_LIFE = 24; // Turns until vote impact is 50%
// Max decay-path points one law can move a metric (before scope multiplier). Kept at
// 12 so STATE/regional laws (scope 1) are unchanged; the #0962 balance pass boosts
// NATIONAL laws instead via a raised, normalized federal multiplier (below).
export const MAX_EFFECT_PER_LAW = 12;

/**
 * Convexity of the intensity→magnitude curve (Bug #0962). gamma < 1 makes the
 * extremes pull away from the mid-ladder so "Maximum" reads distinctly stronger
 * than "Moderate". 1.0 = linear. Tuned in the balance pass.
 */
export const POLICY_INTENSITY_GAMMA = 0.8;

/** Reshape a signed intensity in [-1,1] by POLICY_INTENSITY_GAMMA, preserving sign and 0/±1. */
export function effectiveIntensity(intensity: number): number {
  return Math.sign(intensity) * Math.abs(intensity) ** POLICY_INTENSITY_GAMMA;
}

/**
 * Per-metric magnitude scale (Bug #0962 #1). Policy effect magnitudes are sized for
 * 0-100 index metrics; a large-range metric (educationSpending ~£13k, medianIncome ~£40k,
 * both capped at 10M) needs the effect scaled to its OPERATING value or the change is
 * imperceptible. We deliberately scale by `referenceValue` (the metric's current/baseline
 * value), NOT by the hard min/max bound — the bound is only a sanity cap and is decoupled
 * from the operating range (educationSpending and medianIncome share a 10M cap but operate
 * an order of magnitude apart). So a max law moves a large metric by ~1% of its value.
 *
 * Small-range metrics (`maxValue - minValue <= 100`, i.e. every 0-100 index plus tight
 * ranges like populationGrowth) return 1.0 — byte-identical to the pre-#0962 behavior.
 */
export function metricRangeScale(
  minValue: number,
  maxValue: number,
  referenceValue: number
): number {
  if (maxValue - minValue <= 100) return 1;
  return Math.abs(referenceValue) / 100;
}
export const FEDERAL_MULTIPLIER = 1 / 50; // Federal law effect per state (equal distribution across 50 states)
export const UK_FEDERAL_MULTIPLIER = 1 / 12; // Federal law effect per UK region (equal distribution across 12 regions)
export const JP_FEDERAL_MULTIPLIER = 1 / 8; // Federal law effect per JP region (equal distribution across 8 regions)
export const DE_FEDERAL_MULTIPLIER = 1 / 16; // Federal law effect per German Land (equal distribution across 16 Länder)

/**
 * Per-country override map for federal multipliers. Governs the per-turn TICK path
 * (per-option metricEffects), whose magnitudes are hand-tuned per country against these
 * exact values (e.g. US_BIRTH_RATE / CRIME tick arrays scaled for the 1/50 split), so it
 * stays `1/regionCount`. The DECAY path is normalized separately — see
 * {@link NATIONAL_LAW_DECAY_MULTIPLIER} and {@link nationalDecayScope}.
 */
const FEDERAL_MULTIPLIER_BY_COUNTRY: Record<string, number> = {
  UK: UK_FEDERAL_MULTIPLIER,
  JP: JP_FEDERAL_MULTIPLIER,
  DE: DE_FEDERAL_MULTIPLIER,
};

/**
 * Returns the tick-path federal multiplier for the given country (defaults to 1/50).
 */
export function getFederalMultiplier(countryId: string): number {
  return FEDERAL_MULTIPLIER_BY_COUNTRY[countryId] ?? FEDERAL_MULTIPLIER;
}

/**
 * Normalized per-region scope for a NATIONAL law's DECAY-path metric effect (#0962
 * balance pass). Because every region gets this share and the national metric is the
 * (pop-weighted) AVERAGE of its regions, the national-metric movement equals
 * `MAX_EFFECT_PER_LAW × NATIONAL_LAW_DECAY_MULTIPLIER` — INDEPENDENT of region count. So
 * a strong national law moves its primary decay-driven metric ~4.5%/decade whether the
 * country has 12 regions or 50 (US federal laws were ~4× weaker before). Calibrated
 * against the balance simulation (educationSpending, medianIncome ≈ 4.4%). Applied ONLY
 * to the decay path — the tick path keeps its per-country {@link getFederalMultiplier}.
 */
export const NATIONAL_LAW_DECAY_MULTIPLIER = 0.21;

/**
 * The scope a policy's DECAY contribution should use: state/regional laws (scope 1) keep
 * their full strength; national laws (any diluted `1/regionCount` scope < 1) are replaced
 * by the normalized {@link NATIONAL_LAW_DECAY_MULTIPLIER} so national strength is uniform.
 */
export function nationalDecayScope(scopeMultiplier: number): number {
  return scopeMultiplier < 1 ? NATIONAL_LAW_DECAY_MULTIPLIER : scopeMultiplier;
}

/**
 * Calculate exponential decay factor for policy effects
 * Returns the fraction of remaining distance to move each turn
 */
export function getPolicyDecayFactor(tau: number = POLICY_TAU): number {
  return 1 - Math.exp(-1 / tau);
}

/**
 * Apply exponential decay toward target value
 */
export function applyPolicyDecay(
  current: number,
  target: number,
  tau: number = POLICY_TAU
): number {
  const decayFactor = getPolicyDecayFactor(tau);
  return current + (target - current) * decayFactor;
}

/**
 * Calculate half-life decay for reactions/vote impacts
 */
export function applyHalfLifeDecay(initial: number, turnsSince: number, halfLife: number): number {
  return initial * Math.pow(0.5, turnsSince / halfLife);
}

/**
 * Calculate policy contribution to a metric
 */
export function calculatePolicyContribution(
  policyStrength: number, // -3 to +3
  weight: number, // 0.0 to 1.0
  scopeMultiplier: number, // 1.0 for state, FEDERAL_MULTIPLIER for federal
  isHigherBetter: boolean
): number {
  const normalizedStrength = policyStrength / 3; // -1 to +1
  const effectSign = isHigherBetter ? 1 : -1;
  return normalizedStrength * weight * MAX_EFFECT_PER_LAW * scopeMultiplier * effectSign;
}
