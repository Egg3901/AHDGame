import type { MetricPresetBundle } from "@/lib/seeds/br/brMetricPresets";

/**
 * 1953 Brazil — Getúlio Vargas (2nd term; Estado Novo authoritarian legacy; suicide Aug 1954).
 * Petrobras founded October 1953 (state oil monopoly). Import-substitution industrialisation;
 * São Paulo emerging as industrial centre. Population ~57M. Life expectancy ~50.
 * Massive rural-urban migration beginning. Coffee still dominant export (~65% of forex).
 * Deep inequality: São Paulo modern; Northeast feudal (latifundio). No nuclear.
 * Democracy nominal — Vargas nationalist-populist, suppressing opposition.
 */

const BR_REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"] as const;

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 52, // low female participation; large informal sector
  "economic.matchingFriction": 6.0,
  "economic.tradeBalance": -1.5, // coffee revenues vs industrial imports deficit
  "economic.productivityGrowth": 4.5, // industrialisation phase
  "economic.rdIntensity": 0.2,
  "economic.propertyValueIndex": 15,
  "economic.commercialValueIndex": 18,
  "economic.ruralRevitalization": 75, // majority rural; coffee/cacao/rubber
  "economic.foodSecurity": 58,
  "economic.exportDependency": 15, // coffee monoculture export dependency
  "economic.manufacturingCompetitiveness": 35, // nascent industry; import substitution
  "economic.regulatoryBurden": 65, // nationalist ISI policy; heavy state intervention
  "economic.economicFreedom": 35, // Vargas economic nationalism
  "education.highSchoolGradRate": 20,
  "education.universityEnrollment": 2,
  "education.apprenticeshipRate": 0.5,
  "education.academicPressure": 25,
  "healthcare.uninsuredRate": 72, // very limited health coverage
  "healthcare.nhsWaitingTime": 20, // weeks; IAP funds cover the urban formal sector; the interior has almost nothing
  "healthcare.affordabilityIndex": 30,
  "healthcare.mentalHealthAccess": 8,
  "healthcare.socialCareQuality": 15,
  "healthcare.elderCareQuality": 15,
  "infrastructure.transportEfficiency": 25, // limited road/rail network
  "infrastructure.roadCondition": 22, // vast unpaved interior
  "environment.protectedLand": 1.1, // % of land; early federal forest reserves
  "infrastructure.powerGridReliability": 86, // % uptime; coastal cities served, interior largely not
  "infrastructure.waterQuality": 45, // treated-supply index
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "publicSafety.antiSocialBehaviourRate": 12,
  "publicSafety.knifeCrimeRate": 5,
  "environment.floodRisk": 18,
  "environment.naturalDisasterPreparedness": 25,
  "environment.nuclearSafety": 0,
  "environment.energyTransitionProgress": 2, // hydro power (Itaipu not until 1984; some earlier dams)
  "social.childPoverty": 58,
  "social.housingAffordability": 12, // housing cheap but slums (favelas) growing
  "social.roughSleeping": 10,
  "social.workLifeBalance": 38,
  "social.foreignWorkerIntegration": 45, // waves of European/Japanese immigration absorbed
  "social.genderEquality": 18,
  "social.housingSupplyGrowth": 2.5,
  "governance.debtToGdp": 28,
  "governance.devolutionSatisfaction": 42,
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 68, // Vargas nationalism; football passion (1950 WC hosts)
  "governance.civilLiberties": 40, // Vargas authoritarian tendencies; press restricted
  "governance.militaryReadiness": 42,
  // UN WPP 1950 Brazil median age 19.2 / 1955 19.9 → ~19.5 in 1953. Adjuster
  // alone left most regions at 25.5 (modern 33.5 − 8) — still too old.
  "population.medianAge": 19,
  // 0–100 fertility INDEX. TFR ~6 early-1950s; align with brPopulationAnchors1991
  // high-fertility band (66–82) rather than formula-at-19 ≈ 55.5.
  "population.birthRate": 78,
  "population.demographicDecline": 5, // very young, rapidly growing population
  "mediaInformation.stateMediaControl": 55, // Vargas used radio for propaganda
  // #income-gdp-scale-audit: `seedBRStateMetrics` runs applyEra1953Adjustments
  // (stateMetricsEra1953.ts) on brStateMetrics.ts's modern income, but that
  // adjuster scales EVERY country by the same US-anchored ratio
  // (INCOME_ANCHOR_RATIO_1953 = US 1953/2019 anchor), which does not track
  // Brazil's own income trajectory — it measured out at ratio ~0.39x GDP per
  // capita (Cr$ 330B / 57M = Cr$ 5,789; medianIncomeGdpScale1953.test.ts band
  // is [0.8, 2.6]), under-scaled. Authoring it here (as JP/NG/CN/RU/IT/FR/ES/
  // SE/TR/AT/FI/GR already do) makes the overlay — not the blanket adjuster —
  // the final word. National ≈7,500 cruzeiros (ratio ~1.3) with SUDESTE
  // (São Paulo/Rio industrial core) far above and NORDESTE (latifundio
  // Northeast) far below, reflecting Brazil's well-documented 1950s regional
  // income gap (IBGE census-era estimates).
  "economic.medianIncome": 7_500,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  SUDESTE: {
    // São Paulo / Rio / Minas Gerais
    "economic.manufacturingCompetitiveness": 55,
    "economic.exportDependency": 20,
    "economic.propertyValueIndex": 22,
    "economic.commercialValueIndex": 28,
    "infrastructure.transportEfficiency": 35,
    "social.childPoverty": 42,
    "education.highSchoolGradRate": 30,
    "governance.civilLiberties": 45,
    "population.medianAge": 21, // industrial southeast oldest
    "population.birthRate": 70,
    "economic.medianIncome": 12_700, // São Paulo/Rio industrial core; wealthiest region
  },
  SUL: {
    // Rio Grande do Sul / Paraná / Santa Catarina
    "economic.ruralRevitalization": 80,
    "economic.manufacturingCompetitiveness": 38,
    "social.foreignWorkerIntegration": 62, // German/Italian immigrant communities
    "social.childPoverty": 45,
    "governance.civilLiberties": 45,
    "population.medianAge": 20,
    "population.birthRate": 72,
    "economic.medianIncome": 9_800, // prosperous immigrant-farmer agriculture
  },
  NORDESTE: {
    "economic.ruralRevitalization": 88,
    "social.childPoverty": 72,
    "healthcare.uninsuredRate": 85,
    "education.highSchoolGradRate": 12,
    "infrastructure.transportEfficiency": 18,
    "governance.civilLiberties": 35,
    "population.medianAge": 18,
    "population.birthRate": 82,
    "economic.medianIncome": 3_500, // latifundio Northeast; poorest region
  },
  NORTE: {
    "economic.ruralRevitalization": 90,
    "social.childPoverty": 70,
    "infrastructure.transportEfficiency": 15,
    "healthcare.uninsuredRate": 82,
    "population.medianAge": 17, // Amazonian north youngest
    "population.birthRate": 84,
    "economic.medianIncome": 4_000, // sparse Amazonian extraction economy
  },
  CENTRO_OESTE: {
    "economic.ruralRevitalization": 85,
    "social.childPoverty": 60,
    "infrastructure.transportEfficiency": 18,
    "population.medianAge": 19,
    "population.birthRate": 78,
    "economic.medianIncome": 5_800, // frontier ranching economy
  },
};

export const brMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  BR_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
