import type { StateMetrics } from "@/lib/db/types";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";

/**
 * Per-region, per-era HAND-AUTHORED values for the UK's new overhaul ROOT metrics.
 * Consumed via `getRegionMetricPresets` and overlaid by `seedUKStateMetrics` /
 * `seedUKBaselines` AFTER `applyEra1991Adjustments`. The preset is the SINGLE SOURCE OF
 * TRUTH for these metrics in both eras; `uniformMetricDefault` is a fallback only.
 *
 * Like JP, the UK seed (`ukStateMetrics`) already hand-authors many of these metrics per
 * region (propertyValueIndex, gcseAttainment, nhsWaitingTime, mentalHealthAccess,
 * socialCareQuality, antiSocialBehaviourRate, knifeCrimeRate, floodRisk, childPoverty,
 * housingAffordability, roughSleeping, devolutionSatisfaction, bbcTrust, …). The 2019 bundle
 * PRESERVES those (read from the seed) and authors only the metrics the seed left to the
 * uniform formula. 1991 is fully authored.
 *
 * The UK is the one country that natively uses `nhsWaitingTime`, `gcseAttainment` and
 * `bbcTrust` (the others exclude those UK-coined metrics). `housingAffordability` follows the
 * UK seed's price-to-income RATIO convention (≈4–16), not the 0–100 pressure index the other
 * countries use — preserved as-is so it stays consistent with the seed.
 */

/** A per-region map of metricPath → numeric value (only the metrics the UK authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics the UK authors per era — 48 of the 52 uniform paths (all except the
 * German `coDeterminationQuality`, the engine-recomputed wageGrowth/tradeGrowth, and
 * population.birthRate). Includes the UK-native nhsWaitingTime/gcseAttainment/bbcTrust and
 * nuclearSafety.
 */
export const UK_AUTHORED_METRIC_PATHS = [
  "economic.laborParticipation",
  "economic.matchingFriction",
  "economic.tradeBalance",
  "economic.productivityGrowth",
  "economic.rdIntensity",
  "economic.propertyValueIndex",
  "economic.commercialValueIndex",
  "economic.ruralRevitalization",
  "economic.foodSecurity",
  "economic.exportDependency",
  "economic.manufacturingCompetitiveness",
  "economic.regulatoryBurden",
  "economic.economicFreedom",
  "education.highSchoolGradRate",
  "education.gcseAttainment",
  "education.universityEnrollment",
  "education.apprenticeshipRate",
  "education.academicPressure",
  "healthcare.uninsuredRate",
  "healthcare.affordabilityIndex",
  "healthcare.nhsWaitingTime",
  "healthcare.mentalHealthAccess",
  "healthcare.socialCareQuality",
  "healthcare.elderCareQuality",
  "infrastructure.transportEfficiency",
  "publicSafety.antiSocialBehaviourRate",
  "publicSafety.knifeCrimeRate",
  "environment.floodRisk",
  "environment.naturalDisasterPreparedness",
  "environment.nuclearSafety",
  "environment.energyTransitionProgress",
  "social.childPoverty",
  "social.housingAffordability",
  "social.roughSleeping",
  "social.workLifeBalance",
  "social.foreignWorkerIntegration",
  "social.genderEquality",
  "social.housingSupplyGrowth",
  "governance.debtToGdp",
  "governance.devolutionSatisfaction",
  "governance.roboticsAdoption",
  "governance.nationalPride",
  "governance.civilLiberties",
  "governance.militaryReadiness",
  "population.demographicDecline",
  "mediaInformation.bbcTrust",
  "mediaInformation.stateMediaControl",
] as const;

const UK_REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
] as const;

function readPath(m: StateMetrics, path: string): number | undefined {
  const [cat, id] = path.split(".");
  const c = (m as unknown as Record<string, Record<string, { value: number } | undefined>>)[cat];
  return c?.[id]?.value;
}

/**
 * 2019 metrics the UK seed leaves to the uniform formula — authored here so no blind formula
 * value survives. (rdIntensity/productivityGrowth are seed formulas too, so they are authored.)
 * The seed's genuine per-region values pass through unchanged.
 */
const NATIONAL_2019_OVR: Record<string, number> = {
  "economic.laborParticipation": 63,
  "economic.matchingFriction": 3.0,
  "economic.productivityGrowth": 0.9,
  "economic.rdIntensity": 1.7,
  "economic.ruralRevitalization": 50,
  "economic.foodSecurity": 60,
  "economic.exportDependency": 30,
  "economic.manufacturingCompetitiveness": 60,
  "economic.regulatoryBurden": 45,
  "economic.economicFreedom": 75,
  "education.highSchoolGradRate": 85,
  "education.academicPressure": 60,
  "healthcare.uninsuredRate": 2,
  "healthcare.affordabilityIndex": 75,
  "healthcare.elderCareQuality": 50,
  "infrastructure.transportEfficiency": 60,
  "environment.naturalDisasterPreparedness": 65,
  "environment.nuclearSafety": 72,
  "environment.energyTransitionProgress": 60,
  "social.workLifeBalance": 55,
  "social.foreignWorkerIntegration": 60,
  "social.genderEquality": 65,
  "governance.roboticsAdoption": 45,
  "governance.nationalPride": 62,
  "governance.civilLiberties": 80,
  "governance.militaryReadiness": 65,
  "population.demographicDecline": 45,
  "mediaInformation.stateMediaControl": 25,
};

const TILTS_2019_OVR: Record<string, Record<string, number>> = {
  LON: {
    "economic.rdIntensity": 2.2,
    "economic.manufacturingCompetitiveness": 50,
    "economic.economicFreedom": 78,
    "education.academicPressure": 65,
    "infrastructure.transportEfficiency": 90,
    "social.foreignWorkerIntegration": 70,
    "governance.nationalPride": 58,
    "population.demographicDecline": 36,
  },
  SEE: {
    "economic.rdIntensity": 2.0,
    "economic.manufacturingCompetitiveness": 62,
    "infrastructure.transportEfficiency": 72,
    "social.foreignWorkerIntegration": 60,
    "population.demographicDecline": 48,
  },
  SWE: {
    "economic.rdIntensity": 1.5,
    "economic.foodSecurity": 65,
    "economic.manufacturingCompetitiveness": 58,
    "environment.energyTransitionProgress": 65,
    "infrastructure.transportEfficiency": 50,
    "population.demographicDecline": 52,
  },
  EAE: {
    "economic.rdIntensity": 1.7,
    "economic.manufacturingCompetitiveness": 60,
    "environment.energyTransitionProgress": 65,
    "population.demographicDecline": 48,
  },
  EMI: {
    "economic.rdIntensity": 1.4,
    "economic.manufacturingCompetitiveness": 64,
    "infrastructure.transportEfficiency": 55,
  },
  WMI: {
    "economic.rdIntensity": 1.4,
    "economic.manufacturingCompetitiveness": 66,
    "governance.roboticsAdoption": 50,
    "infrastructure.transportEfficiency": 58,
    "social.foreignWorkerIntegration": 58,
    "population.demographicDecline": 40,
  },
  YHU: {
    "economic.rdIntensity": 1.3,
    "economic.manufacturingCompetitiveness": 60,
    "environment.energyTransitionProgress": 62,
    "infrastructure.transportEfficiency": 55,
  },
  NWE: {
    "economic.rdIntensity": 1.5,
    "economic.manufacturingCompetitiveness": 62,
    "infrastructure.transportEfficiency": 65,
    "social.foreignWorkerIntegration": 58,
  },
  NEE: {
    "economic.rdIntensity": 1.2,
    "economic.manufacturingCompetitiveness": 60,
    "environment.energyTransitionProgress": 65,
    "infrastructure.transportEfficiency": 52,
    "population.demographicDecline": 50,
  },
  SCO: {
    "economic.rdIntensity": 1.6,
    "economic.foodSecurity": 65,
    "economic.manufacturingCompetitiveness": 58,
    "environment.energyTransitionProgress": 80,
    "environment.nuclearSafety": 70,
    "infrastructure.transportEfficiency": 60,
    "population.demographicDecline": 48,
  },
  WAL: {
    "economic.rdIntensity": 1.2,
    "economic.manufacturingCompetitiveness": 55,
    "environment.energyTransitionProgress": 65,
    "infrastructure.transportEfficiency": 48,
    "population.demographicDecline": 52,
  },
  NIR: {
    "economic.rdIntensity": 1.3,
    "economic.manufacturingCompetitiveness": 58,
    "environment.energyTransitionProgress": 55,
    "infrastructure.transportEfficiency": 48,
    "social.foreignWorkerIntegration": 45,
    "population.demographicDecline": 42,
  },
};

export const ukMetricPresets2019: MetricPresetBundle = Object.fromEntries(
  ukStateMetrics.map((m) => {
    const region = String(m._id);
    const seed: Record<string, number> = {};
    for (const path of UK_AUTHORED_METRIC_PATHS) {
      const v = readPath(m, path);
      if (typeof v === "number") seed[path] = v;
    }
    return [region, { ...seed, ...NATIONAL_2019_OVR, ...(TILTS_2019_OVR[region] ?? {}) }];
  })
);

/**
 * 1991 UK — John Major's first year (Thatcher resigned Nov 1990) amid the early-1990s
 * recession (high unemployment, the negative-equity housing crash). Pre-devolution (no
 * Scottish/Welsh/NI legislatures until 1998-99), post-Big-Bang City liberalisation, a still
 * larger manufacturing base (the pit closures and deindustrialisation accelerated through the
 * 1990s), much lower public debt (~30% of GDP), longer NHS waits, a large post-Cold-War
 * military (the Gulf War year), Section 28 in force, and a dominant pre-internet BBC. Fully
 * authored. `housingAffordability` keeps the UK seed's price-to-income RATIO convention.
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 62,
  "economic.matchingFriction": 6,
  "economic.tradeBalance": -2,
  "economic.productivityGrowth": 0.5,
  "economic.rdIntensity": 2.0,
  "economic.propertyValueIndex": 70,
  "economic.commercialValueIndex": 72,
  "economic.ruralRevitalization": 50,
  "economic.foodSecurity": 72,
  "economic.exportDependency": 32,
  "economic.manufacturingCompetitiveness": 72,
  "economic.regulatoryBurden": 50,
  "economic.economicFreedom": 68,
  "education.highSchoolGradRate": 70,
  "education.gcseAttainment": 42,
  "education.universityEnrollment": 22,
  "education.apprenticeshipRate": 2.5,
  "education.academicPressure": 55,
  "healthcare.uninsuredRate": 2,
  "healthcare.affordabilityIndex": 75,
  "healthcare.nhsWaitingTime": 35,
  "healthcare.mentalHealthAccess": 25,
  "healthcare.socialCareQuality": 45,
  "healthcare.elderCareQuality": 45,
  "infrastructure.transportEfficiency": 55,
  "publicSafety.antiSocialBehaviourRate": 8,
  "publicSafety.knifeCrimeRate": 3,
  "environment.floodRisk": 14,
  "environment.naturalDisasterPreparedness": 55,
  "environment.nuclearSafety": 70,
  "environment.energyTransitionProgress": 8,
  "social.childPoverty": 28,
  "social.housingAffordability": 4, // price-to-income ratio (UK convention); post-crash, affordable
  "social.roughSleeping": 3,
  "social.workLifeBalance": 52,
  "social.foreignWorkerIntegration": 45,
  "social.genderEquality": 50,
  "social.housingSupplyGrowth": 1.5,
  "governance.debtToGdp": 30,
  "governance.devolutionSatisfaction": 35,
  "governance.roboticsAdoption": 20,
  "governance.nationalPride": 65,
  "governance.civilLiberties": 70,
  "governance.militaryReadiness": 75,
  "population.demographicDecline": 35,
  "mediaInformation.bbcTrust": 65,
  "mediaInformation.stateMediaControl": 30,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  LON: {
    "economic.rdIntensity": 2.6,
    "economic.propertyValueIndex": 95,
    "economic.commercialValueIndex": 100,
    "economic.manufacturingCompetitiveness": 60,
    "economic.economicFreedom": 72,
    "education.gcseAttainment": 46,
    "education.universityEnrollment": 30,
    "healthcare.nhsWaitingTime": 32,
    "infrastructure.transportEfficiency": 70,
    "publicSafety.antiSocialBehaviourRate": 11,
    "publicSafety.knifeCrimeRate": 5,
    "social.childPoverty": 32,
    "social.housingAffordability": 6,
    "social.roughSleeping": 5,
    "social.foreignWorkerIntegration": 55,
    "mediaInformation.bbcTrust": 62,
    "population.demographicDecline": 30,
  },
  SEE: {
    "economic.rdIntensity": 2.2,
    "economic.propertyValueIndex": 80,
    "education.gcseAttainment": 45,
    "social.housingAffordability": 5,
  },
  SWE: {
    "economic.propertyValueIndex": 75,
    "economic.foodSecurity": 75,
  },
  EAE: {
    "economic.propertyValueIndex": 72,
  },
  EMI: {
    "economic.propertyValueIndex": 68,
    "economic.manufacturingCompetitiveness": 78,
  },
  WMI: {
    "economic.propertyValueIndex": 70,
    "economic.manufacturingCompetitiveness": 78,
    "education.gcseAttainment": 40,
    "governance.roboticsAdoption": 22,
  },
  YHU: {
    "economic.propertyValueIndex": 65,
    "economic.manufacturingCompetitiveness": 78,
    "education.gcseAttainment": 40,
  },
  NWE: {
    "economic.propertyValueIndex": 68,
    "economic.manufacturingCompetitiveness": 78,
  },
  NEE: {
    "economic.propertyValueIndex": 58,
    "economic.manufacturingCompetitiveness": 78,
    "education.gcseAttainment": 38,
    "social.childPoverty": 33,
  },
  SCO: {
    "economic.propertyValueIndex": 65,
    "economic.foodSecurity": 75,
    "environment.energyTransitionProgress": 12,
    "education.gcseAttainment": 44,
    "governance.devolutionSatisfaction": 38,
    "mediaInformation.bbcTrust": 60,
  },
  WAL: {
    "economic.propertyValueIndex": 60,
    "economic.manufacturingCompetitiveness": 75,
    "education.gcseAttainment": 40,
  },
  NIR: {
    "economic.propertyValueIndex": 60,
    "healthcare.nhsWaitingTime": 38,
    "education.gcseAttainment": 44,
    "social.foreignWorkerIntegration": 40,
    "governance.civilLiberties": 60, // the Troubles
    "mediaInformation.bbcTrust": 55,
  },
};

export const ukMetricPresets1991: MetricPresetBundle = Object.fromEntries(
  UK_REGIONS.map((region) => [region, { ...NATIONAL_1991, ...(TILTS_1991[region] ?? {}) }])
);
