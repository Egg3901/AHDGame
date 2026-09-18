/**
 * Per-region, per-era HAND-AUTHORED values for Ireland's new overhaul ROOT metrics
 * (`UNIFORM_METRIC_PATHS`). Consumed via `getRegionMetricPresets`
 * (src/lib/seeds/metricPresets.ts) and overlaid by `seedIEStateMetrics` /
 * `seedIEBaselines` AFTER `applyEra1991Adjustments`, so the preset is the SINGLE SOURCE
 * OF TRUTH for these metrics in both eras. `uniformMetricDefault` is a fallback only.
 *
 * BOTH eras are authored (national baseline + per-region tilts), per the 2026-06-15
 * decision: for these new metrics the seed values are themselves `uniformMetricDefault`
 * formula outputs, so deriving 2019 from the seed just preserved the derived values this
 * work set out to replace. Authoring 2019 changes the formula-derived seed values — live
 * 2019 worlds need a (dry-run-first) backfill migration to match.
 */

/** A per-region map of metricPath → numeric value (only the metrics IE authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics Ireland authors per era — 44 of the 52 uniform paths. Excludes
 * UK/DE-named metrics (gcseAttainment, nhsWaitingTime, bbcTrust, coDeterminationQuality),
 * nuclearSafety (IE has no nuclear power), the engine-recomputed wageGrowth/tradeGrowth
 * (cold-start only), and population.birthRate (era-authored via the population anchors).
 */
export const IE_AUTHORED_METRIC_PATHS = [
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

const IE_REGIONS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"] as const;

function expand(
  national: Record<string, number>,
  tilts: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    IE_REGIONS.map((region) => [region, { ...national, ...(tilts[region] ?? {}) }])
  );
}

/**
 * 2019 Ireland — post-recovery open economy: MNC-driven exports/R&D, near-universal
 * tertiary education, a severe housing crisis (high pressure index), liberal social order
 * (post-2015 marriage-equality / 2018 abortion reform), militarily neutral. `housingAffordability`
 * is a PRESSURE index (lower = better); Ireland's crisis means it is HIGH — the old formula
 * default (~28) understated it badly, which is exactly why 2019 is now authored.
 */
const NATIONAL_2019: Record<string, number> = {
  "economic.laborParticipation": 73,
  "economic.matchingFriction": 2.2,
  "economic.tradeBalance": 11.5,
  "economic.productivityGrowth": 2.4,
  "economic.rdIntensity": 1.6,
  "economic.propertyValueIndex": 110,
  "economic.commercialValueIndex": 108,
  "economic.ruralRevitalization": 52,
  "economic.foodSecurity": 72,
  "economic.exportDependency": 58,
  "economic.manufacturingCompetitiveness": 76,
  "economic.regulatoryBurden": 44,
  "economic.economicFreedom": 76,
  "education.highSchoolGradRate": 92,
  "education.universityEnrollment": 50,
  "education.apprenticeshipRate": 3.0,
  "education.academicPressure": 56,
  "healthcare.uninsuredRate": 8,
  "healthcare.affordabilityIndex": 60,
  "healthcare.mentalHealthAccess": 58,
  "healthcare.socialCareQuality": 56,
  "healthcare.elderCareQuality": 60,
  "infrastructure.transportEfficiency": 50,
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 2.5,
  "environment.floodRisk": 13,
  "environment.naturalDisasterPreparedness": 60,
  "environment.energyTransitionProgress": 46,
  "social.childPoverty": 16,
  "social.housingAffordability": 70, // pressure index, lower = better; IE crisis → HIGH
  "social.roughSleeping": 4,
  "social.workLifeBalance": 62,
  "social.foreignWorkerIntegration": 58,
  "social.genderEquality": 68,
  "social.housingSupplyGrowth": 1.5,
  "governance.debtToGdp": 43,
  "governance.devolutionSatisfaction": 45,
  "governance.roboticsAdoption": 55,
  "governance.nationalPride": 70,
  "governance.civilLiberties": 82,
  "governance.militaryReadiness": 28, // militarily neutral, small defence forces
  "population.demographicDecline": 30, // young by EU standards, still growing
  "mediaInformation.stateMediaControl": 25, // free press; RTÉ public but independent
};

const TILTS_2019: Record<string, Record<string, number>> = {
  // Dublin — capital, MNC/tech hub, worst housing pressure.
  DUB: {
    "economic.laborParticipation": 74,
    "economic.rdIntensity": 2.6,
    "economic.propertyValueIndex": 150,
    "economic.commercialValueIndex": 145,
    "economic.ruralRevitalization": 65,
    "economic.foodSecurity": 60,
    "economic.exportDependency": 60,
    "economic.manufacturingCompetitiveness": 78,
    "economic.economicFreedom": 78,
    "education.universityEnrollment": 56,
    "infrastructure.transportEfficiency": 68,
    "publicSafety.antiSocialBehaviourRate": 7,
    "publicSafety.knifeCrimeRate": 3.5,
    "social.childPoverty": 17,
    "social.housingAffordability": 88,
    "social.roughSleeping": 7,
    "social.foreignWorkerIntegration": 62,
    "social.genderEquality": 70,
    "social.housingSupplyGrowth": 2.0,
    "governance.roboticsAdoption": 58,
    "population.demographicDecline": 24,
  },
  // Kildare / commuter belt.
  KIL: {
    "economic.rdIntensity": 1.8,
    "economic.propertyValueIndex": 120,
    "social.childPoverty": 13,
    "social.housingAffordability": 75,
    "population.demographicDecline": 26,
  },
  // Midlands — rural, agricultural; Shannon callows flood exposure.
  MID: {
    "economic.rdIntensity": 1.0,
    "economic.propertyValueIndex": 80,
    "economic.ruralRevitalization": 45,
    "economic.foodSecurity": 78,
    "economic.manufacturingCompetitiveness": 68,
    "environment.floodRisk": 18,
    "infrastructure.transportEfficiency": 38,
    "social.childPoverty": 18,
    "social.housingAffordability": 55,
    "governance.roboticsAdoption": 48,
    "population.demographicDecline": 34,
  },
  // Wexford / South-East — rural agricultural.
  WEX: {
    "economic.rdIntensity": 1.0,
    "economic.propertyValueIndex": 85,
    "economic.ruralRevitalization": 46,
    "economic.foodSecurity": 77,
    "economic.manufacturingCompetitiveness": 68,
    "infrastructure.transportEfficiency": 40,
    "social.childPoverty": 18,
    "social.housingAffordability": 56,
    "population.demographicDecline": 33,
  },
  // Limerick / Mid-West — Shannon industrial, growing renewables.
  LIM: {
    "economic.rdIntensity": 1.6,
    "economic.propertyValueIndex": 95,
    "economic.exportDependency": 60,
    "economic.manufacturingCompetitiveness": 80,
    "education.apprenticeshipRate": 3.8,
    "environment.energyTransitionProgress": 52,
    "publicSafety.antiSocialBehaviourRate": 6,
    "publicSafety.knifeCrimeRate": 3,
    "social.housingAffordability": 62,
    "governance.roboticsAdoption": 58,
  },
  // Cork — second city, pharma/med-tech cluster.
  COR: {
    "economic.rdIntensity": 2.2,
    "economic.propertyValueIndex": 115,
    "economic.commercialValueIndex": 112,
    "economic.exportDependency": 62,
    "economic.manufacturingCompetitiveness": 82,
    "economic.economicFreedom": 78,
    "education.universityEnrollment": 54,
    "social.childPoverty": 15,
    "social.housingAffordability": 72,
    "governance.roboticsAdoption": 58,
    "population.demographicDecline": 27,
  },
  // Galway / West — Gaeltacht, university town, strong wind resource.
  GAL: {
    "economic.rdIntensity": 1.2,
    "economic.propertyValueIndex": 88,
    "economic.ruralRevitalization": 45,
    "economic.foodSecurity": 78,
    "economic.manufacturingCompetitiveness": 66,
    "education.universityEnrollment": 52,
    "environment.floodRisk": 17,
    "environment.energyTransitionProgress": 62,
    "infrastructure.transportEfficiency": 40,
    "social.childPoverty": 18,
    "social.housingAffordability": 60,
    "population.demographicDecline": 33,
  },
  // Donegal / Border — poorest, most rural, high wind resource.
  DON: {
    "economic.rdIntensity": 0.9,
    "economic.propertyValueIndex": 70,
    "economic.ruralRevitalization": 40,
    "economic.foodSecurity": 76,
    "economic.manufacturingCompetitiveness": 60,
    "economic.economicFreedom": 72,
    "education.universityEnrollment": 42,
    "environment.floodRisk": 16,
    "environment.naturalDisasterPreparedness": 55,
    "environment.energyTransitionProgress": 55,
    "infrastructure.transportEfficiency": 35,
    "social.childPoverty": 22,
    "social.housingAffordability": 52,
    "governance.devolutionSatisfaction": 40,
    "population.demographicDecline": 38,
  },
};

export const ieMetricPresets2019: MetricPresetBundle = expand(NATIONAL_2019, TILTS_2019);

/**
 * 1991 Ireland — pre-Celtic-Tiger (boom began ~1994). High unemployment (~15%),
 * debt/GDP ~95%, heavy emigration, agricultural, Catholic-conservative social order
 * (divorce banned until 1995, homosexuality criminalized until 1993, RTÉ Section 31
 * broadcasting ban until 1994), nascent renewables, minimal FDI/R&D.
 *
 * Grounded in documented national/regional historical context (CSO, ESRI historical
 * series, SEAI energy history, pre-Tiger macro); where no regional series exists, the
 * value is the national 1991 figure with a documented structural tilt (urban/rural,
 * east/west, border). All values sit inside their metricDefinition bounds.
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 60,
  "economic.matchingFriction": 8,
  "economic.tradeBalance": 3,
  "economic.productivityGrowth": 1.0,
  "economic.rdIntensity": 0.8,
  "economic.propertyValueIndex": 50,
  "economic.commercialValueIndex": 50,
  "economic.ruralRevitalization": 40,
  "economic.foodSecurity": 70,
  "economic.exportDependency": 40,
  "economic.manufacturingCompetitiveness": 55,
  "economic.regulatoryBurden": 58,
  "economic.economicFreedom": 55,
  "education.highSchoolGradRate": 75,
  "education.universityEnrollment": 20,
  "education.apprenticeshipRate": 3.0,
  "education.academicPressure": 55,
  "healthcare.uninsuredRate": 10,
  "healthcare.affordabilityIndex": 55,
  "healthcare.mentalHealthAccess": 35,
  "healthcare.socialCareQuality": 45,
  "healthcare.elderCareQuality": 48,
  "infrastructure.transportEfficiency": 40,
  "publicSafety.antiSocialBehaviourRate": 6,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 14,
  "environment.naturalDisasterPreparedness": 40,
  "environment.energyTransitionProgress": 8,
  "social.childPoverty": 28,
  "social.housingAffordability": 30, // pressure index, lower = better; 1991 was affordable
  "social.roughSleeping": 3,
  "social.workLifeBalance": 60,
  "social.foreignWorkerIntegration": 35,
  "social.genderEquality": 40,
  "social.housingSupplyGrowth": 1.5,
  "governance.debtToGdp": 95,
  "governance.devolutionSatisfaction": 45,
  "governance.roboticsAdoption": 15,
  "governance.nationalPride": 60,
  "governance.civilLiberties": 58,
  "governance.militaryReadiness": 30, // militarily neutral state, small defence forces
  "population.demographicDecline": 25, // young, growing population → low decline
  "mediaInformation.stateMediaControl": 40, // RTÉ monopoly + Section 31 broadcasting ban
};

/** Per-region 1991 deltas from NATIONAL_1991; unlisted metrics inherit the national value. */
const TILTS_1991: Record<string, Record<string, number>> = {
  // Dublin — urban core, highest income/services/R&D, priciest housing.
  DUB: {
    "economic.laborParticipation": 63,
    "economic.matchingFriction": 7,
    "economic.productivityGrowth": 1.5,
    "economic.rdIntensity": 1.2,
    "economic.propertyValueIndex": 65,
    "economic.commercialValueIndex": 68,
    "economic.ruralRevitalization": 55,
    "economic.foodSecurity": 60,
    "economic.exportDependency": 42,
    "economic.manufacturingCompetitiveness": 58,
    "education.highSchoolGradRate": 80,
    "education.universityEnrollment": 28,
    "education.apprenticeshipRate": 3.5,
    "education.academicPressure": 60,
    "healthcare.uninsuredRate": 8,
    "healthcare.affordabilityIndex": 58,
    "healthcare.mentalHealthAccess": 42,
    "healthcare.socialCareQuality": 50,
    "healthcare.elderCareQuality": 52,
    "infrastructure.transportEfficiency": 50,
    "publicSafety.antiSocialBehaviourRate": 9,
    "publicSafety.knifeCrimeRate": 3,
    "environment.floodRisk": 12,
    "environment.naturalDisasterPreparedness": 45,
    "social.childPoverty": 26,
    "social.housingAffordability": 42,
    "social.roughSleeping": 5,
    "social.workLifeBalance": 55,
    "social.foreignWorkerIntegration": 40,
    "social.genderEquality": 45,
    "social.housingSupplyGrowth": 2,
    "governance.roboticsAdoption": 18,
    "population.demographicDecline": 20,
  },
  // Kildare / Leinster commuter belt.
  KIL: {
    "economic.laborParticipation": 61,
    "economic.matchingFriction": 7,
    "economic.rdIntensity": 0.7,
    "economic.propertyValueIndex": 55,
    "economic.commercialValueIndex": 52,
    "economic.ruralRevitalization": 48,
    "education.highSchoolGradRate": 78,
    "social.childPoverty": 22,
    "social.housingAffordability": 35,
    "social.housingSupplyGrowth": 2,
    "population.demographicDecline": 22,
  },
  // Midlands — rural, agricultural; Shannon callows flood exposure.
  MID: {
    "economic.laborParticipation": 58,
    "economic.matchingFriction": 9,
    "economic.rdIntensity": 0.5,
    "economic.propertyValueIndex": 44,
    "economic.commercialValueIndex": 44,
    "economic.ruralRevitalization": 36,
    "economic.foodSecurity": 74,
    "economic.manufacturingCompetitiveness": 48,
    "education.universityEnrollment": 16,
    "environment.floodRisk": 18,
    "infrastructure.transportEfficiency": 33,
    "social.childPoverty": 30,
    "social.housingAffordability": 26,
    "population.demographicDecline": 27,
  },
  // Wexford / South-East — rural agricultural.
  WEX: {
    "economic.laborParticipation": 58,
    "economic.matchingFriction": 9,
    "economic.rdIntensity": 0.5,
    "economic.propertyValueIndex": 46,
    "economic.commercialValueIndex": 46,
    "economic.ruralRevitalization": 37,
    "economic.foodSecurity": 73,
    "economic.manufacturingCompetitiveness": 50,
    "education.universityEnrollment": 17,
    "infrastructure.transportEfficiency": 33,
    "social.childPoverty": 30,
    "social.housingAffordability": 27,
    "population.demographicDecline": 26,
  },
  // Limerick / Mid-West — Shannon industrial, Ardnacrusha hydro legacy.
  LIM: {
    "economic.matchingFriction": 8,
    "economic.rdIntensity": 0.9,
    "economic.propertyValueIndex": 48,
    "economic.commercialValueIndex": 50,
    "economic.ruralRevitalization": 42,
    "economic.exportDependency": 45,
    "economic.manufacturingCompetitiveness": 62,
    "education.apprenticeshipRate": 4.0,
    "publicSafety.antiSocialBehaviourRate": 8,
    "publicSafety.knifeCrimeRate": 3,
    "environment.energyTransitionProgress": 10,
    "social.childPoverty": 27,
    "governance.roboticsAdoption": 20,
  },
  // Cork — second city, emerging pharma/industry.
  COR: {
    "economic.laborParticipation": 61,
    "economic.matchingFriction": 7,
    "economic.productivityGrowth": 1.5,
    "economic.rdIntensity": 1.0,
    "economic.propertyValueIndex": 52,
    "economic.commercialValueIndex": 55,
    "economic.exportDependency": 48,
    "economic.manufacturingCompetitiveness": 60,
    "education.highSchoolGradRate": 78,
    "education.universityEnrollment": 25,
    "social.childPoverty": 25,
    "social.housingAffordability": 32,
    "social.roughSleeping": 3,
    "governance.roboticsAdoption": 18,
    "population.demographicDecline": 23,
  },
  // Galway / West — Gaeltacht, rural, early western wind potential, university town.
  GAL: {
    "economic.laborParticipation": 57,
    "economic.matchingFriction": 9,
    "economic.rdIntensity": 0.6,
    "economic.propertyValueIndex": 42,
    "economic.commercialValueIndex": 42,
    "economic.ruralRevitalization": 35,
    "economic.foodSecurity": 75,
    "economic.manufacturingCompetitiveness": 48,
    "education.universityEnrollment": 26,
    "environment.floodRisk": 17,
    "environment.energyTransitionProgress": 12,
    "infrastructure.transportEfficiency": 32,
    "social.childPoverty": 32,
    "social.housingAffordability": 24,
    "population.demographicDecline": 28,
  },
  // Donegal / Border — poorest, highest unemployment, most agricultural.
  DON: {
    "economic.laborParticipation": 55,
    "economic.matchingFriction": 10,
    "economic.productivityGrowth": 0.5,
    "economic.rdIntensity": 0.4,
    "economic.propertyValueIndex": 40,
    "economic.commercialValueIndex": 40,
    "economic.ruralRevitalization": 33,
    "economic.foodSecurity": 74,
    "economic.manufacturingCompetitiveness": 45,
    "education.highSchoolGradRate": 68,
    "education.universityEnrollment": 15,
    "environment.floodRisk": 16,
    "environment.naturalDisasterPreparedness": 35,
    "infrastructure.transportEfficiency": 30,
    "social.childPoverty": 35,
    "social.housingAffordability": 22,
    "governance.devolutionSatisfaction": 40,
    "population.demographicDecline": 30,
  },
};

export const ieMetricPresets1991: MetricPresetBundle = expand(NATIONAL_1991, TILTS_1991);
