/**
 * Per-region, per-era HAND-AUTHORED values for Brazil's new overhaul ROOT metrics.
 * Consumed via `getRegionMetricPresets` and overlaid by `seedBRStateMetrics` /
 * `seedBRBaselines` AFTER `applyEra1991Adjustments`. The preset is the SINGLE SOURCE OF
 * TRUTH for these metrics in both eras; `uniformMetricDefault` is a fallback only.
 *
 * BOTH eras are authored (national baseline + per-region tilts), per the 2026-06-15 decision.
 * 2019 = post-Real-Plan Brazil; 1991 = the hyperinflation years (pre-Real-Plan 1994; Collor's
 * 1990-92 recession, asset freeze), a young post-dictatorship democracy (redemocratized 1985,
 * 1988 Constitution) with a still-closed import-substitution economy just beginning to open.
 */

/** A per-region map of metricPath → numeric value (only the metrics BR authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics Brazil authors per era — 45 of the 52 uniform paths (IE's 44 plus
 * `environment.nuclearSafety`; Brazil runs the Angra reactors). No `coDeterminationQuality`
 * (German). Excludes UK-named metrics, engine-recomputed wageGrowth/tradeGrowth, and birthRate.
 */
export const BR_AUTHORED_METRIC_PATHS = [
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

const BR_REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"] as const;

function expand(
  national: Record<string, number>,
  tilts: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    BR_REGIONS.map((region) => [region, { ...national, ...(tilts[region] ?? {}) }])
  );
}

/**
 * 2019 Brazil — a large middle-income economy: agribusiness powerhouse and very high
 * renewable (hydro) share, but high inequality/violence, costly bureaucracy ("custo Brasil"),
 * partial deindustrialization, and a young-but-aging population. `housingAffordability` is a
 * PRESSURE index (lower = better) — high in the São Paulo/Rio metros.
 */
const NATIONAL_2019: Record<string, number> = {
  "economic.laborParticipation": 64,
  "economic.matchingFriction": 4.5,
  "economic.tradeBalance": 1.2,
  "economic.productivityGrowth": 0.8,
  "economic.rdIntensity": 1.2,
  "economic.propertyValueIndex": 80,
  "economic.commercialValueIndex": 80,
  "economic.ruralRevitalization": 45,
  "economic.foodSecurity": 70,
  "economic.exportDependency": 30,
  "economic.manufacturingCompetitiveness": 45,
  "economic.regulatoryBurden": 70,
  "economic.economicFreedom": 52,
  "education.highSchoolGradRate": 65,
  "education.universityEnrollment": 25,
  "education.apprenticeshipRate": 2.0,
  "education.academicPressure": 50,
  "healthcare.uninsuredRate": 5,
  "healthcare.affordabilityIndex": 55,
  "healthcare.mentalHealthAccess": 38,
  "healthcare.socialCareQuality": 48,
  "healthcare.elderCareQuality": 45,
  "infrastructure.transportEfficiency": 38,
  "publicSafety.antiSocialBehaviourRate": 12,
  "publicSafety.knifeCrimeRate": 6,
  "environment.floodRisk": 15,
  "environment.naturalDisasterPreparedness": 45,
  "environment.nuclearSafety": 60,
  "environment.energyTransitionProgress": 60,
  "social.childPoverty": 32,
  "social.housingAffordability": 48,
  "social.roughSleeping": 6,
  "social.workLifeBalance": 50,
  "social.foreignWorkerIntegration": 50,
  "social.genderEquality": 48,
  "social.housingSupplyGrowth": 1.6,
  "governance.debtToGdp": 74,
  "governance.devolutionSatisfaction": 42,
  "governance.roboticsAdoption": 30,
  "governance.nationalPride": 62,
  "governance.civilLiberties": 62,
  "governance.militaryReadiness": 50,
  "population.demographicDecline": 38,
  "mediaInformation.stateMediaControl": 35,
};

const TILTS_2019: Record<string, Record<string, number>> = {
  // Norte — Amazon basin: youngest, vast hydro, frontier poverty.
  NORTE: {
    "economic.rdIntensity": 0.7,
    "economic.propertyValueIndex": 60,
    "economic.manufacturingCompetitiveness": 35,
    "economic.ruralRevitalization": 35,
    "education.highSchoolGradRate": 58,
    "environment.energyTransitionProgress": 75,
    "infrastructure.transportEfficiency": 28,
    "publicSafety.knifeCrimeRate": 7,
    "social.childPoverty": 42,
    "population.demographicDecline": 28,
  },
  // Nordeste — historically poorest; strong NE wind build-out.
  NORDESTE: {
    "economic.rdIntensity": 0.8,
    "economic.propertyValueIndex": 55,
    "economic.manufacturingCompetitiveness": 38,
    "education.highSchoolGradRate": 58,
    "environment.energyTransitionProgress": 70,
    "infrastructure.transportEfficiency": 32,
    "publicSafety.knifeCrimeRate": 7,
    "social.childPoverty": 45,
    "social.housingAffordability": 40,
    "governance.devolutionSatisfaction": 38,
    "population.demographicDecline": 32,
  },
  // Centro-Oeste — agribusiness powerhouse (soy/beef), Brasília.
  CENTRO_OESTE: {
    "economic.foodSecurity": 85,
    "economic.ruralRevitalization": 60,
    "economic.manufacturingCompetitiveness": 42,
    "economic.economicFreedom": 56,
    "economic.propertyValueIndex": 78,
    "environment.energyTransitionProgress": 55,
    "social.childPoverty": 22,
    "population.demographicDecline": 34,
  },
  // Sudeste — São Paulo/Rio/Minas economic engine.
  SUDESTE: {
    "economic.rdIntensity": 1.8,
    "economic.propertyValueIndex": 110,
    "economic.commercialValueIndex": 110,
    "economic.manufacturingCompetitiveness": 58,
    "economic.economicFreedom": 56,
    "education.highSchoolGradRate": 70,
    "education.universityEnrollment": 30,
    "infrastructure.transportEfficiency": 48,
    "social.housingAffordability": 60,
    "social.childPoverty": 26,
    "governance.roboticsAdoption": 40,
    "population.demographicDecline": 42,
  },
  // Sul — European-heritage, prosperous, oldest/lowest-fertility.
  SUL: {
    "economic.rdIntensity": 1.5,
    "economic.propertyValueIndex": 95,
    "economic.manufacturingCompetitiveness": 60,
    "economic.foodSecurity": 80,
    "economic.ruralRevitalization": 58,
    "education.highSchoolGradRate": 72,
    "environment.energyTransitionProgress": 62,
    "infrastructure.transportEfficiency": 45,
    "social.childPoverty": 18,
    "governance.roboticsAdoption": 38,
    "population.demographicDecline": 44,
  },
};

export const brMetricPresets2019: MetricPresetBundle = expand(NATIONAL_2019, TILTS_2019);

/**
 * 1991 Brazil — hyperinflation (annual inflation ~480% in 1991, climbing toward ~2,500%
 * before the 1994 Real Plan) and Collor's 1990-92 recession (the asset-freeze "Plano
 * Collor"). A four-year-old democracy under a closed import-substitution economy just
 * beginning to liberalize, with very high poverty/inequality, a very young population, a
 * nascent SUS (created 1990), and minimal R&D/robotics. Public debt was lower than today
 * (the post-Real debt build-up came later).
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 60,
  "economic.matchingFriction": 7,
  "economic.tradeBalance": 3,
  "economic.productivityGrowth": -1.0,
  "economic.rdIntensity": 0.6,
  "economic.propertyValueIndex": 60,
  "economic.commercialValueIndex": 60,
  "economic.ruralRevitalization": 40,
  "economic.foodSecurity": 68,
  "economic.exportDependency": 28,
  "economic.manufacturingCompetitiveness": 50,
  "economic.regulatoryBurden": 75,
  "economic.economicFreedom": 40,
  "education.highSchoolGradRate": 60,
  "education.universityEnrollment": 11,
  "education.apprenticeshipRate": 1.5,
  "education.academicPressure": 45,
  "healthcare.uninsuredRate": 12,
  "healthcare.affordabilityIndex": 45,
  "healthcare.mentalHealthAccess": 22,
  "healthcare.socialCareQuality": 35,
  "healthcare.elderCareQuality": 38,
  "infrastructure.transportEfficiency": 35,
  "publicSafety.antiSocialBehaviourRate": 13,
  "publicSafety.knifeCrimeRate": 6,
  "environment.floodRisk": 15,
  "environment.naturalDisasterPreparedness": 35,
  "environment.nuclearSafety": 50,
  "environment.energyTransitionProgress": 30,
  "social.childPoverty": 40,
  "social.housingAffordability": 35,
  "social.roughSleeping": 6,
  "social.workLifeBalance": 48,
  "social.foreignWorkerIntegration": 48,
  "social.genderEquality": 35,
  "social.housingSupplyGrowth": 1.5,
  "governance.debtToGdp": 50,
  "governance.devolutionSatisfaction": 40,
  "governance.roboticsAdoption": 10,
  "governance.nationalPride": 58,
  "governance.civilLiberties": 58,
  "governance.militaryReadiness": 55,
  "population.demographicDecline": 24,
  "mediaInformation.stateMediaControl": 42,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  NORTE: {
    "economic.rdIntensity": 0.5,
    "economic.propertyValueIndex": 48,
    "economic.manufacturingCompetitiveness": 38,
    "economic.ruralRevitalization": 35,
    "education.highSchoolGradRate": 56,
    "infrastructure.transportEfficiency": 26,
    "social.childPoverty": 48,
    "population.demographicDecline": 20,
  },
  NORDESTE: {
    "economic.rdIntensity": 0.5,
    "economic.propertyValueIndex": 45,
    "economic.manufacturingCompetitiveness": 40,
    "education.highSchoolGradRate": 56,
    "infrastructure.transportEfficiency": 28,
    "social.childPoverty": 48,
    "social.housingAffordability": 32,
    "population.demographicDecline": 22,
  },
  CENTRO_OESTE: {
    "economic.foodSecurity": 72,
    "economic.ruralRevitalization": 50,
    "education.highSchoolGradRate": 60,
    "social.childPoverty": 34,
  },
  SUDESTE: {
    "economic.rdIntensity": 0.9,
    "economic.propertyValueIndex": 80,
    "economic.commercialValueIndex": 82,
    "economic.manufacturingCompetitiveness": 62, // ISI industrial heartland (autos), pre-opening
    "education.highSchoolGradRate": 64,
    "governance.roboticsAdoption": 14,
    "population.demographicDecline": 28,
  },
  SUL: {
    "economic.rdIntensity": 0.8,
    "economic.propertyValueIndex": 72,
    "economic.manufacturingCompetitiveness": 60,
    "economic.foodSecurity": 78,
    "education.highSchoolGradRate": 66,
    "social.childPoverty": 26,
    "population.demographicDecline": 30,
  },
};

export const brMetricPresets1991: MetricPresetBundle = expand(NATIONAL_1991, TILTS_1991);
