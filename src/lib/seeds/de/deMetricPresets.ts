/**
 * Per-region, per-era HAND-AUTHORED values for Germany's new overhaul ROOT metrics
 * (`UNIFORM_METRIC_PATHS`). Consumed via `getRegionMetricPresets`
 * (src/lib/seeds/metricPresets.ts) and overlaid by `seedDEStateMetrics` / `seedDEBaselines`
 * AFTER `applyEra1991Adjustments`, so the preset is the SINGLE SOURCE OF TRUTH for these
 * metrics in both eras. `uniformMetricDefault` is a fallback only.
 *
 * BOTH eras are authored (national baseline + East/West archetype + per-Land tilts), per the
 * 2026-06-15 decision. 2019 = post-Wende unified Germany; 1991 = the immediate
 * post-reunification year (Aufbau Ost beginning, Treuhand deindustrialization of the East,
 * pre-Euro/pre-Schuldenbremse/pre-Maastricht, nuclear power active, Energiewende not yet begun).
 */

/** A per-region map of metricPath → numeric value (only the metrics DE authors). */
export type MetricPresetBundle = Record<string, Record<string, number>>;

/**
 * The new ROOT metrics Germany authors per era — 46 of the 52 uniform paths. Adds
 * `governance.coDeterminationQuality` (Mitbestimmung) and `environment.nuclearSafety`
 * (Germany ran significant nuclear power, incl. the East's Soviet-design Greifswald plant)
 * to IE's 44. Excludes UK-named metrics (gcseAttainment, nhsWaitingTime, bbcTrust), the
 * engine-recomputed wageGrowth/tradeGrowth, and population.birthRate (population-anchor owned).
 */
export const DE_AUTHORED_METRIC_PATHS = [
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
  "governance.coDeterminationQuality",
  "governance.nationalPride",
  "governance.civilLiberties",
  "governance.militaryReadiness",
  "population.demographicDecline",
  "mediaInformation.stateMediaControl",
] as const;

const DE_REGIONS = [
  "BW",
  "BY",
  "NW",
  "HE",
  "RP",
  "SL",
  "NI",
  "SH",
  "HH",
  "BRE",
  "BE",
  "BB",
  "MV",
  "SN",
  "ST",
  "TH",
] as const;

/** Former-GDR Länder (Berlin treated as its own mixed city-state, not part of the bloc). */
const EAST_REGIONS = new Set(["BB", "MV", "SN", "ST", "TH"]);

function expand(
  national: Record<string, number>,
  east: Record<string, number>,
  tilts: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    DE_REGIONS.map((region) => {
      const base = EAST_REGIONS.has(region) ? { ...national, ...east } : { ...national };
      return [region, { ...base, ...(tilts[region] ?? {}) }];
    })
  );
}

/**
 * 2019 Germany — high-productivity export economy, strong dual-education + Mitbestimmung,
 * Energiewende mid-rollout, severe demographic aging, nuclear phase-out in its final years
 * (last reactors closed 2023). `laborParticipation` capped at the metric's 75 ceiling.
 * `housingAffordability` is a PRESSURE index (lower = better) — high in the big cities.
 */
const NATIONAL_2019: Record<string, number> = {
  "economic.laborParticipation": 74,
  "economic.matchingFriction": 2.5,
  "economic.tradeBalance": 6.5,
  "economic.productivityGrowth": 1.1,
  "economic.rdIntensity": 3.1,
  "economic.propertyValueIndex": 115,
  "economic.commercialValueIndex": 112,
  "economic.ruralRevitalization": 55,
  "economic.foodSecurity": 68,
  "economic.exportDependency": 47,
  "economic.manufacturingCompetitiveness": 78,
  "economic.regulatoryBurden": 58,
  "economic.economicFreedom": 65,
  "education.highSchoolGradRate": 86,
  "education.universityEnrollment": 50,
  "education.apprenticeshipRate": 4.5,
  "education.academicPressure": 52,
  "healthcare.uninsuredRate": 1,
  "healthcare.affordabilityIndex": 78,
  "healthcare.mentalHealthAccess": 62,
  "healthcare.socialCareQuality": 68,
  "healthcare.elderCareQuality": 66,
  "infrastructure.transportEfficiency": 70,
  "publicSafety.antiSocialBehaviourRate": 7,
  "publicSafety.knifeCrimeRate": 2.5,
  "environment.floodRisk": 13,
  "environment.naturalDisasterPreparedness": 68,
  "environment.nuclearSafety": 75,
  "environment.energyTransitionProgress": 55,
  "social.childPoverty": 15,
  "social.housingAffordability": 55,
  "social.roughSleeping": 3,
  "social.workLifeBalance": 72,
  "social.foreignWorkerIntegration": 58,
  "social.genderEquality": 70,
  "social.housingSupplyGrowth": 1.5,
  "governance.debtToGdp": 66,
  "governance.devolutionSatisfaction": 68,
  "governance.roboticsAdoption": 72,
  "governance.coDeterminationQuality": 72,
  "governance.nationalPride": 58,
  "governance.civilLiberties": 82,
  "governance.militaryReadiness": 55,
  "population.demographicDecline": 52,
  "mediaInformation.stateMediaControl": 25,
};

/** 2019 East deltas — still converging: lower R&D/robotics/manufacturing + property, severe
 * demographic decline (out-migration + aging), but the highest wind-energy transition and a
 * persistent female-workforce legacy (gender equality at/above the West). */
const EAST_2019: Record<string, number> = {
  "economic.laborParticipation": 73,
  "economic.rdIntensity": 2.0,
  "economic.propertyValueIndex": 75,
  "economic.commercialValueIndex": 72,
  "economic.exportDependency": 38,
  "economic.manufacturingCompetitiveness": 62,
  "economic.economicFreedom": 60,
  "education.highSchoolGradRate": 85,
  "infrastructure.transportEfficiency": 62,
  "environment.energyTransitionProgress": 70,
  "social.childPoverty": 18,
  "social.housingAffordability": 45,
  "social.foreignWorkerIntegration": 45,
  "social.genderEquality": 72,
  "governance.devolutionSatisfaction": 62,
  "governance.roboticsAdoption": 58,
  "governance.coDeterminationQuality": 65,
  "governance.nationalPride": 52,
  "population.demographicDecline": 65,
};

const TILTS_2019: Record<string, Record<string, number>> = {
  BW: {
    "economic.rdIntensity": 3.8,
    "economic.manufacturingCompetitiveness": 86,
    "economic.propertyValueIndex": 135,
    "economic.commercialValueIndex": 130,
    "economic.economicFreedom": 68,
    "economic.exportDependency": 55,
    "education.highSchoolGradRate": 90,
    "social.childPoverty": 11,
    "social.housingAffordability": 62,
    "governance.roboticsAdoption": 82,
    "governance.coDeterminationQuality": 80,
    "population.demographicDecline": 46,
    "environment.energyTransitionProgress": 52,
  },
  BY: {
    "economic.rdIntensity": 3.6,
    "economic.manufacturingCompetitiveness": 85,
    "economic.propertyValueIndex": 130,
    "economic.commercialValueIndex": 128,
    "economic.economicFreedom": 68,
    "economic.exportDependency": 53,
    "education.highSchoolGradRate": 90,
    "social.childPoverty": 11,
    "social.housingAffordability": 60,
    "governance.roboticsAdoption": 80,
    "governance.coDeterminationQuality": 78,
    "population.demographicDecline": 46,
    "environment.energyTransitionProgress": 58,
  },
  NW: {
    "economic.rdIntensity": 3.0,
    "economic.manufacturingCompetitiveness": 76,
    "economic.propertyValueIndex": 105,
    "social.childPoverty": 19,
    "social.housingAffordability": 55,
    "governance.roboticsAdoption": 72,
    "environment.energyTransitionProgress": 40,
    "population.demographicDecline": 50,
  },
  HE: {
    "economic.rdIntensity": 3.2,
    "economic.propertyValueIndex": 130,
    "economic.commercialValueIndex": 135,
    "economic.economicFreedom": 70,
    "economic.exportDependency": 48,
    "social.housingAffordability": 62,
  },
  RP: {
    "economic.manufacturingCompetitiveness": 76,
    "environment.energyTransitionProgress": 54,
  },
  SL: {
    "economic.manufacturingCompetitiveness": 68,
    "environment.energyTransitionProgress": 45,
    "population.demographicDecline": 60,
  },
  NI: {
    "economic.manufacturingCompetitiveness": 80,
    "economic.ruralRevitalization": 55,
    "environment.energyTransitionProgress": 65,
    "environment.nuclearSafety": 72,
    "governance.roboticsAdoption": 76,
  },
  SH: {
    "economic.ruralRevitalization": 52,
    "environment.energyTransitionProgress": 78,
    "environment.nuclearSafety": 72,
    "population.demographicDecline": 52,
  },
  HH: {
    "economic.rdIntensity": 3.3,
    "economic.propertyValueIndex": 135,
    "economic.commercialValueIndex": 130,
    "economic.exportDependency": 55,
    "infrastructure.transportEfficiency": 85,
    "social.childPoverty": 18,
    "social.housingAffordability": 72,
    "population.demographicDecline": 44,
  },
  BRE: {
    "economic.propertyValueIndex": 105,
    "economic.exportDependency": 52,
    "economic.manufacturingCompetitiveness": 72,
    "infrastructure.transportEfficiency": 78,
    "social.childPoverty": 26,
    "social.housingAffordability": 58,
    "population.demographicDecline": 46,
  },
  BE: {
    "economic.rdIntensity": 3.4,
    "economic.propertyValueIndex": 120,
    "economic.commercialValueIndex": 118,
    "economic.economicFreedom": 66,
    "infrastructure.transportEfficiency": 85,
    "social.childPoverty": 22,
    "social.housingAffordability": 68,
    "social.foreignWorkerIntegration": 62,
    "social.genderEquality": 72,
    "governance.roboticsAdoption": 60,
    "population.demographicDecline": 42,
  },
  BB: {
    "economic.manufacturingCompetitiveness": 65,
    "environment.energyTransitionProgress": 75,
    "population.demographicDecline": 60,
  },
  MV: {
    "economic.manufacturingCompetitiveness": 55,
    "environment.energyTransitionProgress": 78,
    "environment.nuclearSafety": 60,
    "population.demographicDecline": 68,
  },
  SN: {
    "economic.rdIntensity": 2.6,
    "economic.manufacturingCompetitiveness": 70,
    "education.highSchoolGradRate": 90,
    "governance.roboticsAdoption": 66,
  },
  ST: {
    "economic.manufacturingCompetitiveness": 60,
    "social.childPoverty": 20,
    "population.demographicDecline": 68,
  },
  TH: {
    "economic.manufacturingCompetitiveness": 64,
    "population.demographicDecline": 66,
  },
};

export const deMetricPresets2019: MetricPresetBundle = expand(NATIONAL_2019, EAST_2019, TILTS_2019);

/**
 * 1991 Germany — the year after reunification. West: strong manufacturing/Mittelstand,
 * high R&D, established Mitbestimmung, active well-run nuclear fleet. East (Aufbau Ost):
 * Treuhand-driven deindustrialization + mass unemployment, collapsing R&D, Soviet-design
 * nuclear (Greifswald shut 1990 on safety grounds), but a retained female-workforce legacy.
 * Nationally: debt/GDP ~40% (the reunification-cost ramp came later), Energiewende not begun.
 */
const NATIONAL_1991: Record<string, number> = {
  "economic.laborParticipation": 66,
  "economic.matchingFriction": 5,
  "economic.tradeBalance": 2,
  "economic.productivityGrowth": 1.5,
  "economic.rdIntensity": 2.5,
  "economic.propertyValueIndex": 55,
  "economic.commercialValueIndex": 55,
  "economic.ruralRevitalization": 45,
  "economic.foodSecurity": 65,
  "economic.exportDependency": 40,
  "economic.manufacturingCompetitiveness": 70,
  "economic.regulatoryBurden": 62,
  "economic.economicFreedom": 60,
  "education.highSchoolGradRate": 82,
  "education.universityEnrollment": 28,
  "education.apprenticeshipRate": 5.5,
  "education.academicPressure": 55,
  "healthcare.uninsuredRate": 1,
  "healthcare.affordabilityIndex": 75,
  "healthcare.mentalHealthAccess": 50,
  "healthcare.socialCareQuality": 55,
  "healthcare.elderCareQuality": 55,
  "infrastructure.transportEfficiency": 65,
  "publicSafety.antiSocialBehaviourRate": 6,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 55,
  "environment.nuclearSafety": 60,
  "environment.energyTransitionProgress": 8,
  "social.childPoverty": 14,
  "social.housingAffordability": 45,
  "social.roughSleeping": 3,
  "social.workLifeBalance": 65,
  "social.foreignWorkerIntegration": 45,
  "social.genderEquality": 50,
  "social.housingSupplyGrowth": 2.5,
  "governance.debtToGdp": 40,
  "governance.devolutionSatisfaction": 65,
  "governance.roboticsAdoption": 28,
  "governance.coDeterminationQuality": 70,
  "governance.nationalPride": 58,
  "governance.civilLiberties": 78,
  "governance.militaryReadiness": 60,
  "population.demographicDecline": 38,
  "mediaInformation.stateMediaControl": 28,
};

/** 1991 East deltas — Treuhand shock: collapsing output/R&D/manufacturing, Soviet nuclear
 * legacy, just-freed media, but socialist female-workforce legacy intact. */
const EAST_1991: Record<string, number> = {
  "economic.laborParticipation": 62,
  "economic.matchingFriction": 9,
  "economic.productivityGrowth": -1.5,
  "economic.rdIntensity": 1.0,
  "economic.propertyValueIndex": 35,
  "economic.commercialValueIndex": 35,
  "economic.ruralRevitalization": 35,
  "economic.exportDependency": 28,
  "economic.manufacturingCompetitiveness": 40,
  "economic.economicFreedom": 52,
  "education.highSchoolGradRate": 80,
  "infrastructure.transportEfficiency": 45,
  "environment.nuclearSafety": 45,
  "environment.energyTransitionProgress": 6,
  "social.childPoverty": 20,
  "social.housingAffordability": 30,
  "social.genderEquality": 58,
  "governance.roboticsAdoption": 18,
  "governance.coDeterminationQuality": 55,
  "governance.nationalPride": 50,
  "mediaInformation.stateMediaControl": 35,
  "population.demographicDecline": 42,
};

const TILTS_1991: Record<string, Record<string, number>> = {
  BW: {
    "economic.rdIntensity": 3.0,
    "economic.manufacturingCompetitiveness": 85,
    "economic.propertyValueIndex": 65,
    "economic.commercialValueIndex": 65,
    "economic.exportDependency": 48,
    "economic.economicFreedom": 64,
    "environment.energyTransitionProgress": 9,
    "governance.roboticsAdoption": 35,
    "governance.coDeterminationQuality": 78,
  },
  BY: {
    "economic.rdIntensity": 3.0,
    "economic.manufacturingCompetitiveness": 85,
    "economic.propertyValueIndex": 65,
    "economic.commercialValueIndex": 65,
    "economic.exportDependency": 48,
    "economic.economicFreedom": 64,
    "environment.energyTransitionProgress": 9,
    "governance.roboticsAdoption": 35,
    "governance.coDeterminationQuality": 78,
  },
  NW: {
    "economic.manufacturingCompetitiveness": 75,
    "economic.propertyValueIndex": 58,
    "governance.roboticsAdoption": 30,
  },
  HE: {
    "economic.propertyValueIndex": 62,
    "economic.commercialValueIndex": 64,
    "economic.economicFreedom": 64,
  },
  HH: {
    "economic.propertyValueIndex": 64,
    "economic.exportDependency": 50,
    "economic.ruralRevitalization": 55,
    "infrastructure.transportEfficiency": 75,
  },
  BRE: {
    "economic.propertyValueIndex": 52,
    "economic.exportDependency": 50,
    "economic.ruralRevitalization": 55,
    "infrastructure.transportEfficiency": 75,
  },
  BE: {
    "economic.propertyValueIndex": 45,
    "infrastructure.transportEfficiency": 70,
    "governance.nationalPride": 52,
    "mediaInformation.stateMediaControl": 32,
    "population.demographicDecline": 34,
  },
  SH: {
    "environment.energyTransitionProgress": 9,
  },
  MV: {
    "economic.manufacturingCompetitiveness": 35,
    "environment.nuclearSafety": 40,
    "environment.energyTransitionProgress": 7,
  },
  SN: {
    "economic.rdIntensity": 1.3,
    "economic.manufacturingCompetitiveness": 45,
    "education.highSchoolGradRate": 84,
  },
};

export const deMetricPresets1991: MetricPresetBundle = expand(NATIONAL_1991, EAST_1991, TILTS_1991);
