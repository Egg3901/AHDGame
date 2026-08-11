/**
 * SP4 §4a — corp sector-margin adapter at full-table scope.
 *
 * The sector-margin engine reads ~70 political stateMetrics signals that the
 * playable-country demolition removes. For LAW_COUNTRY_IDS regions each
 * political signal resolves from the region's politicalMetrics board instead,
 * through two tiers:
 *   1. a per-signal mapping to the closest SP1 family, else
 *   2. the SP1 CATEGORY score for the signal's legacy category,
 * so no signal's channel weight silently drops to zero. Survivor categories
 * (economic.*, population.*) keep the legacy read path and get NO adapter row.
 *
 * Scale: non-legacy signals score normalizedQuality(-1..1) x
 * STATE_METRIC_PER_METRIC_CAP (sectorMetricMarginProfiles.metricBaseModifier).
 * SP1 values are 0-100 higher-is-better, so goodness = (value - 50) / 50 slots
 * into the same formula — adapter rows are scale-identical to non-legacy rows
 * by construction, and every legacy polarity flip (crimeRate lower-better →
 * order.safety higher-better) is absorbed by the mapping itself.
 */

import {
  METRIC_MARGIN_SIGNALS,
  STATE_METRIC_PER_METRIC_CAP,
  metricKey,
} from "@/lib/corporations/sectorMetricMarginProfiles";
import { categoryScore } from "@/lib/politicalMetrics/aggregate";
import type { PoliticalMetricCategoryId, PoliticalMetricId } from "@/lib/politicalMetrics/types";

/** Legacy stateMetrics categories that survive demolition — never adapted. */
export const SURVIVOR_SIGNAL_CATEGORIES: ReadonlySet<string> = new Set(["economic", "population"]);

/** Tier 1: legacy "category.metricId" → closest SP1 family. */
export const ADAPTER_TIER1: Record<string, PoliticalMetricId> = {
  // education
  "education.highSchoolGradRate": "education.attainment",
  "education.testPerformance": "education.standards",
  "education.educationSpending": "education.universalSchooling",
  "education.literacyRate": "education.universalSchooling",
  "education.workforceSkill": "education.adultSkills",
  "education.gcseAttainment": "education.attainment",
  "education.universityEnrollment": "education.attainment",
  "education.apprenticeshipRate": "education.adultSkills",
  // healthcare
  "healthcare.uninsuredRate": "health.universalCare",
  "healthcare.affordabilityIndex": "health.universalCare",
  "healthcare.physicianRate": "health.outcomes",
  "healthcare.lifeExpectancy": "health.outcomes",
  "healthcare.preventableMortality": "health.prevention",
  "healthcare.publicHealthPreparedness": "health.prevention",
  "healthcare.nhsWaitingTime": "health.systemEfficiency",
  "healthcare.socialCareQuality": "health.socialInsurance",
  "healthcare.elderCareQuality": "health.socialInsurance",
  // infrastructure
  "infrastructure.roadCondition": "infrastructure.condition",
  "infrastructure.broadbandAccess": "infrastructure.utilities",
  "infrastructure.publicTransit": "infrastructure.transit",
  "infrastructure.waterQuality": "infrastructure.utilities",
  "infrastructure.powerGridReliability": "infrastructure.utilities",
  "infrastructure.infrastructureInvestmentGap": "infrastructure.development",
  "infrastructure.transportEfficiency": "infrastructure.highways",
  // publicSafety
  "publicSafety.crimeRate": "order.safety",
  "publicSafety.violentCrimeRate": "order.safety",
  "publicSafety.knifeCrimeRate": "order.safety",
  "publicSafety.antiSocialBehaviourRate": "order.safety",
  "publicSafety.policePerCapita": "order.policeStrength",
  "publicSafety.publicSafetyConfidence": "order.communityTrust",
  // environment
  "environment.airQuality": "environment.urbanAir",
  "environment.renewableEnergy": "environment.stewardship",
  "environment.energyTransitionProgress": "environment.stewardship",
  "environment.carbonEmissions": "environment.stewardship",
  "environment.protectedLand": "environment.conservation",
  "environment.nuclearSafety": "environment.energySecurity",
  // social
  "social.socialMobility": "society.socialMobility",
  "social.incomeInequality": "society.socialMobility",
  "social.homelessnessRate": "infrastructure.publicHousing",
  "social.roughSleeping": "infrastructure.publicHousing",
  "social.housingAffordability": "infrastructure.publicHousing",
  "social.housingSupplyGrowth": "infrastructure.development",
  "social.civicParticipation": "society.civicLife",
  "social.socialCohesion": "society.integration",
  "social.foreignWorkerIntegration": "society.integration",
  "social.childPoverty": "society.familyStability",
  "social.workLifeBalance": "economy.workerSecurity",
  "social.genderEquality": "society.womensOpportunity",
  // governance
  "governance.governmentTransparency": "governance.openness",
  "governance.corruptionIndex": "governance.integrity",
  "governance.publicTrust": "governance.integrity",
  "governance.voterTurnout": "governance.participation",
  "governance.devolutionSatisfaction": "governance.localAutonomy",
  "governance.coDeterminationQuality": "economy.workerSecurity",
  "governance.roboticsAdoption": "economy.productivity",
  // mediaInformation
  "mediaInformation.disinformationRisk": "governance.openness",
  "mediaInformation.pressFreedom": "governance.openness",
  "mediaInformation.newsTrust": "governance.openness",
  "mediaInformation.bbcTrust": "governance.openness",
};

/** Tier 2: legacy category → SP1 category whose score backs unmapped signals. */
export const ADAPTER_TIER2_CATEGORY: Record<string, PoliticalMetricCategoryId> = {
  education: "education",
  healthcare: "health",
  infrastructure: "infrastructure",
  publicSafety: "order",
  environment: "environment",
  social: "society",
  governance: "governance",
  mediaInformation: "governance",
};

export interface PoliticalSignalValue {
  /** Base modifier on the metricBaseModifier scale (pre channel/strategy weights). */
  modifier: number;
  /** The SP1 source value (0-100) shown as the contribution's rawValue. */
  rawValue: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Build the per-signal political base modifiers for one region's board.
 * Keys are the margin engine's `metricKey(category, metricId)` strings.
 */
export function buildPoliticalBaseModifiers(
  values: Record<PoliticalMetricId, number>
): Map<string, PoliticalSignalValue> {
  const out = new Map<string, PoliticalSignalValue>();
  for (const signal of METRIC_MARGIN_SIGNALS) {
    if (Object.keys(signal.channels).length === 0) continue; // intentionally neutral
    if (SURVIVOR_SIGNAL_CATEGORIES.has(signal.category)) continue; // legacy read path
    const key = metricKey(signal.category, signal.metricId);
    const familyId = ADAPTER_TIER1[key];
    const source =
      familyId != null
        ? (values[familyId] ?? 50)
        : categoryScore(values, ADAPTER_TIER2_CATEGORY[signal.category]);
    const goodness = clamp((source - 50) / 50, -1, 1);
    out.set(key, {
      modifier: goodness * STATE_METRIC_PER_METRIC_CAP,
      rawValue: Math.round(source * 10) / 10,
    });
  }
  return out;
}

/**
 * Resolve one legacy metric read for a playable region (the crisis-trigger
 * read of infrastructure.powerGridReliability uses this). Returns the SP1
 * source value (0-100) or null when the key has no adapter row.
 *
 * DIRECTION WARNING: the returned value is SP1's HIGHER-IS-BETTER score. For
 * legacy metrics whose raw scale is lower-is-better (crimeRate,
 * corruptionIndex, …) a raw-value caller must invert explicitly — see
 * politicalSoeInputs. (The margin-overlay path is unaffected: it computes
 * goodness directly, so polarity is absorbed by the mapping.)
 */
export function politicalValueForLegacyMetric(
  values: Record<PoliticalMetricId, number>,
  category: string,
  metricId: string
): number | null {
  const key = `${category}.${metricId}`;
  const familyId = ADAPTER_TIER1[key];
  if (familyId != null) return values[familyId] ?? null;
  const cat = ADAPTER_TIER2_CATEGORY[category];
  return cat != null ? categoryScore(values, cat) : null;
}

/**
 * SP4 branch-audit fix — the SOE efficiency penalty's governance inputs for a
 * playable region, on the LEGACY scales computeSoeEfficiencyPenalty documents:
 * corruptionIndex 0-100 higher-is-CORRUPT (inverted from governance.integrity)
 * and governmentTransparency 0-100 higher-is-better (governance.openness).
 */
export function politicalSoeInputs(values: Record<PoliticalMetricId, number>): {
  corruptionIndex: number;
  governmentTransparency: number;
} {
  return {
    corruptionIndex: 100 - (values["governance.integrity"] ?? 50),
    governmentTransparency: values["governance.openness"] ?? 50,
  };
}
