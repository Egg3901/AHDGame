/**
 * Per-region, per-era HAND-AUTHORED values for Nigeria's new overhaul ROOT metrics.
 * Consumed via `getRegionMetricPresets` and overlaid by `seedNGStateMetrics` /
 * `seedNGBaselines` AFTER `applyEra1991Adjustments`. The preset is the SINGLE SOURCE OF
 * TRUTH for these metrics in both eras; `uniformMetricDefault` is a fallback only.
 *
 * Only the 2019 bundle is authored (post-1999-Republic Nigeria, oil-dependent middle-
 * income economy). 1991 falls back to the 2019 bundle via `selectPresetBundle` —
 * pre-1999 Nigeria was under military rule and the engine's era adjustments synthesise
 * the era-correct demographic/economic shape without a hand-authored preset.
 */

/** A per-region map of metricPath → numeric value (only the metrics NG authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics Nigeria authors per era — 45 of the 52 uniform paths (IE's 44 plus
 * `environment.nuclearSafety`; Nigeria has no operating reactors but stamps the field for
 * shape parity with BR). No `coDeterminationQuality` (German). Excludes UK-named metrics
 * (gcseAttainment, nhsWaitingTime, bbcTrust), engine-recomputed wageGrowth/tradeGrowth,
 * and birthRate (engine-computed).
 */
export const NG_AUTHORED_METRIC_PATHS = [
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

const NG_REGIONS = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
] as const;

function expand(
  national: Record<string, number>,
  tilts: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    NG_REGIONS.map((region) => [region, { ...national, ...(tilts[region] ?? {}) }])
  );
}

/**
 * 2019 Nigeria — Africa's largest economy by GDP, oil-dependent (NUPRC/NEITI), very young
 * and high-fertility population, severe infrastructure deficits (grid collapse, port
 * congestion), high poverty/inequality, Boko Haram insurgency in the NE, Niger Delta
 * militancy in the SS. `housingAffordability` is a PRESSURE index (lower = better) —
 * high in the Lagos/Abuja metros.
 */
const NATIONAL_2019: Record<string, number> = {
  "economic.laborParticipation": 55,
  "economic.matchingFriction": 7,
  "economic.tradeBalance": 0.5,
  "economic.productivityGrowth": 0.5,
  "economic.rdIntensity": 0.2,
  "economic.propertyValueIndex": 70,
  "economic.commercialValueIndex": 70,
  "economic.ruralRevitalization": 40,
  "economic.foodSecurity": 45,
  "economic.exportDependency": 60,
  "economic.manufacturingCompetitiveness": 30,
  "economic.regulatoryBurden": 75,
  "economic.economicFreedom": 48,
  "education.highSchoolGradRate": 45,
  "education.universityEnrollment": 12,
  "education.apprenticeshipRate": 1.5,
  "education.academicPressure": 55,
  "healthcare.uninsuredRate": 65,
  "healthcare.affordabilityIndex": 40,
  "healthcare.mentalHealthAccess": 20,
  "healthcare.socialCareQuality": 30,
  "healthcare.elderCareQuality": 30,
  "infrastructure.transportEfficiency": 25,
  "publicSafety.antiSocialBehaviourRate": 15,
  "publicSafety.knifeCrimeRate": 4,
  "environment.floodRisk": 20,
  "environment.naturalDisasterPreparedness": 30,
  "environment.nuclearSafety": 50,
  "environment.energyTransitionProgress": 20,
  "social.childPoverty": 45,
  "social.housingAffordability": 50,
  "social.roughSleeping": 8,
  "social.workLifeBalance": 45,
  "social.foreignWorkerIntegration": 30,
  "social.genderEquality": 35,
  "social.housingSupplyGrowth": 1.0,
  "governance.debtToGdp": 38,
  "governance.devolutionSatisfaction": 35,
  "governance.roboticsAdoption": 15,
  "governance.nationalPride": 55,
  "governance.civilLiberties": 45,
  "governance.militaryReadiness": 45,
  "population.demographicDecline": 20,
  "mediaInformation.stateMediaControl": 40,
};

const TILTS_2019: Record<string, Record<string, number>> = {
  // NORTH_WEST — Hausa-Fulani core, largest population, subsistence agriculture, banditry.
  NORTH_WEST: {
    "economic.rdIntensity": 0.1,
    "economic.propertyValueIndex": 55,
    "economic.manufacturingCompetitiveness": 25,
    "economic.ruralRevitalization": 45,
    "economic.foodSecurity": 38,
    "education.highSchoolGradRate": 35,
    "environment.energyTransitionProgress": 15,
    "infrastructure.transportEfficiency": 20,
    "publicSafety.knifeCrimeRate": 5,
    "social.childPoverty": 52,
    "population.demographicDecline": 16,
  },
  // NORTH_EAST — Boko Haram insurgency, IDP crisis, lowest infrastructure/education.
  NORTH_EAST: {
    "economic.rdIntensity": 0.1,
    "economic.propertyValueIndex": 48,
    "economic.manufacturingCompetitiveness": 22,
    "economic.ruralRevitalization": 35,
    "economic.foodSecurity": 28,
    "education.highSchoolGradRate": 30,
    "environment.energyTransitionProgress": 12,
    "infrastructure.transportEfficiency": 15,
    "publicSafety.knifeCrimeRate": 6,
    "social.childPoverty": 60,
    "social.housingAffordability": 45,
    "governance.devolutionSatisfaction": 28,
    "population.demographicDecline": 15,
  },
  // NORTH_CENTRAL — middle-belt swing zone, federal-capital spending, herder-farmer tensions.
  NORTH_CENTRAL: {
    "economic.foodSecurity": 50,
    "economic.ruralRevitalization": 48,
    "economic.manufacturingCompetitiveness": 30,
    "economic.propertyValueIndex": 75,
    "education.highSchoolGradRate": 42,
    "social.childPoverty": 42,
    "population.demographicDecline": 19,
  },
  // SOUTH_WEST — Lagos / Ogun economic engine, APC heartland, best education/infrastructure.
  SOUTH_WEST: {
    "economic.rdIntensity": 0.35,
    "economic.propertyValueIndex": 105,
    "economic.commercialValueIndex": 105,
    "economic.manufacturingCompetitiveness": 42,
    "economic.economicFreedom": 54,
    "economic.foodSecurity": 55,
    "education.highSchoolGradRate": 58,
    "education.universityEnrollment": 18,
    "infrastructure.transportEfficiency": 40,
    "social.housingAffordability": 62,
    "social.childPoverty": 28,
    "governance.roboticsAdoption": 22,
    "population.demographicDecline": 22,
  },
  // SOUTH_SOUTH — Niger Delta oil wealth + gas flaring + militancy.
  SOUTH_SOUTH: {
    "economic.rdIntensity": 0.2,
    "economic.propertyValueIndex": 90,
    "economic.manufacturingCompetitiveness": 32,
    "economic.exportDependency": 80,
    "economic.foodSecurity": 42,
    "environment.energyTransitionProgress": 12,
    "environment.floodRisk": 25,
    "infrastructure.transportEfficiency": 28,
    "publicSafety.knifeCrimeRate": 5,
    "social.childPoverty": 48,
    "population.demographicDecline": 20,
  },
  // SOUTH_EAST — Igbo commercial networks, APGA base, highest small-business formation.
  SOUTH_EAST: {
    "economic.rdIntensity": 0.25,
    "economic.propertyValueIndex": 92,
    "economic.commercialValueIndex": 95,
    "economic.manufacturingCompetitiveness": 40,
    "economic.economicFreedom": 52,
    "economic.ruralRevitalization": 42,
    "education.highSchoolGradRate": 56,
    "education.universityEnrollment": 16,
    "infrastructure.transportEfficiency": 30,
    "social.childPoverty": 32,
    "governance.roboticsAdoption": 20,
    "population.demographicDecline": 22,
  },
};

export const ngMetricPresets2019: MetricPresetBundle = expand(NATIONAL_2019, TILTS_2019);

/**
 * 1991 Nigeria — Babangida military regime mid-Structural-Adjustment-Programme.
 * Pre-Lagos-boom, pre-1999-Republic: oil-mono-economy in a debt crisis (heavy
 * IMF/Paris-Club external debt), SAP austerity and naira devaluation, a younger
 * and more rural population, weaker education/health systems, statist controls,
 * censored press, and military centralisation (low civil liberties / devolution,
 * high military readiness). Regional differentiation is flatter than 2019 — the
 * Lagos/SE commercial booms had not yet pulled the zones apart.
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 52,
  "economic.matchingFriction": 9,
  "economic.tradeBalance": 0,
  "economic.productivityGrowth": -1.0,
  "economic.rdIntensity": 0.1,
  "economic.propertyValueIndex": 40,
  "economic.commercialValueIndex": 40,
  "economic.ruralRevitalization": 35,
  "economic.foodSecurity": 40,
  "economic.exportDependency": 78,
  "economic.manufacturingCompetitiveness": 28,
  "economic.regulatoryBurden": 82,
  "economic.economicFreedom": 38,
  "education.highSchoolGradRate": 32,
  "education.universityEnrollment": 6,
  "education.apprenticeshipRate": 2.0,
  "education.academicPressure": 50,
  "healthcare.uninsuredRate": 82,
  "healthcare.affordabilityIndex": 32,
  "healthcare.mentalHealthAccess": 12,
  "healthcare.socialCareQuality": 22,
  "healthcare.elderCareQuality": 25,
  "infrastructure.transportEfficiency": 20,
  "publicSafety.antiSocialBehaviourRate": 18,
  "publicSafety.knifeCrimeRate": 4,
  "environment.floodRisk": 18,
  "environment.naturalDisasterPreparedness": 22,
  "environment.nuclearSafety": 50,
  "environment.energyTransitionProgress": 8,
  "social.childPoverty": 55,
  "social.housingAffordability": 45,
  "social.roughSleeping": 7,
  "social.workLifeBalance": 48,
  "social.foreignWorkerIntegration": 28,
  "social.genderEquality": 25,
  "social.housingSupplyGrowth": 1.2,
  "governance.debtToGdp": 90,
  "governance.devolutionSatisfaction": 25,
  "governance.roboticsAdoption": 3,
  "governance.nationalPride": 50,
  "governance.civilLiberties": 30,
  "governance.militaryReadiness": 60,
  "population.demographicDecline": 12,
  "mediaInformation.stateMediaControl": 65,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  // NORTH_WEST — Hausa-Fulani core, subsistence agriculture, lowest schooling.
  NORTH_WEST: {
    "economic.propertyValueIndex": 34,
    "economic.foodSecurity": 35,
    "education.highSchoolGradRate": 24,
    "social.childPoverty": 60,
  },
  // NORTH_EAST — remote, lowest infrastructure/education, drought-prone.
  NORTH_EAST: {
    "economic.propertyValueIndex": 30,
    "economic.foodSecurity": 30,
    "education.highSchoolGradRate": 22,
    "infrastructure.transportEfficiency": 14,
    "social.childPoverty": 64,
  },
  // NORTH_CENTRAL — middle belt, new federal capital (Abuja) just established.
  NORTH_CENTRAL: {
    "economic.foodSecurity": 46,
    "education.highSchoolGradRate": 30,
    "social.childPoverty": 50,
  },
  // SOUTH_WEST — Lagos (then-capital region) emerging commercial core.
  SOUTH_WEST: {
    "economic.propertyValueIndex": 58,
    "economic.commercialValueIndex": 58,
    "economic.manufacturingCompetitiveness": 36,
    "economic.economicFreedom": 44,
    "education.highSchoolGradRate": 44,
    "infrastructure.transportEfficiency": 30,
    "social.childPoverty": 40,
  },
  // SOUTH_SOUTH — Niger Delta oil, gas flaring, early militancy grievances.
  SOUTH_SOUTH: {
    "economic.propertyValueIndex": 48,
    "economic.exportDependency": 88,
    "economic.foodSecurity": 38,
    "social.childPoverty": 52,
  },
  // SOUTH_EAST — Igbo commercial networks, post-war recovery, trade.
  SOUTH_EAST: {
    "economic.propertyValueIndex": 50,
    "economic.commercialValueIndex": 56,
    "economic.manufacturingCompetitiveness": 34,
    "education.highSchoolGradRate": 42,
    "social.childPoverty": 42,
  },
};

export const ngMetricPresets1991: MetricPresetBundle = expand(NATIONAL_1991, TILTS_1991);

// NOTE: root-metric presets are authored for both 1991 and 2019. NG demographics
// and state metrics for 1991 are additionally era-shaped by
// `applyEra1991DemographicAdjustments` / `applyEra1991Adjustments` in seedNG, so
// hand-authored 1991 region census/demographics files are not required here.
