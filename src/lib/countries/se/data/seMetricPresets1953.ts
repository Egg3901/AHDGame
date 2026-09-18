/**
 * Sweden 1953 metric overlays — Social Democratic welfare expansion.
 *
 * Base `seStateMetrics` is authored on ~1979 (peak Swedish model) values.
 * Without this overlay a 1953-default world keeps 1979 life expectancy (~75.5)
 * and near-peak welfare metrics, flattening the fact that 1953 Sweden was
 * already among the world's healthiest (~72; SCB / UN Demographic Yearbook
 * 1950-55) but still far from 1970s coverage depth. Region ids match
 * `seRegionCensusData1953`.
 *
 * `medianIncome` is annual household kronor, re-derived (#income-gdp-scale-audit)
 * against the 1953 budget's own GDP/capita rather than Maddison-scaled off the
 * 1979 nominal figure — the old method applied a REAL GDP/capita ratio to a
 * NOMINAL income value (the same mistake diagnosed and fixed for FR/ES/TR),
 * which produced a ~10x-too-high household income. See NATIONAL_1953's
 * medianIncome comment below for the corrected derivation.
 * Broadband/internet did not exist; household electrification was already
 * near-universal outside remote Norrland (SCB energy statistics).
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const SE_REGIONS = [
  "SE_STH",
  "SE_GOT",
  "SE_SKA",
  "SE_EAS",
  "SE_SML",
  "SE_VML",
  "SE_NOR",
  "SE_UPP",
] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 seStateMetrics) ──
  "economic.gdpGrowth": 3.5, // monetaryEra SE 1953 trendGdpGrowth; steady post-war growth
  // #income-gdp-scale-audit: the old 50,000 (a Maddison REAL GDP/capita ratio
  // applied to the 1979 NOMINAL income figure — the same authoring mistake
  // already diagnosed and fixed for FR/ES/TR) measured out at ratio 10.03x
  // GDP/capita (kr 36B / 7.17M = kr 5,021; medianIncomeGdpScale1953.test.ts
  // band is [0.8, 2.6]). Re-authored at 8,000 (ratio ~1.6, matching the US
  // 1953 reference ratio of ~1.59).
  "economic.medianIncome": 8_000,
  "economic.povertyRate": 12, // means-tested welfare expanding; absolute poverty low for Europe
  "economic.unemploymentRate": 2.5, // active labour-market policy precursors; near-full employment
  "healthcare.lifeExpectancy": 72, // SCB / UN Demographic Yearbook 1950-55 — among world highest
  "healthcare.nhsWaitingTime": 6, // weeks; county-run system already dense and well-funded; highest physician density in the sample
  "education.literacyRate": 99, // SCB — functional literacy essentially universal
  "education.highSchoolGradRate": 28, // realskola/gymnasium still selective
  "education.universityEnrollment": 3.5, // <4% everywhere (seRegionCensusData1953 header)
  "population.urbanizationRate": 65, // SCB 1950 — urban majority but large rural interior
  "population.medianAge": 34, // older than Mediterranean peers
  // 0-100 fertility INDEX (population.birthRate; metricDefinitions
  // `unit: "index"`), NOT a crude per-1000 rate. Real Sweden 1953 TFR ≈2.2
  // (SCB) — birthRateIndexToTFR(56, 2.06) = 2.06*(0.4+0.56*1.2) = 2.22. This
  // field was previously ABSENT, so SE fell through seedCohortVectors'
  // DEFAULT_BIRTH_RATE = 50 (TFR 2.06) — close for Sweden (already a low-
  // fertility outlier even in 1953) but not authored, so any turn-engine
  // change to the neutral default would silently drift SE along with it.
  "population.birthRate": 56,
  "population.populationGrowth": 0.6,
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 62, // neutral in WWII, roads intact
  "environment.protectedLand": 3.2, // % of land; Europe's first national parks (1909), still small in area
  "infrastructure.powerGridReliability": 97, // % uptime; hydro grid mature; near-universal treated supply
  "infrastructure.waterQuality": 88, // treated-supply index
  "environment.renewableEnergy": 35, // large hydro base already (Norrland rivers)
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 5, // hydro; no commercial nuclear until Ågesta 1964
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 62, // rising female participation but below 1970s peak
  "economic.matchingFriction": 3.0,
  "economic.tradeBalance": 0.5, // export engineering (ASEA, SKF, Volvo)
  "economic.productivityGrowth": 3.5,
  "economic.rdIntensity": 1.2, // strong industrial R&D for country size
  "economic.propertyValueIndex": 32,
  "economic.commercialValueIndex": 34,
  "economic.ruralRevitalization": 48, // agriculture still ~20% of workforce (SCB)
  "economic.foodSecurity": 78,
  "economic.exportDependency": 24,
  "economic.manufacturingCompetitiveness": 78, // engineering / pulp / iron ore
  "economic.regulatoryBurden": 48, // social-market; less dirigiste than FR
  "economic.economicFreedom": 58,
  "education.apprenticeshipRate": 4.0,
  "education.academicPressure": 40,
  "healthcare.uninsuredRate": 2, // sjukförsäkring expanding toward universal (1955 reform imminent)
  "healthcare.affordabilityIndex": 75,
  "healthcare.mentalHealthAccess": 28,
  "healthcare.socialCareQuality": 48,
  "healthcare.elderCareQuality": 45,
  "infrastructure.transportEfficiency": 58, // SJ rail strong; roads adequate
  "publicSafety.antiSocialBehaviourRate": 2,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 8,
  "environment.naturalDisasterPreparedness": 55,
  "environment.nuclearSafety": 0, // no commercial nuclear yet
  "social.childPoverty": 12,
  "social.housingAffordability": 16, // pre-Million Programme (1965–74); urban shortage
  "social.roughSleeping": 2,
  "social.workLifeBalance": 55,
  "social.foreignWorkerIntegration": 35, // small Finnish labour contingent only
  "social.genderEquality": 42, // ahead of most of Europe; still far from 1970s
  "social.housingSupplyGrowth": 2.8,
  "governance.debtToGdp": 22,
  "governance.devolutionSatisfaction": 55, // län autonomy moderate
  "governance.coDeterminationQuality": 55, // LO/SAF Saltsjöbaden (1938); MBL is 1976
  "governance.nationalPride": 68,
  "governance.civilLiberties": 85, // freest press in Europe
  "governance.militaryReadiness": 62, // armed neutrality; large conscript force
  "population.demographicDecline": 10,
  "mediaInformation.stateMediaControl": 25, // Sveriges Radio public; press free
  "mediaInformation.pressFreedom": 90,
  "mediaInformation.disinformationRisk": 8,
  "mediaInformation.mediaPolarization": 22,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  SE_STH: {
    // Stockholm — commercial hub; highest income/education
    "economic.medianIncome": 9_900,
    "economic.unemploymentRate": 1.8,
    "economic.povertyRate": 8,
    "healthcare.lifeExpectancy": 72, // SCB urban peak; era band ceiling [40, 72]
    "education.universityEnrollment": 5,
    "education.highSchoolGradRate": 35,
    "population.urbanizationRate": 90, // seRegionCensusData1953
    "infrastructure.transportEfficiency": 68,
    "social.childPoverty": 8,
    "social.housingAffordability": 12,
  },
  SE_GOT: {
    // Göteborg — shipbuilding, Volvo/SKF engineering
    "economic.medianIncome": 8_600,
    "economic.manufacturingCompetitiveness": 82,
    "economic.exportDependency": 32,
    "healthcare.lifeExpectancy": 72,
    "population.urbanizationRate": 76,
    "infrastructure.transportEfficiency": 62,
  },
  SE_SKA: {
    // Skåne — mixed farming / industry; Malmö centre
    "economic.medianIncome": 7_700,
    "economic.ruralRevitalization": 55,
    "economic.foodSecurity": 82,
    "healthcare.lifeExpectancy": 72,
    "population.urbanizationRate": 55,
  },
  SE_EAS: {
    // Eastern Sweden (Östergötland) — manufacturing + rural
    "economic.medianIncome": 7_500,
    "economic.ruralRevitalization": 52,
    "healthcare.lifeExpectancy": 71.5,
    "population.urbanizationRate": 52,
  },
  SE_SML: {
    // Småland — rural small-export industry; religious nonconformists
    "economic.medianIncome": 7_000,
    "economic.ruralRevitalization": 62,
    "healthcare.lifeExpectancy": 71.5,
    "population.urbanizationRate": 40,
    "population.medianAge": 36,
  },
  SE_VML: {
    // Bergslagen — iron ore, steel; strong union density
    "economic.medianIncome": 7_700,
    "economic.manufacturingCompetitiveness": 80,
    "healthcare.lifeExpectancy": 71.5,
    "population.urbanizationRate": 56,
    "governance.coDeterminationQuality": 62,
  },
  SE_NOR: {
    // Norrland — forestry, hydropower; sparse; Sámi minority
    "economic.medianIncome": 7_000,
    "economic.unemploymentRate": 3.5,
    "economic.ruralRevitalization": 70,
    "healthcare.lifeExpectancy": 70.5, // remote-care lag vs Stockholm
    "education.universityEnrollment": 2,
    "population.urbanizationRate": 35,
    "infrastructure.transportEfficiency": 45,
    "environment.renewableEnergy": 55, // hydro heartland
  },
  SE_UPP: {
    // Uppsala & Dalarna — Uppsala University lifts education
    "economic.medianIncome": 8_300,
    "education.universityEnrollment": 9,
    "education.highSchoolGradRate": 32,
    "healthcare.lifeExpectancy": 72,
    "population.urbanizationRate": 48,
  },
};

export const seMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  SE_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
