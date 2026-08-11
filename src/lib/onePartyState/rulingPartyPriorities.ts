/**
 * Ruling-Party Priority Axes and Policy Alignment Model
 *
 * Defines the ruling-party's internal priority profile and provides helpers
 * to compute policy alignment scores from enacted laws. Country-agnostic —
 * each country with `governmentType: "onePartyState"` supplies its own
 * profile via `CountryConfig.priorityProfile` and policy-axis map via
 * `CountryConfig.policyAxisEffects`.
 */

import type { CountryId } from "@/lib/constants/countries";

// ── Types ──────────────────────────────────────────────────────────────────

/** A single ruling-party priority axis with a weight (0–1) and description. */
export interface RulingPartyPriorityAxis {
  id: string;
  name: string;
  weight: number; // 0–1, higher = more important to the ruling party
  description: string;
}

/** The full ruling-party priority profile for a given era/leader. */
export interface RulingPartyPriorityProfile {
  countryId: CountryId;
  axes: RulingPartyPriorityAxis[];
  version: number; // bump when priorities change between eras
}

/** How a policy category affects a priority axis. */
export interface PolicyAxisEffect {
  axisId: string;
  delta: number; // -100 to +100
}

/** Scored result for a single enacted law. */
export interface PolicyAlignmentResult {
  score: number; // -100 to +100
  matchingAxes: { axisId: string; axisName: string; delta: number }[];
  conflictingAxes: { axisId: string; axisName: string; delta: number }[];
}

// ── Default CN Priority Profile (Modern Era) ───────────────────────────────

export const DEFAULT_CN_PRIORITY_PROFILE: RulingPartyPriorityProfile = {
  countryId: "CN",
  version: 1,
  axes: [
    {
      id: "party_control",
      name: "Party Control",
      weight: 0.2,
      description: "Maintaining CPC dominance over state and society",
    },
    {
      id: "social_stability",
      name: "Social Stability",
      weight: 0.15,
      description: "Preventing unrest and maintaining order",
    },
    {
      id: "state_sector",
      name: "State-Sector Strength",
      weight: 0.12,
      description: "SOE dominance in strategic industries",
    },
    {
      id: "industrial_policy",
      name: "Industrial Policy",
      weight: 0.12,
      description: "Directed investment in key sectors",
    },
    {
      id: "economic_growth",
      name: "Economic Growth",
      weight: 0.15,
      description: "GDP growth and development targets",
    },
    {
      id: "national_security",
      name: "National Security",
      weight: 0.12,
      description: "Military, intelligence, and territorial integrity",
    },
    {
      id: "regional_balance",
      name: "Regional Balance",
      weight: 0.07,
      description: "Reducing coastal-inland inequality",
    },
    {
      id: "market_openness",
      name: "Managed Market Openness",
      weight: 0.04,
      description: "Controlled foreign investment and trade",
    },
    {
      id: "anti_corruption",
      name: "Anti-Corruption Legitimacy",
      weight: 0.03,
      description: "Public perception of CPC discipline",
    },
  ],
};

/** Verify axis weights sum to approximately 1.0. */
export function validatePriorityProfile(profile: RulingPartyPriorityProfile): boolean {
  const sum = profile.axes.reduce((acc, a) => acc + a.weight, 0);
  return Math.abs(sum - 1.0) < 0.001;
}

// ── Policy-to-Axis Mapping (simplified category-based) ──────────────────────

/**
 * Maps broad policy categories to ruling-party priority axis effects.
 * Used as a fallback / seed mapping — per-country overrides live on
 * `CountryConfig.policyAxisEffects`.
 */
export const DEFAULT_POLICY_AXIS_EFFECTS: Record<string, PolicyAxisEffect[]> = {
  "market-liberalization": [
    { axisId: "state_sector", delta: -40 },
    { axisId: "party_control", delta: -20 },
    { axisId: "economic_growth", delta: +30 },
    { axisId: "market_openness", delta: +25 },
  ],
  privatization: [
    { axisId: "state_sector", delta: -50 },
    { axisId: "party_control", delta: -15 },
    { axisId: "economic_growth", delta: +20 },
    { axisId: "anti_corruption", delta: +10 },
  ],
  "industrial-investment": [
    { axisId: "industrial_policy", delta: +45 },
    { axisId: "state_sector", delta: +25 },
    { axisId: "economic_growth", delta: +20 },
    { axisId: "regional_balance", delta: +15 },
  ],
  infrastructure: [
    { axisId: "industrial_policy", delta: +30 },
    { axisId: "economic_growth", delta: +25 },
    { axisId: "regional_balance", delta: +35 },
    { axisId: "social_stability", delta: +10 },
  ],
  "security-expansion": [
    { axisId: "national_security", delta: +40 },
    { axisId: "party_control", delta: +15 },
    { axisId: "economic_growth", delta: -10 },
  ],
  "social-welfare": [
    { axisId: "social_stability", delta: +25 },
    { axisId: "regional_balance", delta: +20 },
    { axisId: "economic_growth", delta: -10 },
    { axisId: "anti_corruption", delta: +10 },
  ],
  "anti-corruption": [
    { axisId: "anti_corruption", delta: +50 },
    { axisId: "party_control", delta: +20 },
    { axisId: "social_stability", delta: +10 },
  ],
  censorship: [
    { axisId: "party_control", delta: +30 },
    { axisId: "social_stability", delta: +15 },
    { axisId: "market_openness", delta: -20 },
  ],
  "trade-protection": [
    { axisId: "state_sector", delta: +20 },
    { axisId: "market_openness", delta: -30 },
    { axisId: "economic_growth", delta: -10 },
    { axisId: "national_security", delta: +15 },
  ],
  "foreign-engagement": [
    { axisId: "national_security", delta: +10 },
    { axisId: "market_openness", delta: +25 },
    { axisId: "economic_growth", delta: +15 },
  ],
  "labor-rights": [
    { axisId: "social_stability", delta: +20 },
    { axisId: "party_control", delta: -15 },
    { axisId: "economic_growth", delta: -10 },
  ],
  default: [],
};

/**
 * Compute a policy alignment score for a given policy category.
 * Returns a score from -100 to +100 based on the ruling-party priority axes.
 *
 * `profile` and `axisEffects` default to the CN-shaped seed constants for
 * backward compatibility with tests. Production callers should pass
 * `CountryConfig.priorityProfile` and `CountryConfig.policyAxisEffects`.
 */
export function computePolicyAlignment(
  policyCategory: string,
  profile: RulingPartyPriorityProfile = DEFAULT_CN_PRIORITY_PROFILE,
  axisEffects: Record<string, PolicyAxisEffect[]> = DEFAULT_POLICY_AXIS_EFFECTS
): PolicyAlignmentResult {
  const effects = axisEffects[policyCategory] ?? axisEffects["default"] ?? [];
  if (effects.length === 0) {
    return { score: 0, matchingAxes: [], conflictingAxes: [] };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  const matchingAxes: PolicyAlignmentResult["matchingAxes"] = [];
  const conflictingAxes: PolicyAlignmentResult["conflictingAxes"] = [];

  for (const effect of effects) {
    const axis = profile.axes.find((a) => a.id === effect.axisId);
    if (!axis) continue;
    const contribution = effect.delta * axis.weight;
    weightedSum += contribution;
    totalWeight += Math.abs(axis.weight);

    if (effect.delta > 0) {
      matchingAxes.push({ axisId: axis.id, axisName: axis.name, delta: effect.delta });
    } else if (effect.delta < 0) {
      conflictingAxes.push({ axisId: axis.id, axisName: axis.name, delta: effect.delta });
    }
  }

  // Normalize to -100..100 scale
  const score = totalWeight > 0 ? Math.round((weightedSum / (totalWeight * 50)) * 100) : 0;
  const clamped = Math.max(-100, Math.min(100, score));

  return { score: clamped, matchingAxes, conflictingAxes };
}

/**
 * Convert an alignment score to a per-turn confidence delta.
 *
 * Score ranges:
 *   >= 40  → +1
 *   10–39  → +0.25 (if fractional) or 0 (if integer-only)
 *   -9–9   → 0
 *   -10–-39 → -1
 *   <= -40 → -2 to -4 based on severity
 */
export function scoreToTurnDelta(score: number, allowFractional = false): number {
  if (score >= 40) return 1;
  if (score >= 10) return allowFractional ? 0.25 : 0;
  if (score >= -9) return 0;
  if (score >= -39) return -1;
  // <= -40
  return Math.max(-4, Math.round(score / 20));
}

// ── Turn-drift batch computation ───────────────────────────────────────────

/** Input for computing turn drift from multiple policies. */
export interface TurnDriftInput {
  policyCategories: string[];
  activePurgeEvents: PurgeEvent[];
  /**
   * Current popularLegitimacy of the country's leader. When provided,
   * a one-way coupling bleed contributes a small per-turn drag to
   * partyConfidence during popular collapses (Phase 3 coupling).
   * Undefined → no contribution (matches pre-Phase-3 behaviour).
   */
  popularLegitimacy?: number;
}

/** Output of turn drift computation. */
export interface TurnDriftResult {
  policyDelta: number;
  purgeDelta: number;
  /** Per-turn drag from the popular→party coupling bleed (≤ 0). */
  popularBleedDelta: number;
  totalDelta: number;
  details: {
    policies: { category: string; score: number; delta: number }[];
    purges: { severity: PurgeSeverity; delta: number; reason: string }[];
  };
}

/**
 * One-way coupling from popularLegitimacy into partyConfidence drift.
 * Models the panic that sets in when the country can see the regime
 * fighting itself reflected on the street. The reverse direction
 * (party → popular) is wired separately as `intraPartyCouplingBleed`
 * in `popularLegitimacyDrivers.ts`.
 *
 * Returns 0 when popular ≥ 30, -0.25 in [15, 30), -0.5 below 15.
 *
 * Halved from -0.5/-1.0 (#3165): partyConfidence has no natural recovery
 * drift, so this bleed alone ground CN's confidence 37.5 → 0 at a clean
 * -1/turn while every other component was 0. At the halved rates the
 * popular scalar (which does recover, at +0.1/turn net of the reduced
 * reverse bleed) can climb back above 30 and shut this bleed off before
 * confidence is fully exhausted.
 */
export function popularLegitimacyBleedIntoParty(popularLegitimacy: number): number {
  if (popularLegitimacy >= 30) return 0;
  if (popularLegitimacy >= 15) return -0.25;
  return -0.5;
}

// ── Purge Event Types ──────────────────────────────────────────────────────

export type PurgeSeverity = "minor" | "regional" | "senior" | "faction" | "extreme";

export interface PurgeEvent {
  _id?: string; // optional for pre-persistence
  countryId: CountryId;
  severity: PurgeSeverity;
  reason: string;
  targetCount?: number;
  /** Turn when the purge was issued */
  turn: number;
  /** Has this purge been processed for confidence effects? */
  processed: boolean;
  createdAt: Date;
}

export const PURGE_SEVERITY_DELTA: Record<PurgeSeverity, number> = {
  minor: -2,
  regional: -4,
  senior: -7,
  faction: -10,
  extreme: -15,
};

/**
 * Compute the total turn drift from policies and unprocessed purges.
 *
 * `profile` and `axisEffects` default to the CN-shaped seed constants for
 * backward compatibility. Production callers pass per-country values from
 * `CountryConfig.priorityProfile` / `CountryConfig.policyAxisEffects`.
 */
export function computeTurnDrift(
  input: TurnDriftInput,
  profile: RulingPartyPriorityProfile = DEFAULT_CN_PRIORITY_PROFILE,
  axisEffects: Record<string, PolicyAxisEffect[]> = DEFAULT_POLICY_AXIS_EFFECTS
): TurnDriftResult {
  const policyResults = input.policyCategories.map((category) => {
    const alignment = computePolicyAlignment(category, profile, axisEffects);
    const delta = scoreToTurnDelta(alignment.score);
    return { category, score: alignment.score, delta };
  });

  const purgeResults = input.activePurgeEvents
    .filter((p) => !p.processed)
    .map((p) => ({
      severity: p.severity,
      delta: PURGE_SEVERITY_DELTA[p.severity],
      reason: p.reason,
    }));

  const policyDelta = policyResults.reduce((sum, p) => sum + p.delta, 0);
  const purgeDelta = purgeResults.reduce((sum, p) => sum + p.delta, 0);
  const popularBleedDelta =
    input.popularLegitimacy !== undefined
      ? popularLegitimacyBleedIntoParty(input.popularLegitimacy)
      : 0;

  return {
    policyDelta,
    purgeDelta,
    popularBleedDelta,
    totalDelta: policyDelta + purgeDelta + popularBleedDelta,
    details: {
      policies: policyResults,
      purges: purgeResults,
    },
  };
}

// ── Low-confidence consequences ────────────────────────────────────────────

export type ConfidenceConsequenceLevel =
  "none" | "discipline_loss" | "challenge_risk" | "appointment_resistance" | "forced_crisis";

export function getConfidenceConsequenceLevel(confidence: number): ConfidenceConsequenceLevel {
  if (confidence < 15) return "forced_crisis";
  if (confidence < 25) return "appointment_resistance";
  if (confidence < 35) return "challenge_risk";
  if (confidence < 50) return "discipline_loss";
  return "none";
}

/** Description of what each consequence level means for gameplay. */
export const CONFIDENCE_CONSEQUENCE_DESCRIPTIONS: Record<ConfidenceConsequenceLevel, string> = {
  none: "No special consequences. Leadership is stable.",
  discipline_loss: "NPC/CPC auto-vote discipline is reduced. Delegates may abstain or dissent.",
  challenge_risk: "Chance of internal challenge events. Factional resistance increases.",
  appointment_resistance:
    "Cabinet appointments face delay or resistance. Confirmation votes are harder.",
  forced_crisis: "Forced leadership crisis path becomes eligible. Immediate transition risk.",
};
