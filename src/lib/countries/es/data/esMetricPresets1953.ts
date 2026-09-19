/**
 * Spain 1953 metric overlays — Francoist autarky years.
 *
 * Base `esStateMetrics` is authored on ~1979 (Transition) values. Without this
 * overlay a 1953-default world keeps 1979 life expectancy (~75.5), literacy 93,
 * and urbanization (~70) — far above autarky-era Spain, where agriculture still
 * employed ~49% of the workforce (1950 Census of Spain / INE) and life
 * expectancy sat near 62 (UN Demographic Yearbook 1950-55). Region ids match
 * `esRegionCensusData1953`.
 *
 * `medianIncome` is annual household income in 1953 NOMINAL pesetas, the unit
 * the 1953 GDP seed is denominated in (budgets.ts ES FY1953: ₧198B).
 *
 * The original authoring took `1979 nominal ₧700,000 × 0.33` (the Maddison
 * Project REAL GDP/cap ratio 1953≈2,500 vs 1979≈7,500 1990 Int$) and called
 * the result a 1953 nominal peseta figure. Applying a real-volume ratio to a
 * nominal value skips the price level entirely, and Spanish prices rose about
 * an order of magnitude between the autarky years and the Transition (INE
 * consumer price series, 1953→1979 ≈ 12-13×). The nominal chain is
 *
 *   ₧_1953 = ₧_1979 × 0.33 (real income ratio) ÷ ~12.5 (INE price level)
 *
 * i.e. roughly ₧_1979 / 38 — the figures below are the previous ones ÷ ~16
 * after re-rounding to authored values.
 *
 * Cross-check against the seed's own national accounts: GDP/capita = ₧198B /
 * 28.2M = ₧7,021, so the ~₧13,400 population-weighted median household (3.2
 * persons) is ~1.9× GDP/capita, i.e. aggregate household income ≈ 60% of GDP.
 * Against the record: INE puts the mid-1950s average annual industrial wage
 * near ₧11,000-13,000, with Andalusian braceros far below it and
 * Barcelona/Bilbao industry above — the ₧8,800-22,000 spread seeded here.
 * Broadband/internet did not exist.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const ES_REGIONS = [
  "ES_MAD",
  "ES_CAT",
  "ES_AND",
  "ES_VAL",
  "ES_PVB",
  "ES_GAL",
  "ES_NOR",
  "ES_CEN",
] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 esStateMetrics) ──
  "economic.gdpGrowth": 4.5, // monetaryEra ES 1953; modest recovery under autarky (pre-1959 Stabilization)
  "economic.medianIncome": 14_000, // 1953 nominal pesetas (see header)
  "economic.povertyRate": 35, // post-Civil-War deprivation; autarky food shortages into early 1950s
  "economic.unemploymentRate": 4.5, // open unemployment low; underemployment in agriculture high
  "healthcare.lifeExpectancy": 62, // UN Demographic Yearbook 1950-55 ≈61–63
  "healthcare.nhsWaitingTime": 19, // weeks; SOE (1942) covers formal urban labour only; autarky-era rural Spain barely served
  "education.literacyRate": 89, // INE 1950 Census — national illiteracy ~11%; rural much worse
  "education.highSchoolGradRate": 12, // secondary still elite
  "education.universityEnrollment": 2, // university <2% of adults (INE 1950)
  "population.urbanizationRate": 45, // INE 1950 — rural→urban migration to Catalonia/Madrid barely begun
  "population.medianAge": 28, // high fertility; young pyramid
  // 0-100 fertility INDEX (population.birthRate; metricDefinitions
  // `unit: "index"`), NOT a crude per-1000 rate. Real Spain 1953 TFR ≈2.5
  // (INE) — birthRateIndexToTFR(68, 2.06) = 2.06*(0.4+0.68*1.2) = 2.48. This
  // field was previously ABSENT, so ES fell through seedCohortVectors'
  // DEFAULT_BIRTH_RATE = 50 (TFR 2.06) — understating Francoist-era
  // pronatalist Spain's above-replacement fertility.
  "population.birthRate": 68,
  "population.populationGrowth": 0.9,
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 35, // autarky-era underinvestment
  "environment.protectedLand": 0.8, // % of land; Covadonga/Ordesa (1918) and little else
  "infrastructure.powerGridReliability": 90, // % uptime; autarky-era underinvestment; frequent restrictions
  "infrastructure.waterQuality": 60, // treated-supply index
  "environment.renewableEnergy": 12, // hydro only (Ebro / Duero dams); coal dominant
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 0,
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 48, // very low female formal participation under Catholic social doctrine
  "economic.matchingFriction": 6.0,
  "economic.tradeBalance": -1.5, // chronic import scarcity under autarky
  "economic.productivityGrowth": 3.0, // slow; ISI / INI state industry
  "economic.rdIntensity": 0.15,
  "economic.propertyValueIndex": 18,
  "economic.commercialValueIndex": 20,
  "economic.ruralRevitalization": 72, // ~half the workforce still agricultural
  "economic.foodSecurity": 55, // rationing/scarcity memory; diet improving mid-1950s
  "economic.exportDependency": 8, // closed economy
  "economic.manufacturingCompetitiveness": 42, // INI / SEAT (1950) nascent; textiles in Catalonia
  "economic.regulatoryBurden": 78, // autarkic licensing, price controls
  "economic.economicFreedom": 22, // corporatist command-light economy
  "education.apprenticeshipRate": 2.0,
  "education.academicPressure": 35,
  "healthcare.uninsuredRate": 55, // Seguro Obligatorio de Enfermedad (1944) partial; rural uncovered
  "healthcare.affordabilityIndex": 35,
  "healthcare.mentalHealthAccess": 10,
  "healthcare.socialCareQuality": 18,
  "healthcare.elderCareQuality": 20,
  "infrastructure.transportEfficiency": 32, // RENFE gauge; roads poor outside Madrid–Barcelona
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 28,
  "environment.nuclearSafety": 0,
  "social.childPoverty": 42,
  "social.housingAffordability": 12,
  "social.roughSleeping": 6,
  "social.workLifeBalance": 40,
  "social.foreignWorkerIntegration": 15, // emigration OUT (France/Germany/LatAm), not in
  "social.genderEquality": 12, // Fuero del Trabajo / Catholic social doctrine
  "social.housingSupplyGrowth": 2.0,
  "governance.debtToGdp": 18, // low external debt; closed capital account
  "governance.devolutionSatisfaction": 25, // centralised unitary state; regional languages suppressed
  "governance.nationalPride": 55, // regime nationalist rhetoric; Civil War memory
  "governance.civilLiberties": 12, // dictatorship; press censored; Cortes corporatist
  "governance.militaryReadiness": 48, // large conscript army; NATO not until 1982
  "population.demographicDecline": 5,
  "mediaInformation.stateMediaControl": 90, // No-Do / regime press monopoly
  "mediaInformation.pressFreedom": 8,
  "mediaInformation.disinformationRisk": 8, // pre-viral mass media
  "mediaInformation.mediaPolarization": 10, // monolithic regime media
};

const TILTS_1953: Record<string, Record<string, number>> = {
  ES_MAD: {
    // Madrid — administrative capital, regime bureaucracy
    "economic.medianIncome": 21_000, // ₧; regime bureaucracy + Madrid industry
    "economic.povertyRate": 22,
    "economic.manufacturingCompetitiveness": 48,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 94,
    "education.universityEnrollment": 5,
    "education.highSchoolGradRate": 20,
    "population.urbanizationRate": 72, // esRegionCensusData1953
    "infrastructure.transportEfficiency": 42,
    "social.childPoverty": 28,
  },
  ES_CAT: {
    // Catalonia — industrial powerhouse (Barcelona textiles, chemicals)
    "economic.medianIncome": 22_000, // ₧; richest region (Barcelona textiles/chemicals)
    "economic.povertyRate": 20,
    "economic.manufacturingCompetitiveness": 58,
    "economic.exportDependency": 14,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 95,
    "education.highSchoolGradRate": 22,
    "population.urbanizationRate": 64,
    "infrastructure.transportEfficiency": 45,
    "social.childPoverty": 25,
    "governance.devolutionSatisfaction": 18, // Catalan identity suppressed
  },
  ES_AND: {
    // Andalusia — latifundia, braceros, deepest poverty
    "economic.medianIncome": 8_800, // ₧; bracero day-labour, poorest region
    "economic.povertyRate": 52,
    "economic.ruralRevitalization": 88,
    "healthcare.lifeExpectancy": 59, // rural south lag (UN DYB regional pattern)
    "education.literacyRate": 78, // INE 1950 — Andalusian illiteracy well above national
    "education.highSchoolGradRate": 5,
    "population.urbanizationRate": 30,
    "infrastructure.transportEfficiency": 22,
    "social.childPoverty": 58,
    "healthcare.uninsuredRate": 70,
  },
  ES_VAL: {
    // Valencia & Murcia — citrus/rice; some industry in Valencia city
    "economic.medianIncome": 13_000, // ₧
    "economic.ruralRevitalization": 70,
    "healthcare.lifeExpectancy": 62,
    "education.literacyRate": 88,
    "population.urbanizationRate": 40,
  },
  ES_PVB: {
    // Basque Country & Navarre — Bilbao steel/shipbuilding
    "economic.medianIncome": 22_000, // ₧; Bilbao steel/shipbuilding
    "economic.povertyRate": 18,
    "economic.manufacturingCompetitiveness": 60,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 94,
    "population.urbanizationRate": 58,
    "infrastructure.transportEfficiency": 44,
    "governance.devolutionSatisfaction": 18, // Basque identity suppressed
  },
  ES_GAL: {
    // Galicia — rural, fishing, smallholder; mass emigration to South America
    "economic.medianIncome": 9_400, // ₧; smallholder minifundio
    "economic.povertyRate": 48,
    "economic.ruralRevitalization": 85,
    "healthcare.lifeExpectancy": 60,
    "education.literacyRate": 82,
    "population.urbanizationRate": 22,
    "infrastructure.transportEfficiency": 24,
    "social.childPoverty": 52,
    "population.demographicDecline": 12, // emigration
  },
  ES_NOR: {
    // Asturias / Cantabria / Aragón / Rioja — coal, steel, wine
    "economic.medianIncome": 15_000, // ₧
    "economic.manufacturingCompetitiveness": 52,
    "healthcare.lifeExpectancy": 62,
    "education.literacyRate": 90,
    "population.urbanizationRate": 44,
  },
  ES_CEN: {
    // Castile-La Mancha / Extremadura / islands — wheat, sheep, subsistence
    "economic.medianIncome": 10_000, // ₧
    "economic.povertyRate": 45,
    "economic.ruralRevitalization": 82,
    "healthcare.lifeExpectancy": 60,
    "education.literacyRate": 84,
    "population.urbanizationRate": 28,
    "social.childPoverty": 50,
  },
};

export const esMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  ES_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
