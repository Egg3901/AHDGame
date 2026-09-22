import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

/**
 * 1953 Ireland — Éamon de Valera / Fianna Fáil (returned to power 1951-54). Protectionist
 * agrarian economy; trade war legacy (Economic War 1932-38) still shaping policy; massive
 * emigration (net -2% population/yr; ~40,000/yr to UK/US); Irish pound pegged 1:1 to sterling.
 * Dáil had 147 seats. No nuclear. Catholic Church dominant in education/health/social welfare.
 * Rural electrification underway (REO scheme 1946 onwards). Life expectancy ~66
 * (CSO / UN Demographic Yearbook 1950-55 — not the modern ~82 still in ieStateMetrics).
 * Very low public debt (neutral in WWII). Very low urbanisation (~45% urban).
 */

const IE_REGIONS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"] as const;

const NATIONAL_1953: Record<string, number> = {
  // #income-gdp-scale-audit: `seedIEStateMetrics` never applies an era-1953
  // metrics adjuster (unlike DE/BR/NG/JP, which run applyEra1953Adjustments)
  // and this overlay never authored `economic.medianIncome`, so 1953 Ireland
  // silently kept ieStateMetrics.ts's MODERN income (€32,000-52,000) — against
  // a 1953 budget GDP/capita of only ~£IR 115 (£IR 340M / 2.96M;
  // NATIONAL_BUDGET_SEED_CONFIGS_1953), that is a ~300-450x ratio
  // (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]). Household income
  // ≈180 IEP nationally (ratio 1.55) — Ireland in 1953 was a poor emigration
  // economy (net emigration ~40k/yr; peak Ireland-UK wage gap), so multi-
  // earner households sit only modestly above the very low per-capita GDP.
  "economic.medianIncome": 180,
  "economic.laborParticipation": 52, // high male; women leave work on marriage (law until 1973)
  "economic.matchingFriction": 5.0, // emigration is the safety valve
  "economic.tradeBalance": -3.5, // chronic deficit; imports from UK
  "economic.productivityGrowth": 1.8, // protected economy stagnant
  "economic.rdIntensity": 0.2,
  "economic.propertyValueIndex": 20,
  "economic.commercialValueIndex": 18,
  "economic.ruralRevitalization": 78, // Ireland predominantly agricultural
  "economic.foodSecurity": 72, // food export economy (cattle/dairy)
  "economic.exportDependency": 35, // very dependent on UK market
  "economic.manufacturingCompetitiveness": 28, // very limited; protectionist infant industries
  "economic.regulatoryBurden": 62, // protectionist tariff regime
  "economic.economicFreedom": 42, // de Valera protectionism; closed economy
  "education.highSchoolGradRate": 30, // most left primary school; secondary fee-based
  "education.universityEnrollment": 3, // UCD / TCD / UCC / UCG — small elite
  "education.apprenticeshipRate": 2.0,
  "education.academicPressure": 40,
  "healthcare.uninsuredRate": 35, // Mother and Child Scheme defeated by Church (1951); mixed
  "healthcare.affordabilityIndex": 55, // dispensary system; voluntary hospital charity
  // CSO / UN Demographic Yearbook 1950-55: Ireland e0 ≈65–67. Base ieStateMetrics
  // still carries modern ~82; seedIE never runs applyEra1953Adjustments, so this
  // overlay is the only era correction (without it the 1953 world keeps 2019 LE).
  "healthcare.lifeExpectancy": 66,
  "healthcare.nhsWaitingTime": 14, // weeks; dispensary system for the poor + voluntary hospitals; pre-1957 reform
  "healthcare.mentalHealthAccess": 15, // psychiatric hospitals (highest rate in world per capita)
  "healthcare.socialCareQuality": 25, // Church-run institutions
  "healthcare.elderCareQuality": 28,
  "infrastructure.transportEfficiency": 40, // CIÉ rail; poor roads; rural electrification ongoing
  "infrastructure.roadCondition": 40, // rural network long underinvested
  "environment.protectedLand": 0.6, // % of land; very little reserved land
  "infrastructure.powerGridReliability": 93, // % uptime; ESB rural electrification mid-programme; rural water schemes early
  "infrastructure.waterQuality": 74, // treated-supply index
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "publicSafety.antiSocialBehaviourRate": 3,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 38,
  "environment.energyTransitionProgress": 2, // ESB hydroelectric (Ardnacrusha 1929); peat burning
  "social.childPoverty": 35, // high emigration + low wages; large family norm
  "social.housingAffordability": 10, // housing cheap; shortage in Dublin
  "social.roughSleeping": 3,
  "social.workLifeBalance": 48,
  "social.foreignWorkerIntegration": 20, // homogeneous; returnee emigrants only
  "social.genderEquality": 15, // Marriage Bar (civil service); Church teaching; no divorce
  "social.housingSupplyGrowth": 2.0,
  "governance.debtToGdp": 22, // low — neutral in WWII; prudent fiscal management
  "governance.devolutionSatisfaction": 45, // no devolution; highly centralised
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 72, // independence narrative; Irish language revival
  "governance.civilLiberties": 60, // officially free; Church censorship; IRA suppression
  "governance.militaryReadiness": 15, // Irish Defence Forces minimal (neutrality)
  // UN WPP 1950 Ireland median age 30.0 / 1955 30.2. Base ieStateMetrics still
  // carries modern 38.6; seedIE never runs applyEra1953Adjustments, so this
  // overlay (applied via getRegionMetricPresets) is the only era correction.
  "population.medianAge": 30,
  // 0–100 fertility INDEX. Formula 65 − 30×0.5 = 50; Catholic high-fertility
  // Ireland (TFR ~3.5 early-1950s) sits slightly above.
  "population.birthRate": 52,
  "population.demographicDecline": 20, // mass emigration → declining population
  "mediaInformation.stateMediaControl": 25, // Radio Éireann public; RTÉ TV not until 1961
};

const TILTS_1953: Record<string, Record<string, number>> = {
  DUB: {
    "economic.propertyValueIndex": 28,
    "economic.commercialValueIndex": 30,
    "economic.manufacturingCompetitiveness": 40,
    "economic.exportDependency": 45,
    "infrastructure.transportEfficiency": 52,
    "education.universityEnrollment": 8,
    // Teaching-hospital concentration (Mater / St Vincent's) — modest urban LE edge
    "healthcare.lifeExpectancy": 67,
    "social.childPoverty": 28,
    "governance.civilLiberties": 65,
    "population.demographicDecline": 15, // Dublin growing; emigration lower from capital
    "population.medianAge": 32, // capital older than western counties
    "population.birthRate": 48,
    "economic.medianIncome": 220, // capital; civil service + industry
  },
  KIL: {
    // Kildare / Dublin commuter belt / east coast
    "economic.ruralRevitalization": 72,
    "healthcare.lifeExpectancy": 66.5,
    "social.childPoverty": 30,
    "population.medianAge": 31,
    "population.birthRate": 50,
    "economic.medianIncome": 190,
  },
  COR: {
    // Cork / Munster industrial city
    "economic.manufacturingCompetitiveness": 32,
    "economic.exportDependency": 40,
    "healthcare.lifeExpectancy": 66.5, // Cork city hospitals; Munster hinterland drag
    "social.childPoverty": 32,
    "population.demographicDecline": 18,
    "population.medianAge": 31,
    "population.birthRate": 50,
    "economic.medianIncome": 190,
  },
  LIM: {
    // Limerick / Shannon
    "economic.ruralRevitalization": 80,
    "healthcare.lifeExpectancy": 65.5,
    "social.childPoverty": 38,
    "population.demographicDecline": 22,
    "population.medianAge": 30,
    "population.birthRate": 52,
    "economic.medianIncome": 170,
  },
  GAL: {
    // Galway / Connacht — poorest, most emigration
    "economic.ruralRevitalization": 88,
    "social.childPoverty": 45,
    "population.demographicDecline": 28,
    "education.highSchoolGradRate": 20,
    "infrastructure.transportEfficiency": 30,
    // Higher rural infant mortality / thinner GP coverage west of the Shannon
    "healthcare.lifeExpectancy": 64.5,
    "population.medianAge": 28, // rural west younger
    "population.birthRate": 54,
    "economic.medianIncome": 140, // poorest, most emigration
  },
  DON: {
    // Donegal — most remote, highest emigration
    "economic.ruralRevitalization": 90,
    "social.childPoverty": 48,
    "population.demographicDecline": 30,
    "infrastructure.transportEfficiency": 25,
    "healthcare.lifeExpectancy": 64, // remotest county; delayed specialist access
    "population.medianAge": 28,
    "population.birthRate": 55,
    "economic.medianIncome": 130, // most remote, highest emigration
  },
  MID: {
    "economic.ruralRevitalization": 85,
    "healthcare.lifeExpectancy": 65.5,
    "social.childPoverty": 40,
    "population.demographicDecline": 24,
    "population.medianAge": 29,
    "population.birthRate": 53,
    "economic.medianIncome": 160,
  },
  WEX: {
    "economic.ruralRevitalization": 82,
    "economic.foodSecurity": 78,
    "healthcare.lifeExpectancy": 66,
    "social.childPoverty": 35,
    "population.medianAge": 30,
    "population.birthRate": 52,
    "economic.medianIncome": 170,
  },
};

export const ieMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  IE_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
