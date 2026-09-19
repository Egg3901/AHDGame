import type { MetricPresetBundle } from "@/lib/seeds/br/brMetricPresets";

/**
 * 1979 Brazil — General João Baptista Figueiredo (5th and last military president; took office
 * March 1979). "Economic miracle" (1968-73) fading; Brazil importing ~80% of its oil — the
 * second oil shock (1979) crushes the economy. Inflation 77%/yr and accelerating. External
 * debt ballooning. Abertura (political opening) underway; amnesty law 1979 returns exiles.
 * Proálcool (sugarcane ethanol) programme from 1975. Itaipú dam under construction (completed
 * 1984). Urbanization passing 60%. Population ~120M. Deep regional inequality (Nordeste feudal
 * latifundio vs São Paulo industrial powerhouse).
 */

const BR_REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"] as const;

const NATIONAL_1979: Record<string, number> = {
  "economic.laborParticipation": 56, // growing female participation; large informal sector
  "economic.matchingFriction": 5.0, // urban informal sector very large
  "economic.tradeBalance": -2.5, // oil import deficit dominates
  "economic.productivityGrowth": 2.2, // slowing sharply from miracle years
  "economic.rdIntensity": 0.4, // state R&D (Embrapa/Embraer); nascent
  "economic.propertyValueIndex": 22,
  "economic.commercialValueIndex": 25,
  "economic.ruralRevitalization": 65, // still significantly rural; latifundio unchanged
  "economic.foodSecurity": 62, // food export + Nordeste hunger coexist
  "economic.exportDependency": 20, // diversifying from coffee (cars/steel/soy)
  "economic.manufacturingCompetitiveness": 55, // ISI matured; capital goods still imported
  "economic.regulatoryBurden": 68, // military government heavy intervention
  "economic.economicFreedom": 35, // state dominance; Petrobras monopoly; ISI
  "education.highSchoolGradRate": 35, // improving but rural Nordeste very low
  "education.universityEnrollment": 8,
  "education.apprenticeshipRate": 0.8,
  "education.academicPressure": 35,
  "healthcare.uninsuredRate": 55, // INPS covers formal workers only; ~35% uninsured
  "healthcare.affordabilityIndex": 42,
  "healthcare.mentalHealthAccess": 12,
  "healthcare.socialCareQuality": 22,
  "healthcare.elderCareQuality": 20,
  "infrastructure.transportEfficiency": 35, // BR-101/116 highways; rail declining; airports growing
  "publicSafety.antiSocialBehaviourRate": 14,
  "publicSafety.knifeCrimeRate": 6,
  "environment.floodRisk": 18,
  "environment.naturalDisasterPreparedness": 30,
  "environment.nuclearSafety": 5, // Angra I under construction (1982 completion)
  "environment.energyTransitionProgress": 8, // Proálcool ethanol programme; Itaipu hydro coming
  "social.childPoverty": 50, // improvement from 1953 but still high; Nordeste severe
  "social.housingAffordability": 15, // favelas expanding; BNH housing finance
  "social.roughSleeping": 8,
  "social.workLifeBalance": 42,
  "social.foreignWorkerIntegration": 42, // post-immigration wave absorbed; diverse society
  "social.genderEquality": 28, // abertura opening civic space; women organizing
  "social.housingSupplyGrowth": 2.8, // BNH (National Housing Bank) construction
  "governance.debtToGdp": 45, // rising fast (oil shock + external debt)
  "governance.devolutionSatisfaction": 40, // military government centralised; states subordinate
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 65, // football; Proálcool pride; regional disparities
  "governance.civilLiberties": 45, // abertura: press freer than 1968-74; AI-5 ended 1978
  "governance.militaryReadiness": 60, // military government = large armed forces
  "population.demographicDecline": 8, // high but declining fertility; young population
  "mediaInformation.stateMediaControl": 50, // Globo TV dominant; government advertising controls press
};

const TILTS_1979: Record<string, Record<string, number>> = {
  SUDESTE: {
    "economic.manufacturingCompetitiveness": 75, // São Paulo ABC industrial belt
    "economic.exportDependency": 30,
    "economic.propertyValueIndex": 35,
    "economic.commercialValueIndex": 42,
    "infrastructure.transportEfficiency": 50,
    "social.childPoverty": 35,
    "education.highSchoolGradRate": 50,
    "governance.civilLiberties": 52,
    "population.demographicDecline": 12, // São Paulo growing fast
  },
  SUL: {
    "economic.ruralRevitalization": 72,
    "economic.manufacturingCompetitiveness": 58,
    "social.foreignWorkerIntegration": 60, // German/Italian communities
    "social.childPoverty": 38,
    "governance.civilLiberties": 50,
    "population.demographicDecline": 10,
  },
  NORDESTE: {
    "economic.ruralRevitalization": 88,
    "social.childPoverty": 70,
    "healthcare.uninsuredRate": 78,
    "education.highSchoolGradRate": 18,
    "infrastructure.transportEfficiency": 22,
    "governance.civilLiberties": 38,
    "economic.foodSecurity": 52, // drought and hunger persist
  },
  NORTE: {
    "economic.ruralRevitalization": 90,
    "social.childPoverty": 68,
    "infrastructure.transportEfficiency": 18,
    "healthcare.uninsuredRate": 75,
    "environment.floodRisk": 22, // Amazon floods
  },
  CENTRO_OESTE: {
    "economic.ruralRevitalization": 80,
    "social.childPoverty": 52,
    "infrastructure.transportEfficiency": 22,
    "economic.foodSecurity": 68, // soy frontier expanding (Cerrado)
  },
};

export const brMetricPresets1979: MetricPresetBundle = Object.fromEntries(
  BR_REGIONS.map((region) => [region, { ...NATIONAL_1979, ...(TILTS_1979[region] ?? {}) }])
);
