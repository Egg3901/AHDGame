/**
 * Turkey 1953 metric overlays — Democrat Party agrarian modernisation.
 *
 * Base `trStateMetrics` is authored on ~1979 (pre-coup crisis) values. Without
 * this overlay a 1953-default world keeps 1979 life expectancy (~58), literacy
 * 65, and urbanization (~45) — still far too modern for 1953 Turkey, which was
 * ~75% agricultural, literacy ≈34% nationally (TÜİK 1955 census), and life
 * expectancy near 44 (UN Demographic Yearbook 1950-55). Region ids match
 * `trRegionCensusData1953`.
 *
 * `medianIncome` is annual household income in 1953 NOMINAL lira, the unit the
 * 1953 GDP seed is denominated in (budgets.ts TR FY1953: ₺24B, ~2.8 TRL/USD).
 *
 * The original authoring took `1979 nominal ₺120,000 × 0.40` (the Maddison
 * Project REAL GDP/cap ratio 1953≈1,600 vs 1979≈4,000 1990 Int$) and called
 * the result a 1953 nominal lira figure. Applying a real-volume ratio to a
 * nominal value skips the price level, and the lira lost roughly an order of
 * magnitude of purchasing power between the Menderes boom and the pre-coup
 * inflation of 1979 (TÜİK consumer price series, 1953→1979 ≈ 10×). The
 * nominal chain is
 *
 *   ₺_1953 = ₺_1979 × 0.40 (real income ratio) ÷ ~10 (TÜİK price level)
 *
 * i.e. roughly ₺_1979 / 25 — the figures below are the previous ones ÷ 25.
 *
 * Cross-check against the seed's own national accounts: GDP/capita = ₺24B /
 * 22.5M = ₺1,067, so the ~₺2,035 population-weighted median household (3.2
 * persons) is ~1.9× GDP/capita, i.e. aggregate household income ≈ 60% of GDP.
 * At the 2.8 TRL/USD Bretton Woods rate that is a $727/year household against
 * $381 GDP/capita — consistent with the contemporary IBRD estimate of Turkish
 * per-capita income in the high-$300s. Broadband/internet did not exist;
 * electrification was largely confined to big cities (TEK predecessor coverage).
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const TR_REGIONS = [
  "TR_IST",
  "TR_ANK",
  "TR_IZM",
  "TR_MED",
  "TR_BLA",
  "TR_ESA",
  "TR_SEA",
  "TR_CEN",
] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 trStateMetrics) ──
  "economic.gdpGrowth": 6.0, // monetaryEra TR 1953; Marshall Plan + agricultural boom
  "economic.medianIncome": 1_900, // 1953 nominal lira (see header)
  "economic.povertyRate": 48, // absolute rural poverty dominant
  "economic.unemploymentRate": 5.0, // open unemployment low; agrarian underemployment high
  "healthcare.lifeExpectancy": 44, // UN Demographic Yearbook 1950-55 ≈43–46
  "healthcare.nhsWaitingTime": 24, // weeks; public provision concentrated in Ankara/Istanbul; Anatolia largely unserved
  "education.literacyRate": 34, // TÜİK 1955 census — national literacy ≈34%
  "education.highSchoolGradRate": 5, // secondary tiny outside cities
  "education.universityEnrollment": 0.8, // Ankara/Istanbul universities only
  "population.urbanizationRate": 25, // ~75% agricultural (TÜİK / census header)
  "population.medianAge": 20, // very young; high fertility
  // 0-100 fertility INDEX (population.birthRate; metricDefinitions
  // `unit: "index"`), NOT a crude per-1000 rate — the comment above ("very
  // young; high fertility") on medianAge was never followed through with an
  // actual birthRate field, so TR fell through seedCohortVectors'
  // DEFAULT_BIRTH_RATE = 50 (replacement TFR 2.06) despite a real 1953 TFR
  // ≈6.5 (TÜİK) — one of the largest gaps of any seeded country. Set to the
  // model's own CEILING: birthRateIndexToTFR(100, 2.06) = 2.06*1.6 = 3.296 is
  // the highest TFR this 0-100 index can represent at all (see
  // demographics/flows/fertility.ts's `birthRateIndexToTFR`), so 100 is the
  // closest available approximation, not a full fix — a real ~6.5 TFR is
  // structurally outside the model's representable range. seedSynthesis.ts's
  // own doc comment flags this exact TR 1953 case as the reference example
  // of the median-age/birth-rate envelope-clamp failure mode.
  "population.birthRate": 100,
  "population.populationGrowth": 2.5,
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 26, // Anatolia largely unpaved
  "environment.protectedLand": 0.3, // % of land; protection framework barely started
  "infrastructure.powerGridReliability": 85, // % uptime; Ankara/Istanbul served; Anatolia largely off-grid
  "infrastructure.waterQuality": 42, // treated-supply index
  "environment.renewableEnergy": 5, // early hydro only
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 0, // unelectrified countryside
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 55, // subsistence agriculture absorbs labour; low female formal
  "economic.matchingFriction": 7.0,
  "economic.tradeBalance": -1.0, // importing machinery; exporting tobacco/cotton/figs
  "economic.productivityGrowth": 4.0, // tractorisation / land redistribution underway
  "economic.rdIntensity": 0.1,
  "economic.propertyValueIndex": 12,
  "economic.commercialValueIndex": 14,
  "economic.ruralRevitalization": 88, // overwhelmingly agrarian
  "economic.foodSecurity": 58, // improving with Marshall Plan agriculture
  "economic.exportDependency": 12, // cash-crop exports
  "economic.manufacturingCompetitiveness": 22, // Sümerbank / Etibank state industry thin
  "economic.regulatoryBurden": 55,
  "economic.economicFreedom": 38, // Democrat Party liberalisation vs prior etatism
  "education.apprenticeshipRate": 1.0,
  "education.academicPressure": 25,
  "healthcare.uninsuredRate": 85, // almost no formal health coverage outside cities
  "healthcare.affordabilityIndex": 22,
  "healthcare.mentalHealthAccess": 5,
  "healthcare.socialCareQuality": 12,
  "healthcare.elderCareQuality": 15, // extended-family care only
  "infrastructure.transportEfficiency": 22, // TCDD rail spine; rural roads poor
  "publicSafety.antiSocialBehaviourRate": 6,
  "publicSafety.knifeCrimeRate": 3,
  "environment.floodRisk": 16,
  "environment.naturalDisasterPreparedness": 18, // seismic risk unmanaged
  "environment.nuclearSafety": 0,
  "social.childPoverty": 62,
  "social.housingAffordability": 10, // gecekondu beginning in Istanbul
  "social.roughSleeping": 5,
  "social.workLifeBalance": 35,
  "social.foreignWorkerIntegration": 20, // Greek/Armenian/Jewish minorities in Istanbul; guest-worker outflow not yet
  "social.genderEquality": 18, // legal equality (1920s reforms) vs rural patriarchal practice
  "social.housingSupplyGrowth": 2.5,
  "governance.debtToGdp": 22,
  "governance.devolutionSatisfaction": 30, // highly centralised; east under military-admin pressure
  "governance.nationalPride": 65,
  "governance.civilLiberties": 40, // multi-party since 1946; press freer than later military eras
  "governance.militaryReadiness": 55, // NATO member (1952); Korean War brigade
  "population.demographicDecline": 2,
  "mediaInformation.stateMediaControl": 45, // TRT radio public; party press competitive
  "mediaInformation.pressFreedom": 45,
  "mediaInformation.disinformationRisk": 10,
  "mediaInformation.mediaPolarization": 35,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  TR_IST: {
    // Istanbul / Marmara — commerce, minorities, wealthiest region
    "economic.medianIncome": 3_400, // ₺; wealthiest region, commercial Istanbul
    "economic.povertyRate": 28,
    "economic.manufacturingCompetitiveness": 38,
    "economic.exportDependency": 20,
    "healthcare.lifeExpectancy": 48, // urban health advantage (UN DYB pattern)
    "education.literacyRate": 55, // TÜİK urban literacy well above national
    "education.universityEnrollment": 3,
    "education.highSchoolGradRate": 12,
    "population.urbanizationRate": 62, // trRegionCensusData1953
    "infrastructure.transportEfficiency": 35,
    "healthcare.uninsuredRate": 65,
    "social.childPoverty": 40,
    "social.foreignWorkerIntegration": 35,
  },
  TR_ANK: {
    // Ankara — planned capital; civil service / military educated class
    "economic.medianIncome": 3_000, // ₺; civil-service salaries
    "economic.povertyRate": 30,
    "healthcare.lifeExpectancy": 47,
    "education.literacyRate": 52,
    "education.universityEnrollment": 4,
    "education.highSchoolGradRate": 14,
    "population.urbanizationRate": 55,
    "infrastructure.transportEfficiency": 32,
    "healthcare.uninsuredRate": 68,
    "social.childPoverty": 42,
  },
  TR_IZM: {
    // İzmir / Aegean — export agriculture; coastal commerce
    "economic.medianIncome": 2_800, // ₺
    "economic.povertyRate": 32,
    "economic.exportDependency": 22, // tobacco, figs, cotton
    "healthcare.lifeExpectancy": 47,
    "education.literacyRate": 48,
    "population.urbanizationRate": 50,
    "social.childPoverty": 45,
  },
  TR_MED: {
    // Mediterranean — cotton/citrus; Adana industrial hub
    "economic.medianIncome": 1_800, // ₺
    "economic.povertyRate": 48,
    "healthcare.lifeExpectancy": 44,
    "education.literacyRate": 32,
    "population.urbanizationRate": 40,
    "social.childPoverty": 60,
  },
  TR_BLA: {
    // Black Sea — tea, hazelnuts; dense coastal strip, very rural
    "economic.medianIncome": 1_600, // ₺
    "economic.povertyRate": 52,
    "economic.ruralRevitalization": 90,
    "healthcare.lifeExpectancy": 43,
    "education.literacyRate": 30,
    "population.urbanizationRate": 28,
    "infrastructure.transportEfficiency": 18,
    "social.childPoverty": 65,
  },
  TR_ESA: {
    // Eastern Anatolia — underdeveloped; large Kurdish minority
    "economic.medianIncome": 1_100, // ₺
    "economic.povertyRate": 65,
    "economic.ruralRevitalization": 95,
    "healthcare.lifeExpectancy": 41, // floor of era band; remote care
    "education.literacyRate": 18, // TÜİK east illiteracy extreme
    "education.highSchoolGradRate": 2,
    "population.urbanizationRate": 24,
    "infrastructure.transportEfficiency": 12,
    "healthcare.uninsuredRate": 95,
    "social.childPoverty": 78,
    "governance.civilLiberties": 28,
  },
  TR_SEA: {
    // SE Anatolia — Kurdish majority; poorest region
    "economic.medianIncome": 1_000, // ₺; subsistence smallholding, poorest region
    "economic.povertyRate": 68,
    "economic.ruralRevitalization": 96,
    "healthcare.lifeExpectancy": 40, // era-band floor (UN DYB southeast lag)
    "education.literacyRate": 15,
    "education.highSchoolGradRate": 1,
    "population.urbanizationRate": 26,
    "infrastructure.transportEfficiency": 10,
    "healthcare.uninsuredRate": 96,
    "social.childPoverty": 82,
    "governance.civilLiberties": 25,
  },
  TR_CEN: {
    // Central Anatolia — grain farming, Konya plain; rural conservative
    "economic.medianIncome": 1_500, // ₺
    "economic.povertyRate": 52,
    "economic.ruralRevitalization": 90,
    "economic.foodSecurity": 65,
    "healthcare.lifeExpectancy": 43,
    "education.literacyRate": 28,
    "population.urbanizationRate": 35,
    "social.childPoverty": 64,
  },
};

export const trMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  TR_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
