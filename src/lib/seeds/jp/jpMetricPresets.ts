import type { StateMetrics } from "@/lib/db/types";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";

/**
 * Per-region, per-era HAND-AUTHORED values for Japan's new overhaul ROOT metrics.
 * Consumed via `getRegionMetricPresets` and overlaid by `seedJPStateMetrics` /
 * `seedJPBaselines` AFTER `applyEra1991Adjustments`. The preset is the SINGLE SOURCE OF
 * TRUTH for these metrics in both eras; `uniformMetricDefault` is a fallback only.
 *
 * JP differs from IE/DE: its seed (`jpStateMetrics`) already hand-authors ~16 of these
 * metrics PER REGION with real 2020-era data (ruralRevitalization, foodSecurity,
 * academicPressure, elderCareQuality, mentalHealthAccess, transportEfficiency,
 * naturalDisasterPreparedness, nuclearSafety, workLifeBalance, foreignWorkerIntegration,
 * genderEquality, roboticsAdoption, demographicDecline + flat tradeBalance/housingSupply/
 * debtToGdp). The 2019 bundle PRESERVES those (read from the seed) and authors only the
 * metrics the seed otherwise left to the uniform formula — so no blind formula value
 * survives, and the genuine per-region seed data isn't discarded. 1991 is fully authored.
 */

/** A per-region map of metricPath → numeric value (only the metrics JP authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics Japan authors per era — 45 of the 52 uniform paths (IE's 44 plus
 * `environment.nuclearSafety`; no `coDeterminationQuality`, a German institution). Excludes
 * UK-named metrics, engine-recomputed wageGrowth/tradeGrowth, and population.birthRate.
 */
export const JP_AUTHORED_METRIC_PATHS = [
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
  "education.universityEnrollment",
  "education.apprenticeshipRate",
  "education.academicPressure",
  "healthcare.uninsuredRate",
  "healthcare.affordabilityIndex",
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
  "mediaInformation.stateMediaControl",
] as const;

const JP_REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

function readPath(m: StateMetrics, path: string): number | undefined {
  const [cat, id] = path.split(".");
  const c = (m as unknown as Record<string, Record<string, { value: number } | undefined>>)[cat];
  return c?.[id]?.value;
}

/**
 * 2019 metrics the JP seed leaves to the uniform formula — authored here so no blind
 * formula value survives. (rdIntensity/productivityGrowth are seed formulas too, so they
 * are authored.) The ~16 metrics the seed authors per region pass through unchanged.
 */
const NATIONAL_2019_OVR: Record<string, number> = {
  "economic.laborParticipation": 62,
  "economic.matchingFriction": 2.5,
  "economic.productivityGrowth": 0.4,
  "economic.rdIntensity": 3.3,
  "economic.propertyValueIndex": 100,
  "economic.commercialValueIndex": 100,
  "economic.exportDependency": 35,
  "economic.manufacturingCompetitiveness": 85,
  "economic.regulatoryBurden": 55,
  "economic.economicFreedom": 70,
  "education.highSchoolGradRate": 95,
  "education.universityEnrollment": 55,
  "education.apprenticeshipRate": 1.5,
  "healthcare.uninsuredRate": 1,
  "healthcare.affordabilityIndex": 70,
  "healthcare.socialCareQuality": 65,
  "publicSafety.antiSocialBehaviourRate": 3,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 16,
  "environment.energyTransitionProgress": 30,
  "social.childPoverty": 14,
  "social.housingAffordability": 50,
  "social.roughSleeping": 2,
  "governance.devolutionSatisfaction": 50,
  "governance.nationalPride": 60,
  "governance.civilLiberties": 80,
  "governance.militaryReadiness": 50,
  "mediaInformation.stateMediaControl": 30,
};

const TILTS_2019_OVR: Record<string, Record<string, number>> = {
  KAN: {
    "economic.propertyValueIndex": 180,
    "economic.commercialValueIndex": 175,
    "economic.manufacturingCompetitiveness": 82,
    "economic.economicFreedom": 72,
    "economic.rdIntensity": 3.5,
    "economic.productivityGrowth": 0.6,
    "education.highSchoolGradRate": 97,
    "education.universityEnrollment": 64,
    "healthcare.affordabilityIndex": 60,
    "social.housingAffordability": 82,
    "social.childPoverty": 11,
    "social.roughSleeping": 5,
    "environment.energyTransitionProgress": 28,
  },
  CHU: {
    "economic.manufacturingCompetitiveness": 92,
    "economic.exportDependency": 45,
    "economic.propertyValueIndex": 105,
    "economic.rdIntensity": 3.4,
  },
  KNS: {
    "economic.propertyValueIndex": 120,
    "economic.commercialValueIndex": 118,
    "economic.manufacturingCompetitiveness": 80,
    "social.housingAffordability": 62,
  },
  HOK: {
    "economic.manufacturingCompetitiveness": 60,
    "economic.exportDependency": 25,
    "economic.propertyValueIndex": 75,
    "environment.energyTransitionProgress": 38,
    "environment.floodRisk": 12,
    "social.childPoverty": 16,
  },
  TOH: {
    "economic.manufacturingCompetitiveness": 68,
    "economic.propertyValueIndex": 70,
    "environment.energyTransitionProgress": 40,
    "environment.floodRisk": 18,
  },
  CGK: {
    "economic.manufacturingCompetitiveness": 80,
    "economic.propertyValueIndex": 78,
  },
  SHI: {
    "economic.manufacturingCompetitiveness": 62,
    "economic.propertyValueIndex": 65,
    "economic.exportDependency": 28,
    "environment.energyTransitionProgress": 35,
    "social.childPoverty": 15,
  },
  KYU: {
    "economic.manufacturingCompetitiveness": 78,
    "economic.propertyValueIndex": 78,
    "environment.energyTransitionProgress": 40,
  },
};

export const jpMetricPresets2019: MetricPresetBundle = Object.fromEntries(
  jpStateMetrics.map((m) => {
    const region = String(m._id);
    const seed: Record<string, number> = {};
    for (const path of JP_AUTHORED_METRIC_PATHS) {
      const v = readPath(m, path);
      if (typeof v === "number") seed[path] = v;
    }
    return [region, { ...seed, ...NATIONAL_2019_OVR, ...(TILTS_2019_OVR[region] ?? {}) }];
  })
);

/**
 * 1991 Japan — the asset-bubble peak (the bubble burst in late 1991/1992). Astronomical
 * land/commercial values (esp. Tokyo), peak "Japan Inc." manufacturing dominance and
 * "Japan as No. 1" confidence, brutal bubble-era overwork (karoshi) and exam pressure
 * ("juken jigoku"), a far younger population, pre-Fukushima nuclear confidence with active
 * expansion, almost no renewables, a closed labor market, and LOW public debt (~60% — the
 * lost-decades stimulus ramp came later). Fully authored (the seed is 2020-era).
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 63,
  "economic.matchingFriction": 2.0,
  "economic.tradeBalance": 6,
  "economic.productivityGrowth": 2.0,
  "economic.rdIntensity": 2.8,
  "economic.propertyValueIndex": 150,
  "economic.commercialValueIndex": 160,
  "economic.ruralRevitalization": 50,
  "economic.foodSecurity": 50,
  "economic.exportDependency": 38,
  "economic.manufacturingCompetitiveness": 90,
  "economic.regulatoryBurden": 60,
  "economic.economicFreedom": 65,
  "education.highSchoolGradRate": 94,
  "education.universityEnrollment": 38,
  "education.apprenticeshipRate": 1.5,
  "education.academicPressure": 80,
  "healthcare.uninsuredRate": 1,
  "healthcare.affordabilityIndex": 72,
  "healthcare.mentalHealthAccess": 22,
  "healthcare.socialCareQuality": 50,
  "healthcare.elderCareQuality": 55,
  "infrastructure.transportEfficiency": 80,
  "publicSafety.antiSocialBehaviourRate": 3,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 16,
  "environment.naturalDisasterPreparedness": 65,
  "environment.nuclearSafety": 70,
  "environment.energyTransitionProgress": 3,
  "social.childPoverty": 12,
  "social.housingAffordability": 80,
  "social.roughSleeping": 2,
  "social.workLifeBalance": 32,
  "social.foreignWorkerIntegration": 15,
  "social.genderEquality": 20,
  "social.housingSupplyGrowth": 2.5,
  "governance.debtToGdp": 60,
  "governance.devolutionSatisfaction": 48,
  "governance.roboticsAdoption": 50,
  "governance.nationalPride": 70,
  "governance.civilLiberties": 78,
  "governance.militaryReadiness": 45,
  "population.demographicDecline": 60,
  "mediaInformation.stateMediaControl": 35,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  // Kanto / Tokyo — the bubble epicentre.
  KAN: {
    "economic.propertyValueIndex": 280,
    "economic.commercialValueIndex": 290,
    "economic.rdIntensity": 3.0,
    "economic.manufacturingCompetitiveness": 88,
    "education.academicPressure": 88,
    "infrastructure.transportEfficiency": 90,
    "social.housingAffordability": 92,
    "social.workLifeBalance": 28,
    "social.foreignWorkerIntegration": 22,
    "social.genderEquality": 25,
    "governance.roboticsAdoption": 60,
    "population.demographicDecline": 65,
  },
  CHU: {
    "economic.manufacturingCompetitiveness": 96, // Toyota/auto heartland at its peak
    "economic.propertyValueIndex": 175,
    "governance.roboticsAdoption": 62,
  },
  KNS: {
    "economic.propertyValueIndex": 210,
    "economic.commercialValueIndex": 220,
    "economic.manufacturingCompetitiveness": 92,
    "social.housingAffordability": 78,
  },
  HOK: {
    "economic.manufacturingCompetitiveness": 75,
    "economic.propertyValueIndex": 100,
    "economic.foodSecurity": 58,
  },
  TOH: {
    "economic.propertyValueIndex": 95,
    "economic.foodSecurity": 55,
  },
  CGK: {
    "economic.propertyValueIndex": 110,
  },
  SHI: {
    "economic.manufacturingCompetitiveness": 78,
    "economic.propertyValueIndex": 90,
    "economic.foodSecurity": 55,
  },
  KYU: {
    "economic.propertyValueIndex": 110,
    "economic.foodSecurity": 54,
  },
};

export const jpMetricPresets1991: MetricPresetBundle = Object.fromEntries(
  JP_REGIONS.map((region) => [region, { ...NATIONAL_1991, ...(TILTS_1991[region] ?? {}) }])
);
