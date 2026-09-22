/**
 * Per-region, per-era HAND-AUTHORED values for China's new overhaul ROOT metrics.
 * Consumed via `getRegionMetricPresets` and overlaid by `seedCNStateMetrics` /
 * `seedCNBaselines` AFTER `applyEra1991Adjustments`. The preset is the SINGLE SOURCE OF
 * TRUTH for these metrics in both eras; `uniformMetricDefault` is a fallback only. (The
 * CN-specific era fields — socialCreditCoverage, hukouMobility, partyDiscipline, … — are
 * handled by applyEra1991Adjustments and are not in this set, so the two compose cleanly.)
 *
 * BOTH eras are authored, per the 2026-06-15 decision. 2019 = the developed coastal-vs-
 * interior China of the seed era; 1991 = early Deng-era reform, post-Tiananmen retrenchment
 * (the 1992 Southern Tour had not yet re-accelerated reform), pre-WTO/pre-Belt-and-Road/
 * pre-social-credit: overwhelmingly rural and poor, state-allocated (danwei) housing with no
 * private property market, near-zero R&D/robotics, coal-only energy, very low public debt,
 * but a strong Mao-era female-workforce legacy and near-total state media control.
 */

/** A per-region map of metricPath → numeric value (only the metrics CN authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics China authors per era — 45 of the 52 uniform paths (IE's 44 plus
 * `environment.nuclearSafety`; China runs a large, expanding nuclear program). No
 * `coDeterminationQuality` (German). Excludes UK-named metrics, engine-recomputed
 * wageGrowth/tradeGrowth, and population.birthRate.
 */
export const CN_AUTHORED_METRIC_PATHS = [
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

const CN_REGIONS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] as const;

function expand(
  national: Record<string, number>,
  tilts: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    CN_REGIONS.map((region) => [region, { ...national, ...(tilts[region] ?? {}) }])
  );
}

/**
 * 2019 China — the world's manufacturing leader and largest robot market, world-class HSR,
 * massive higher-education expansion, extreme gaokao pressure and "996" overwork, a tier-1
 * property bubble (`housingAffordability` is a PRESSURE index, lower = better — the formula
 * default badly understated tier-1 unaffordability), authoritarian governance, and a heavily
 * controlled information space. `laborParticipation` capped at the metric's 75 ceiling.
 */
const NATIONAL_2019: Record<string, number> = {
  "economic.laborParticipation": 75,
  "economic.matchingFriction": 3.2,
  "economic.tradeBalance": 2.5,
  "economic.productivityGrowth": 3.0,
  "economic.rdIntensity": 2.4,
  "economic.propertyValueIndex": 120,
  "economic.commercialValueIndex": 115,
  "economic.ruralRevitalization": 45,
  "economic.foodSecurity": 75,
  "economic.exportDependency": 35,
  "economic.manufacturingCompetitiveness": 88,
  "economic.regulatoryBurden": 60,
  "economic.economicFreedom": 50,
  "education.highSchoolGradRate": 88,
  "education.universityEnrollment": 50,
  "education.apprenticeshipRate": 3.0,
  "education.academicPressure": 90,
  "healthcare.uninsuredRate": 4,
  "healthcare.affordabilityIndex": 55,
  "healthcare.mentalHealthAccess": 42,
  "healthcare.socialCareQuality": 50,
  "healthcare.elderCareQuality": 48,
  "infrastructure.transportEfficiency": 80,
  "publicSafety.antiSocialBehaviourRate": 4,
  "publicSafety.knifeCrimeRate": 1.5,
  "environment.floodRisk": 18,
  "environment.naturalDisasterPreparedness": 70,
  "environment.nuclearSafety": 70,
  "environment.energyTransitionProgress": 55,
  "social.childPoverty": 12,
  "social.housingAffordability": 60,
  "social.roughSleeping": 2,
  "social.workLifeBalance": 35,
  "social.foreignWorkerIntegration": 25,
  "social.genderEquality": 55,
  "social.housingSupplyGrowth": 2.2,
  "governance.debtToGdp": 83,
  "governance.devolutionSatisfaction": 55,
  "governance.roboticsAdoption": 65,
  "governance.nationalPride": 80,
  "governance.civilLiberties": 25,
  "governance.militaryReadiness": 70,
  "population.demographicDecline": 50,
  "mediaInformation.stateMediaControl": 85,
};

const TILTS_2019: Record<string, Record<string, number>> = {
  // Dongbei — aging rust belt, declining heavy industry, worst out-migration.
  DB: {
    "economic.rdIntensity": 1.8,
    "economic.manufacturingCompetitiveness": 70,
    "economic.propertyValueIndex": 70,
    "economic.ruralRevitalization": 40,
    "environment.energyTransitionProgress": 45,
    "infrastructure.transportEfficiency": 70,
    "social.childPoverty": 15,
    "population.demographicDecline": 65,
  },
  // Huabei — Beijing/Tianjin: capital, R&D, tightest control.
  HB: {
    "economic.rdIntensity": 3.4,
    "economic.propertyValueIndex": 180,
    "economic.commercialValueIndex": 175,
    "education.academicPressure": 95,
    "infrastructure.transportEfficiency": 85,
    "environment.floodRisk": 12,
    "social.housingAffordability": 80,
    "governance.civilLiberties": 22,
    "population.demographicDecline": 52,
    "mediaInformation.stateMediaControl": 90,
  },
  // Huadong — Shanghai/Yangtze: richest, highest property bubble.
  HD: {
    "economic.rdIntensity": 3.5,
    "economic.propertyValueIndex": 200,
    "economic.commercialValueIndex": 190,
    "economic.manufacturingCompetitiveness": 92,
    "economic.economicFreedom": 58,
    "education.universityEnrollment": 60,
    "education.academicPressure": 95,
    "infrastructure.transportEfficiency": 92,
    "social.housingAffordability": 85,
    "governance.roboticsAdoption": 75,
    "population.demographicDecline": 55,
  },
  // Huazhong — central, mid-tier industrial.
  HZ: {
    "economic.rdIntensity": 2.0,
    "economic.manufacturingCompetitiveness": 82,
    "economic.propertyValueIndex": 90,
    "infrastructure.transportEfficiency": 75,
  },
  // Huanan — Guangdong/Pearl River: manufacturing/tech powerhouse (Shenzhen).
  HN: {
    "economic.rdIntensity": 3.2,
    "economic.manufacturingCompetitiveness": 95,
    "economic.propertyValueIndex": 175,
    "economic.economicFreedom": 60,
    "economic.exportDependency": 45,
    "environment.energyTransitionProgress": 50,
    "infrastructure.transportEfficiency": 85,
    "social.housingAffordability": 82,
    "governance.roboticsAdoption": 78,
  },
  // Xinan — hydropower-rich southwest, poorer interior.
  XN: {
    "economic.rdIntensity": 1.8,
    "economic.manufacturingCompetitiveness": 72,
    "economic.propertyValueIndex": 75,
    "economic.ruralRevitalization": 42,
    "economic.foodSecurity": 70,
    "environment.energyTransitionProgress": 75,
    "social.childPoverty": 16,
  },
  // Xibei — arid northwest, Gobi solar/wind, poorest interior.
  XB: {
    "economic.rdIntensity": 1.6,
    "economic.manufacturingCompetitiveness": 65,
    "economic.propertyValueIndex": 65,
    "economic.ruralRevitalization": 38,
    "economic.foodSecurity": 68,
    "environment.energyTransitionProgress": 70,
    "infrastructure.transportEfficiency": 68,
    "social.childPoverty": 18,
    "population.demographicDecline": 45,
  },
};

export const cnMetricPresets2019: MetricPresetBundle = expand(NATIONAL_2019, TILTS_2019);

/**
 * 1991 China — early Deng-era reform, the year of post-Tiananmen retrenchment before the
 * 1992 Southern Tour re-accelerated "reform and opening". Per-capita GDP a small fraction of
 * today's; overwhelmingly rural (~26% urban); housing state-allocated through the danwei (no
 * private property market — a very low value index); near-zero R&D and almost no industrial
 * robotics; coal-only energy; very low public debt under the residual planned economy; a
 * strong Mao-era female-workforce legacy; and near-total state media control. The coastal SEZs
 * (Shenzhen/Shanghai) already pulling ahead of the agrarian interior.
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 72,
  "economic.matchingFriction": 4,
  "economic.tradeBalance": 1,
  "economic.productivityGrowth": 3.5,
  "economic.rdIntensity": 0.7,
  "economic.propertyValueIndex": 30,
  "economic.commercialValueIndex": 35,
  "economic.ruralRevitalization": 40,
  "economic.foodSecurity": 70,
  "economic.exportDependency": 20,
  "economic.manufacturingCompetitiveness": 45,
  "economic.regulatoryBurden": 80,
  "economic.economicFreedom": 30,
  "education.highSchoolGradRate": 55,
  "education.universityEnrollment": 5,
  "education.apprenticeshipRate": 3.0,
  "education.academicPressure": 80,
  "healthcare.uninsuredRate": 15,
  "healthcare.affordabilityIndex": 50,
  "healthcare.mentalHealthAccess": 15,
  "healthcare.socialCareQuality": 35,
  "healthcare.elderCareQuality": 40,
  "infrastructure.transportEfficiency": 30,
  "publicSafety.antiSocialBehaviourRate": 4,
  "publicSafety.knifeCrimeRate": 1.5,
  "environment.floodRisk": 20,
  "environment.naturalDisasterPreparedness": 40,
  "environment.nuclearSafety": 55,
  "environment.energyTransitionProgress": 5,
  "social.childPoverty": 35,
  "social.housingAffordability": 25, // danwei-allocated housing, no private market
  "social.roughSleeping": 3,
  "social.workLifeBalance": 45,
  "social.foreignWorkerIntegration": 20,
  "social.genderEquality": 60, // strong Mao-era "women hold up half the sky" legacy
  "social.housingSupplyGrowth": 2.0,
  "governance.debtToGdp": 25,
  "governance.devolutionSatisfaction": 50,
  "governance.roboticsAdoption": 5,
  "governance.nationalPride": 70,
  "governance.civilLiberties": 18, // post-Tiananmen crackdown
  "governance.militaryReadiness": 55,
  "population.demographicDecline": 22, // young population (one-child policy still recent)
  "mediaInformation.stateMediaControl": 88,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  // Huadong — Shanghai already a relative industrial/education hub.
  HD: {
    "economic.rdIntensity": 1.0,
    "economic.manufacturingCompetitiveness": 55,
    "economic.propertyValueIndex": 45,
    "economic.economicFreedom": 40,
    "infrastructure.transportEfficiency": 40,
  },
  // Huanan — Shenzhen SEZ: the leading edge of "reform and opening".
  HN: {
    "economic.rdIntensity": 0.9,
    "economic.manufacturingCompetitiveness": 55,
    "economic.propertyValueIndex": 50,
    "economic.economicFreedom": 45,
    "economic.exportDependency": 35,
  },
  // Huabei — Beijing institutes; capital control.
  HB: {
    "economic.rdIntensity": 1.0,
    "economic.propertyValueIndex": 45,
    "mediaInformation.stateMediaControl": 90,
  },
  // Dongbei — the planned-economy heavy-industry heartland (relatively strong in 1991).
  DB: {
    "economic.manufacturingCompetitiveness": 60,
    "economic.rdIntensity": 0.9,
    "infrastructure.transportEfficiency": 35,
  },
  // Xibei — poorest, most agrarian interior.
  XB: {
    "economic.manufacturingCompetitiveness": 38,
    "education.highSchoolGradRate": 55,
    "social.childPoverty": 42,
  },
};

export const cnMetricPresets1991: MetricPresetBundle = expand(NATIONAL_1991, TILTS_1991);
