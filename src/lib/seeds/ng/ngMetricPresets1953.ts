import type { MetricPresetBundle } from "@/lib/seeds/ng/ngMetricPresets";

/**
 * 1953 Nigeria — British Crown Colony (Federation of Nigeria; independence 1960). Macpherson
 * Constitution (1951) creating regional governments; Kano riots (May 1953) exposing North-South
 * tension. Population ~31M. Life expectancy ~37. Oil not yet discovered commercially (Shell
 * finds oil at Oloibiri 1956; production 1958). Economy: groundnuts (North), palm oil (East/South),
 * cocoa (West), colonial tin mining (Jos plateau). Very low urbanisation (~10%). Colonial
 * education system (mission schools); tiny elite at Ibadan/Lagos. Press exists in Lagos but
 * limited. No nuclear. Currency: West African pound (sterling-pegged).
 */

const NG_REGIONS = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
] as const;

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 60, // subsistence agriculture absorbs all; no formal stats
  "economic.matchingFriction": 8.0, // minimal formal labour market
  "economic.tradeBalance": 0.5, // colonial export surplus (groundnuts/palm oil)
  "economic.productivityGrowth": 2.0, // subsistence base; modest export growth
  "economic.rdIntensity": 0.0,
  // USD-anchored colonial median household income (INCOME_ANCHORS NG 1953; refs #3498)
  "economic.medianIncome": 150,
  "economic.propertyValueIndex": 5,
  "economic.commercialValueIndex": 5,
  "economic.ruralRevitalization": 92, // overwhelmingly rural subsistence
  "economic.foodSecurity": 55, // subsistence; regional famines possible
  "economic.exportDependency": 28, // cash crops for colonial export
  "economic.manufacturingCompetitiveness": 5, // virtually no industry
  "economic.regulatoryBurden": 70, // colonial administration heavy
  "economic.economicFreedom": 22, // colonial command economy
  "education.highSchoolGradRate": 5, // mission schools; colonial elite tiny
  "education.universityEnrollment": 0.2,
  "education.apprenticeshipRate": 0.5,
  "education.academicPressure": 20,
  "healthcare.uninsuredRate": 95, // essentially no health coverage
  "healthcare.nhsWaitingTime": 36, // weeks; colonial medical service serves a tiny urban fraction; rural care near-zero
  "healthcare.affordabilityIndex": 12,
  "healthcare.mentalHealthAccess": 3,
  "healthcare.socialCareQuality": 8,
  "healthcare.elderCareQuality": 10, // extended family care only
  "infrastructure.transportEfficiency": 15, // colonial rail lines (groundnut pyramids); few roads
  "infrastructure.roadCondition": 12, // colonial roads serve export routes only
  "environment.protectedLand": 1.5, // % of land; colonial game reserves cover real area
  "infrastructure.powerGridReliability": 70, // % uptime; colonial supply for a small urban fraction
  "infrastructure.waterQuality": 18, // treated-supply index
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "publicSafety.antiSocialBehaviourRate": 8,
  "publicSafety.knifeCrimeRate": 4,
  "environment.floodRisk": 20,
  "environment.naturalDisasterPreparedness": 15,
  "environment.nuclearSafety": 0, // no nuclear
  "environment.energyTransitionProgress": 0, // no commercial energy infrastructure
  "social.childPoverty": 82,
  "social.housingAffordability": 8, // mud/thatch housing; cheap but basic
  "social.roughSleeping": 5,
  "social.workLifeBalance": 35,
  "social.foreignWorkerIntegration": 15, // colonial British administrators; Lebanese merchants
  "social.genderEquality": 8, // deeply patriarchal; purdah in North; bride price South
  "social.housingSupplyGrowth": 1.0,
  "governance.debtToGdp": 20, // colonial government debt; low
  "governance.devolutionSatisfaction": 35, // regional governments forming but tensions high
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 60, // nascent nationalism; Nnamdi Azikiwe, Awolowo
  "governance.civilLiberties": 30, // colonial suppression of nationalist movements
  "governance.militaryReadiness": 20, // Royal West African Frontier Force; colonial
  // UN WPP 1950 Nigeria median age 19.1. Seeded regional ages (16–19) were already
  // era-plausible after the adjuster pass-through; lock them here so an overlay
  // cannot be missed. birthRate below is the real fix.
  "population.medianAge": 18,
  // 0–100 fertility INDEX. Adjuster left ~55–57 (formula 65 − age×0.5 on the
  // young seed). High-fertility end of the game index is 82–92
  // (ngPopulationAnchors1991); TFR ~6.5 in colonial Nigeria belongs there.
  "population.birthRate": 86,
  "population.demographicDecline": 0, // very young, high fertility, growing fast
  "mediaInformation.stateMediaControl": 65, // colonial government controls media; nationalist press restricted
};

const TILTS_1953: Record<string, Record<string, number>> = {
  SOUTH_WEST: {
    // Lagos / Yorubaland — most developed; NCNC/AG nationalist politics
    "economic.medianIncome": 220,
    "economic.manufacturingCompetitiveness": 12,
    "economic.exportDependency": 38, // cocoa export
    "infrastructure.transportEfficiency": 22,
    "education.highSchoolGradRate": 10,
    "social.childPoverty": 70,
    "governance.nationalPride": 70,
    "governance.civilLiberties": 38,
    "mediaInformation.stateMediaControl": 55,
    "population.medianAge": 19, // Lagos / Yoruba — oldest southern tilt
    "population.birthRate": 82,
  },
  SOUTH_SOUTH: {
    // Niger Delta / oil-bearing — Ijaw, Urhobo, Efik; colonial exploitation
    "economic.medianIncome": 140,
    "economic.exportDependency": 35,
    "environment.floodRisk": 30,
    "social.childPoverty": 80,
    "governance.civilLiberties": 28,
    "population.medianAge": 18,
    "population.birthRate": 84,
  },
  SOUTH_EAST: {
    // Igboland / Eastern Region — NCNC base; Zik
    "economic.medianIncome": 170,
    "education.highSchoolGradRate": 8,
    "social.childPoverty": 75,
    "governance.nationalPride": 68,
    "governance.civilLiberties": 35,
    "population.medianAge": 19,
    "population.birthRate": 82,
  },
  NORTH_WEST: {
    // Kano / Sokoto — Islamic Hausa-Fulani; NPC; groundnuts
    "economic.medianIncome": 120,
    "economic.ruralRevitalization": 95,
    "economic.exportDependency": 30, // groundnut pyramids
    "social.genderEquality": 5, // purdah; near-complete female seclusion
    "education.highSchoolGradRate": 2, // very few secular schools; Quranic only
    "social.childPoverty": 85,
    "governance.civilLiberties": 25,
    "mediaInformation.stateMediaControl": 75,
    "population.medianAge": 16, // Hausa-Fulani core — youngest
    "population.birthRate": 92,
  },
  NORTH_EAST: {
    // Bornu / Bauchi — remote; subsistence
    "economic.medianIncome": 100,
    "economic.ruralRevitalization": 96,
    "social.childPoverty": 88,
    "infrastructure.transportEfficiency": 10,
    "healthcare.uninsuredRate": 98,
    "education.highSchoolGradRate": 1,
    "population.medianAge": 16,
    "population.birthRate": 92,
  },
  NORTH_CENTRAL: {
    // Plateau / Benue / Kwara — tin mining; mixed
    "economic.medianIncome": 130,
    "economic.manufacturingCompetitiveness": 8, // Jos tin mining
    "economic.ruralRevitalization": 90,
    "social.childPoverty": 83,
    "population.medianAge": 17,
    "population.birthRate": 88,
  },
};

export const ngMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  NG_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
