/**
 * Approval Modifiers — Democracy 3-style named conditions that add or subtract
 * from the base approval score when a set of metric thresholds are all met.
 * Modifiers stack: multiple active conditions sum their effects.
 *
 * evaluateModifiers() accepts a flat category→metric→value map so it works on
 * both individual state metrics and pre-computed national averages.
 *
 * Design principles:
 * - Labels name the metric STATE, not the political consequence.
 * - Single-condition modifiers fire easily; multi-condition ones are stronger.
 * - Effects are deliberately small (max ±2) so approval is driven primarily by
 *   the metric base score, with conditions providing modest colour.
 * - Thresholds are calibrated so both US and UK realistic averages can trigger
 *   conditions — neither country is stuck at 50%.
 * - High immigration (migrationRate) is modelled as a net negative.
 */

import { getEraConditionShift, isMetricActive } from "@/lib/era/metricCatalog";
import { marginEffectForModifier } from "@/lib/states/conditions/marginEffects";
import { resolveModifierDef } from "@/lib/states/conditions/resolveModifierDef";

export interface Condition {
  category: string;
  metric: string;
  op: ">=" | "<=" | ">" | "<";
  value: number;
}

interface ModifierDef {
  id: string;
  label: string;
  effect: number; // positive = boost, negative = malus
  conditions: Condition[]; // all must be true (AND)
}

export interface ActiveModifier {
  id: string;
  label: string;
  effect: number;
  /** Stacked profit-margin swing in percentage points (capped at turn time). */
  marginEffect?: number;
  /** Where the modifier originated — metric thresholds or a governor address. */
  source?: "metric" | "address";
}

export interface EvaluateModifiersOptions {
  /** Game seed preset (`2019-default`, `1991-default`, …). */
  preset?: string | null;
  /** Region country for per-country threshold patches (US, UK, …). */
  countryId?: string | null;
  /**
   * Live in-game year. When set (era system on), conditions on curved metrics
   * translate by the band curve's midpoint movement (getEraConditionShift) and
   * conditions on metrics outside their era window never fire.
   * Absent/null → legacy behavior, byte-identical to before.
   */
  year?: number | null;
}

const HEADLINE_MODIFIER_CAP = 8;
/**
 * Net-positive approval from named modifiers is capped so seed-day badge stacks
 * (right-lane freefires + cheap-housing + low-crime clusters) cannot push every
 * region into the high-60s before any player action. Negatives remain uncapped
 * so crises still compound. Headline UI cap above is display-only and unrelated.
 */
export const POSITIVE_MODIFIER_NET_CAP = 8;

const MODIFIER_DEFS: ModifierDef[] = [
  // ── Positive ───────────────────────────────────────────────────────────────
  {
    id: "economic_boom",
    label: "Economic Boom",
    effect: 2,
    conditions: [
      { category: "economic", metric: "gdpGrowth", op: ">=", value: 3.0 },
      { category: "economic", metric: "unemploymentRate", op: "<=", value: 4.5 },
    ],
  },
  {
    id: "low_unemployment",
    label: "Low Unemployment",
    effect: 1,
    conditions: [{ category: "economic", metric: "unemploymentRate", op: "<=", value: 3.5 }],
  },
  {
    id: "low_poverty",
    label: "Low Poverty Rate",
    effect: 1,
    conditions: [{ category: "economic", metric: "povertyRate", op: "<=", value: 8 }],
  },
  {
    id: "affordable_living",
    label: "Affordable Cost of Living",
    effect: 1,
    conditions: [{ category: "economic", metric: "costOfLiving", op: "<=", value: 90 }],
  },
  {
    id: "strong_growth",
    label: "Strong Economic Growth",
    effect: 1,
    conditions: [{ category: "economic", metric: "gdpGrowth", op: ">=", value: 2.5 }],
  },
  {
    id: "healthcare_excellence",
    label: "Healthcare Excellence",
    effect: 2,
    conditions: [
      { category: "healthcare", metric: "lifeExpectancy", op: ">=", value: 83 },
      { category: "healthcare", metric: "affordabilityIndex", op: ">=", value: 78 },
    ],
  },
  {
    id: "universal_healthcare",
    label: "Universal Healthcare Access",
    effect: 2,
    conditions: [
      { category: "healthcare", metric: "uninsuredRate", op: "<=", value: 5 },
      { category: "healthcare", metric: "physicianRate", op: ">=", value: 2.5 },
    ],
  },
  {
    id: "high_life_expectancy",
    label: "High Life Expectancy",
    effect: 1,
    conditions: [{ category: "healthcare", metric: "lifeExpectancy", op: ">=", value: 82 }],
  },
  {
    id: "safe_streets",
    label: "Low Crime Rate",
    effect: 2,
    conditions: [
      { category: "publicSafety", metric: "violentCrimeRate", op: "<=", value: 320 },
      { category: "publicSafety", metric: "publicSafetyConfidence", op: ">=", value: 70 },
    ],
  },
  {
    id: "falling_crime",
    label: "Falling Crime",
    effect: 1,
    conditions: [{ category: "publicSafety", metric: "violentCrimeRate", op: "<=", value: 300 }],
  },
  {
    id: "low_recidivism",
    label: "Low Reoffending Rate",
    effect: 1,
    conditions: [{ category: "publicSafety", metric: "recidivismRate", op: "<=", value: 30 }],
  },
  {
    id: "clean_environment",
    label: "Clean Environment",
    effect: 2,
    conditions: [
      { category: "environment", metric: "renewableEnergy", op: ">=", value: 50 },
      { category: "environment", metric: "airQuality", op: "<=", value: 25 },
    ],
  },
  {
    id: "green_transition",
    label: "Green Energy Transition",
    effect: 1,
    conditions: [{ category: "environment", metric: "renewableEnergy", op: ">=", value: 40 }],
  },
  {
    id: "good_recycling",
    label: "Strong Recycling Culture",
    effect: 1,
    conditions: [{ category: "environment", metric: "recyclingRate", op: ">=", value: 45 }],
  },
  {
    id: "good_governance",
    label: "High Government Transparency",
    effect: 2,
    conditions: [
      { category: "governance", metric: "governmentTransparency", op: ">=", value: 78 },
      { category: "governance", metric: "publicTrust", op: ">=", value: 62 },
    ],
  },
  {
    id: "high_public_trust",
    label: "High Public Trust",
    effect: 1,
    conditions: [{ category: "governance", metric: "publicTrust", op: ">=", value: 68 }],
  },
  {
    id: "high_voter_turnout",
    label: "High Voter Turnout",
    effect: 1,
    conditions: [{ category: "governance", metric: "voterTurnout", op: ">=", value: 72 }],
  },
  {
    id: "balanced_budget",
    label: "Balanced Budget",
    effect: 1,
    conditions: [{ category: "governance", metric: "budgetBalance", op: ">=", value: 0.5 }],
  },
  {
    id: "educated_workforce",
    label: "Skilled Workforce",
    effect: 1,
    conditions: [
      { category: "education", metric: "highSchoolGradRate", op: ">=", value: 88 },
      { category: "education", metric: "workforceSkill", op: ">=", value: 68 },
    ],
  },
  {
    id: "education_excellence",
    label: "Education Excellence",
    effect: 2,
    conditions: [
      { category: "education", metric: "highSchoolGradRate", op: ">=", value: 92 },
      { category: "education", metric: "testPerformance", op: ">=", value: 115 },
      { category: "education", metric: "literacyRate", op: ">=", value: 97 },
    ],
  },
  {
    id: "social_cohesion",
    label: "Strong Social Cohesion",
    effect: 1,
    conditions: [
      { category: "social", metric: "socialCohesion", op: ">=", value: 68 },
      { category: "social", metric: "civicParticipation", op: ">=", value: 62 },
    ],
  },
  {
    id: "strong_safety_net",
    label: "Strong Safety Net",
    effect: 2,
    conditions: [
      { category: "social", metric: "foodInsecurity", op: "<=", value: 7 },
      { category: "social", metric: "homelessnessRate", op: "<=", value: 8 },
    ],
  },
  {
    id: "high_social_mobility",
    label: "High Social Mobility",
    effect: 1,
    conditions: [{ category: "social", metric: "socialMobility", op: ">=", value: 78 }],
  },
  {
    id: "infrastructure_boom",
    label: "Modern Infrastructure",
    effect: 2,
    conditions: [
      { category: "infrastructure", metric: "roadCondition", op: ">=", value: 80 },
      { category: "infrastructure", metric: "broadbandAccess", op: ">=", value: 90 },
      { category: "infrastructure", metric: "waterQuality", op: ">=", value: 95 },
    ],
  },
  {
    id: "high_broadband",
    label: "High Broadband Access",
    effect: 1,
    conditions: [{ category: "infrastructure", metric: "broadbandAccess", op: ">=", value: 90 }],
  },
  {
    id: "clean_water",
    label: "Clean Water Supply",
    effect: 1,
    conditions: [{ category: "infrastructure", metric: "waterQuality", op: ">=", value: 96 }],
  },
  {
    id: "civic_flourishing",
    label: "High Civic Participation",
    effect: 1,
    conditions: [
      { category: "governance", metric: "voterTurnout", op: ">=", value: 75 },
      { category: "social", metric: "civicParticipation", op: ">=", value: 68 },
    ],
  },
  {
    id: "innovation_economy",
    label: "Innovation Economy",
    effect: 2,
    conditions: [
      { category: "economic", metric: "smallBusinessFormation", op: ">=", value: 6 },
      { category: "education", metric: "workforceSkill", op: ">=", value: 75 },
    ],
  },
  {
    id: "free_press",
    label: "Free Press",
    effect: 1,
    conditions: [{ category: "mediaInformation", metric: "pressFreedom", op: ">=", value: 79 }],
  },
  {
    id: "informed_society",
    label: "High News Trust",
    effect: 1,
    conditions: [
      { category: "mediaInformation", metric: "newsTrust", op: ">=", value: 65 },
      { category: "mediaInformation", metric: "mediaPolarization", op: "<=", value: 28 },
    ],
  },
  {
    id: "longevity",
    label: "Healthy Longevity",
    effect: 1,
    conditions: [
      { category: "healthcare", metric: "lifeExpectancy", op: ">=", value: 82 },
      { category: "healthcare", metric: "preventableMortality", op: "<=", value: 280 },
    ],
  },
  {
    id: "affordable_housing",
    label: "Affordable Housing",
    effect: 1,
    // Tightened from 42: 1953/early-era seeds sit in the teens–20s and freefired
    // universally. 28 still rewards genuinely cheap housing vs modern 50–90 norms.
    conditions: [{ category: "social", metric: "housingAffordability", op: "<=", value: 28 }],
  },
  {
    id: "research_hub",
    label: "Research & Development Hub",
    effect: 1,
    conditions: [{ category: "economic", metric: "rdIntensity", op: ">=", value: 3.2 }],
  },

  // ── Right-coded positive badges (Phase B: bias symmetry) ────────────────────
  //
  // Badge symmetry requirement: every left-coded positive badge must have either
  // a right-coded mirror or a documented exemption. This block redresses the
  // historical asymmetry where left-coded concepts (universal healthcare, safety
  // net, green transition, civic participation, social cohesion) had dedicated
  // badges while right-coded concepts (economic freedom, defense, national
  // confidence, fiscal discipline) did not.
  //
  // Left-coded positive badge      → Right-coded mirror / exemption
  // ──────────────────────────────── ───────────────────────────────────────
  // universal_healthcare           → EXEMPTION: healthcare access is universally
  //                                   valued across the political spectrum; the
  //                                   right-coded counter (market-based choice)
  //                                   is not modelled as a distinct badge.
  // strong_safety_net             → EXEMPTION: food security / low homelessness
  //                                   are baseline welfare, not ideologically
  //                                   exclusive to the left.
  // green_transition / clean_env  → EXEMPTION: environmental quality is a
  //                                   cross-spectrum good; right-coded
  //                                   deregulatory stance is captured indirectly
  //                                   via economic_freedom (low regulatoryBurden).
  // social_cohesion                → national_confidence (national pride mirror)
  // civic_flourishing              → EXEMPTION: civic participation overlaps
  //                                   with voter-turnout and high_public_trust;
  //                                   no right-coded counter beyond governance
  //                                   transparency badges.
  // balanced_budget               → fiscal_discipline (tighter fiscal threshold)
  //
  // Right-coded badges added below:
  //   economic_freedom     ← mirror of strong_growth / innovation_economy cluster
  //   strong_defense       ← mirror of safe_streets (internal ↔ external security)
  //   national_confidence  ← mirror of social_cohesion
  //   fiscal_discipline    ← mirror of balanced_budget (stricter conditions)
  {
    id: "economic_freedom",
    label: "Economic Freedom",
    effect: 1,
    // Raised above 1953 US seed (72/38) so the badge is earned, not gifted.
    conditions: [
      { category: "economic", metric: "economicFreedom", op: ">=", value: 75 },
      { category: "economic", metric: "regulatoryBurden", op: "<", value: 35 },
    ],
  },
  {
    id: "strong_defense",
    label: "Strong Defense",
    effect: 1,
    // Raised above 1953 US seed (90/82) — Korean War readiness still high after
    // the seed retarget, but not enough to clear both gates at day one.
    conditions: [
      { category: "governance", metric: "militaryReadiness", op: ">=", value: 88 },
      { category: "governance", metric: "nationalPride", op: ">=", value: 85 },
    ],
  },
  {
    id: "national_confidence",
    label: "National Confidence",
    effect: 1,
    // Was ≥82 with seed exactly 82 (100% freefire). Now requires a lift.
    conditions: [{ category: "governance", metric: "nationalPride", op: ">=", value: 86 }],
  },
  {
    id: "fiscal_discipline",
    label: "Fiscal Discipline",
    effect: 1,
    conditions: [
      { category: "governance", metric: "budgetBalance", op: ">=", value: 1 },
      { category: "governance", metric: "debtToGdp", op: "<=", value: 90 },
    ],
  },
  // Right-lane axis-metric badges. Thresholds sit above untouched 2019 national
  // averages but within one full-strength law swing of high-seed regions
  // (#2898): borderSecurity SOUTH ~58 + enforcement ~+5 ⇒ 63; firearmRights
  // SOUTH ~82 + state gun law ~+12 ⇒ ~94 (threshold 88).
  {
    id: "secure_border",
    label: "Secure Border",
    effect: 1,
    conditions: [{ category: "governance", metric: "borderSecurity", op: ">=", value: 62 }],
  },
  {
    id: "broad_firearm_rights",
    label: "Broad Firearm Rights",
    effect: 1,
    // Raised from 76 so 1953 national (retargeted to 85) and 1991 SOUTH (84) do
    // not freefire; still reachable via a full-strength deregulatory swing.
    conditions: [{ category: "publicSafety", metric: "firearmRights", op: ">=", value: 88 }],
  },

  // ── Negative ───────────────────────────────────────────────────────────────
  {
    id: "recession",
    label: "Recession",
    effect: -3,
    conditions: [
      { category: "economic", metric: "gdpGrowth", op: "<=", value: 0 },
      { category: "economic", metric: "unemploymentRate", op: ">=", value: 7 },
    ],
  },
  {
    id: "high_unemployment",
    label: "High Unemployment",
    effect: -2,
    conditions: [{ category: "economic", metric: "unemploymentRate", op: ">=", value: 8 }],
  },
  {
    id: "slow_growth",
    label: "Stagnant Economy",
    effect: -1,
    conditions: [{ category: "economic", metric: "gdpGrowth", op: "<=", value: 1.0 }],
  },
  {
    id: "cost_of_living_crisis",
    label: "Cost of Living Crisis",
    effect: -2,
    conditions: [
      { category: "economic", metric: "costOfLiving", op: ">=", value: 140 },
      { category: "economic", metric: "povertyRate", op: ">=", value: 17 },
    ],
  },
  {
    id: "high_poverty",
    label: "High Poverty Rate",
    effect: -1,
    conditions: [{ category: "economic", metric: "povertyRate", op: ">=", value: 15 }],
  },
  {
    id: "high_immigration",
    label: "High Immigration Pressure",
    effect: -1,
    conditions: [{ category: "population", metric: "migrationRate", op: ">=", value: 1.5 }],
  },
  {
    id: "aging_population",
    label: "Aging Population",
    effect: -1,
    conditions: [{ category: "population", metric: "medianAge", op: ">=", value: 42 }],
  },
  {
    id: "declining_population",
    label: "Population Decline",
    effect: -1,
    conditions: [
      { category: "population", metric: "populationGrowth", op: "<=", value: 0 },
      { category: "population", metric: "migrationRate", op: "<=", value: 0 },
    ],
  },
  {
    id: "healthcare_crisis",
    label: "Healthcare System Strain",
    effect: -2,
    conditions: [
      { category: "healthcare", metric: "affordabilityIndex", op: "<=", value: 48 },
      { category: "healthcare", metric: "preventableMortality", op: ">=", value: 350 },
    ],
  },
  {
    id: "low_life_expectancy",
    label: "Low Life Expectancy",
    effect: -2,
    conditions: [{ category: "healthcare", metric: "lifeExpectancy", op: "<=", value: 76 }],
  },
  {
    id: "high_preventable_mortality",
    label: "High Preventable Mortality",
    effect: -1,
    conditions: [{ category: "healthcare", metric: "preventableMortality", op: ">=", value: 350 }],
  },
  {
    id: "weak_healthcare_capacity",
    label: "Weak Healthcare Capacity",
    effect: -1,
    conditions: [
      { category: "healthcare", metric: "physicianRate", op: "<=", value: 2.0 },
      { category: "healthcare", metric: "affordabilityIndex", op: "<=", value: 55 },
    ],
  },
  {
    id: "crime_wave",
    label: "High Crime Rate",
    effect: -2,
    conditions: [
      { category: "publicSafety", metric: "violentCrimeRate", op: ">=", value: 420 },
      { category: "publicSafety", metric: "publicSafetyConfidence", op: "<=", value: 55 },
    ],
  },
  {
    id: "high_violent_crime",
    label: "High Violent Crime",
    effect: -1,
    conditions: [{ category: "publicSafety", metric: "violentCrimeRate", op: ">=", value: 450 }],
  },
  {
    id: "high_incarceration",
    label: "High Incarceration Rate",
    effect: -1,
    conditions: [
      { category: "publicSafety", metric: "incarcerationRate", op: ">=", value: 850 },
      { category: "publicSafety", metric: "recidivismRate", op: ">=", value: 55 },
    ],
  },
  {
    id: "environmental_degradation",
    label: "Environmental Degradation",
    effect: -2,
    conditions: [
      { category: "environment", metric: "airQuality", op: ">=", value: 48 },
      { category: "environment", metric: "carbonEmissions", op: ">=", value: 18 },
    ],
  },
  {
    id: "poor_air_quality",
    label: "Poor Air Quality",
    effect: -1,
    conditions: [{ category: "environment", metric: "airQuality", op: ">=", value: 47 }],
  },
  {
    id: "high_carbon",
    label: "High Carbon Footprint",
    effect: -1,
    conditions: [{ category: "environment", metric: "carbonEmissions", op: ">=", value: 17 }],
  },
  {
    id: "slow_energy_transition",
    label: "Slow Energy Transition",
    effect: -1,
    conditions: [
      { category: "environment", metric: "energyTransitionProgress", op: "<=", value: 18 },
      { category: "environment", metric: "renewableEnergy", op: "<=", value: 15 },
    ],
  },
  {
    id: "high_corruption",
    label: "High Corruption",
    effect: -3,
    conditions: [
      { category: "governance", metric: "corruptionIndex", op: ">=", value: 58 },
      { category: "governance", metric: "publicTrust", op: "<=", value: 35 },
    ],
  },
  {
    id: "corruption_concerns",
    label: "Corruption Concerns",
    effect: -1,
    conditions: [{ category: "governance", metric: "corruptionIndex", op: ">=", value: 54 }],
  },
  {
    id: "low_public_trust",
    label: "Low Public Trust",
    effect: -1,
    conditions: [{ category: "governance", metric: "publicTrust", op: "<=", value: 42 }],
  },
  {
    id: "government_deficit",
    label: "Government Deficit",
    effect: -1,
    conditions: [{ category: "governance", metric: "budgetBalance", op: "<=", value: -2.0 }],
  },
  {
    id: "fiscal_crisis",
    label: "Fiscal Crisis",
    effect: -2,
    conditions: [{ category: "governance", metric: "budgetBalance", op: "<=", value: -5.0 }],
  },
  {
    id: "inequality_crisis",
    label: "Extreme Income Inequality",
    effect: -2,
    conditions: [
      { category: "social", metric: "incomeInequality", op: ">=", value: 46 },
      { category: "social", metric: "homelessnessRate", op: ">=", value: 22 },
    ],
  },
  {
    id: "income_inequality",
    label: "Rising Inequality",
    effect: -1,
    // Gini INDEX scale (P3a unit unification — was the 0.42 fraction).
    conditions: [{ category: "social", metric: "incomeInequality", op: ">=", value: 44 }],
  },
  {
    id: "homelessness_crisis",
    label: "High Homelessness",
    effect: -1,
    conditions: [{ category: "social", metric: "homelessnessRate", op: ">=", value: 20 }],
  },
  {
    id: "social_breakdown",
    label: "Social Fragmentation",
    effect: -2,
    conditions: [
      { category: "social", metric: "foodInsecurity", op: ">=", value: 16 },
      { category: "social", metric: "socialCohesion", op: "<=", value: 45 },
    ],
  },
  {
    id: "food_insecurity",
    label: "Food Insecurity",
    effect: -1,
    conditions: [{ category: "social", metric: "foodInsecurity", op: ">=", value: 14 }],
  },
  {
    id: "housing_stress",
    label: "Housing Stress",
    effect: -1,
    conditions: [{ category: "social", metric: "housingAffordability", op: ">=", value: 65 }],
  },
  {
    id: "low_social_mobility",
    label: "Low Social Mobility",
    effect: -1,
    conditions: [{ category: "social", metric: "socialMobility", op: "<=", value: 42 }],
  },
  {
    id: "skills_gap",
    label: "Skills Gap",
    effect: -1,
    conditions: [
      { category: "education", metric: "workforceSkill", op: "<=", value: 45 },
      { category: "economic", metric: "unemploymentRate", op: ">=", value: 7 },
    ],
  },
  {
    id: "infrastructure_crisis",
    label: "Crumbling Infrastructure",
    effect: -2,
    conditions: [
      { category: "infrastructure", metric: "roadCondition", op: "<=", value: 55 },
      { category: "infrastructure", metric: "waterQuality", op: "<=", value: 80 },
      { category: "infrastructure", metric: "broadbandAccess", op: "<=", value: 68 },
    ],
  },
  {
    id: "low_broadband",
    label: "Poor Broadband Access",
    effect: -1,
    conditions: [{ category: "infrastructure", metric: "broadbandAccess", op: "<=", value: 70 }],
  },
  {
    id: "information_disorder",
    label: "Disinformation Spread",
    effect: -2,
    conditions: [
      { category: "mediaInformation", metric: "mediaPolarization", op: ">=", value: 60 },
      { category: "mediaInformation", metric: "disinformationRisk", op: ">=", value: 55 },
    ],
  },
  {
    id: "media_polarization",
    label: "Polarized Media",
    effect: -1,
    conditions: [
      { category: "mediaInformation", metric: "mediaPolarization", op: ">=", value: 52 },
    ],
  },
  {
    id: "press_suppression",
    label: "Restricted Press Freedom",
    effect: -2,
    conditions: [
      { category: "mediaInformation", metric: "pressFreedom", op: "<=", value: 40 },
      { category: "mediaInformation", metric: "disinformationRisk", op: ">=", value: 50 },
    ],
  },
  {
    id: "negative_net_migration",
    label: "Negative Net Migration",
    effect: -1,
    conditions: [
      { category: "population", metric: "migrationRate", op: "<=", value: -1 },
      { category: "population", metric: "populationGrowth", op: "<=", value: 0 },
    ],
  },
  {
    id: "population_boom",
    label: "Population Boom",
    effect: 1,
    conditions: [
      { category: "population", metric: "populationGrowth", op: ">=", value: 1.2 },
      { category: "population", metric: "migrationRate", op: ">=", value: 0.2 },
    ],
  },
  {
    id: "youth_surge",
    label: "Young Population",
    effect: 1,
    conditions: [
      { category: "population", metric: "medianAge", op: "<=", value: 35 },
      { category: "population", metric: "populationGrowth", op: ">=", value: 0.5 },
    ],
  },
  {
    id: "brain_gain",
    label: "Brain Gain",
    effect: 1,
    conditions: [
      { category: "population", metric: "migrationRate", op: ">=", value: 0.3 },
      { category: "education", metric: "workforceSkill", op: ">=", value: 70 },
    ],
  },
  {
    id: "housing_crisis",
    label: "Unaffordable Housing",
    effect: -2,
    conditions: [
      { category: "social", metric: "homelessnessRate", op: ">=", value: 28 },
      { category: "economic", metric: "costOfLiving", op: ">=", value: 130 },
    ],
  },
  {
    id: "heavy_public_debt",
    label: "Heavy Public Debt",
    effect: -1,
    conditions: [{ category: "governance", metric: "debtToGdp", op: ">=", value: 115 }],
  },
];

function check(
  metrics: Record<string, Record<string, number>>,
  cond: Condition,
  year?: number | null,
  countryId?: string | null
): boolean {
  // Era existence gate: a condition on a metric that doesn't exist yet in this
  // era can never be met (the modifier is skipped). year null ⇒ always active.
  if (!isMetricActive(cond.metric, countryId ?? undefined, year ?? null)) return false;
  const val = metrics[cond.category]?.[cond.metric];
  if (val === undefined || !Number.isFinite(val)) return false;
  // Era drift: condition values are authored against the modern world; judge
  // against the era's normal by translating with the band curve's midpoint
  // movement. Zero for non-curve metrics and when year is null (legacy).
  const threshold = cond.value + getEraConditionShift(cond.metric, countryId ?? undefined, year);
  switch (cond.op) {
    case ">=":
      return val >= threshold;
    case "<=":
      return val <= threshold;
    case ">":
      return val > threshold;
    case "<":
      return val < threshold;
  }
}

function resolveDefForEvaluation(
  def: ModifierDef,
  options?: EvaluateModifiersOptions
): ModifierDef | null {
  return resolveModifierDef(def, {
    preset: options?.preset,
    countryId: options?.countryId,
  });
}

/**
 * Evaluate all modifier definitions against a flat metrics map.
 * Returns only the active (all-conditions-met) modifiers.
 */
export function evaluateModifiers(
  metrics: Record<string, Record<string, number>>,
  options?: EvaluateModifiersOptions
): ActiveModifier[] {
  const active: ActiveModifier[] = [];
  for (const def of MODIFIER_DEFS) {
    const resolved = resolveDefForEvaluation(def, options);
    if (!resolved) continue;
    if (resolved.conditions.every((c) => check(metrics, c, options?.year, options?.countryId))) {
      active.push({
        id: resolved.id,
        label: resolved.label,
        effect: resolved.effect,
        marginEffect: marginEffectForModifier(resolved.effect, resolved.id),
        source: "metric",
      });
    }
  }
  return active;
}

/**
 * Split active modifiers into headline (highest-impact) and remainder lists for
 * compact UIs such as the state overview conditions card.
 */
export function prioritizeModifiers(
  modifiers: ActiveModifier[],
  opts?: { max?: number }
): { headline: ActiveModifier[]; remainder: ActiveModifier[] } {
  const max = opts?.max ?? HEADLINE_MODIFIER_CAP;
  if (modifiers.length <= max) {
    return { headline: modifiers, remainder: [] };
  }
  // Sort by absolute margin effect first (most impactful on profit margins),
  // then by absolute approval effect as tie-breaker
  const sorted = [...modifiers].sort((a, b) => {
    const marginA = Math.abs(a.marginEffect ?? 0);
    const marginB = Math.abs(b.marginEffect ?? 0);
    if (marginB !== marginA) return marginB - marginA;
    const impact = Math.abs(b.effect) - Math.abs(a.effect);
    if (impact !== 0) return impact;
    return a.label.localeCompare(b.label);
  });
  return {
    headline: sorted.slice(0, max),
    remainder: sorted.slice(max),
  };
}

/**
 * Apply modifier effects to a base approval score.
 * Positive effects are summed then capped at {@link POSITIVE_MODIFIER_NET_CAP};
 * negatives remain uncapped so crisis stacks still hurt.
 */
export function applyModifiers(base: number, modifiers: ActiveModifier[]): number {
  let positive = 0;
  let negative = 0;
  for (const m of modifiers) {
    if (m.effect >= 0) positive += m.effect;
    else negative += m.effect;
  }
  const total = Math.min(positive, POSITIVE_MODIFIER_NET_CAP) + negative;
  return Math.max(0, Math.min(100, Math.round((base + total) * 10) / 10));
}
