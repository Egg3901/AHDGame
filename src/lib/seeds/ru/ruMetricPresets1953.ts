import type { MetricPresetBundle } from "@/lib/seeds/uk/ukMetricPresets";

/**
 * 1953 USSR — Stalin's death (March 1953); Khrushchev consolidating power. Late-Stalinist
 * command economy at the peak of forced industrialization and post-war reconstruction
 * (GDP growth ~6%, well above the Brezhnev-era ~2.5% the base ruStateMetrics bundle is
 * authored for). Population still war-scarred: ~26 median age (WWII killed ~27M, skewing
 * the pyramid young), life expectancy ~60-62 and climbing fast, birth rate high. Gulag at
 * its maximum extent (~2.5M in camps — incarceration far above the 1979 level). Doctors'
 * Plot, total press control, closed borders. Literacy campaigns near-complete among the
 * young but older rural cohorts lag (~87% overall vs 99% by 1979). Urbanization ~44%
 * (vs ~62% in 1979). First H-bomb test August 1953; no civilian nuclear power until
 * Obninsk 1954.
 *
 * The base `ruStateMetrics` bundle carries ~1979 values, while `seedRUBaselines` runs
 * `applyEra1953BaselineAdjustments` for the 1953 preset — without this overlay the seeded
 * metrics and their decay baselines disagree from turn 1 (artificial glide). This overlay
 * is applied to BOTH the metrics and the baselines (mirroring the UK/DE/JP 1953 pattern),
 * so every covered path lands exactly on its decay target at seed.
 */

const RU_REGIONS = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (must match their 1953 baselines — anti-glide) ──────────────
  "economic.gdpGrowth": 6.0, // forced industrialization + post-war reconstruction boom
  // #income-gdp-scale-audit: the prior 1,600 measured out at ratio 0.213x GDP
  // per capita (₽1.4T / 188M = ₽7,447; medianIncomeGdpScale1953.test.ts band
  // is [0.8, 2.6]), badly UNDER-scaled — and implausible against the real
  // historical record: the average Soviet MONTHLY wage in the early 1950s ran
  // ~700-720 pre-1961 rubles (a single wage-earner's annual wage alone is
  // ~8,400-8,600), so a 1,600-ruble ANNUAL household figure undershot a
  // single earner's wage by a factor of ~5. Rescaled ~6.6x to ₽10,500
  // (ratio ~1.4), preserving the CEN/NWR-high, CAS/MOL-low regional gradient.
  // INCOME_ANCHORS.RU 1953 (metricCatalog.ts) is re-anchored to match, per
  // that table's own stated rule ("follow the overlay's scale").
  "economic.medianIncome": 10_500, // annual household rubles
  "economic.povertyRate": 22, // post-war deprivation; 1946-47 famine within memory
  "healthcare.lifeExpectancy": 61, // recovering fast but far below the West
  "healthcare.uninsuredRate": 0, // universal state healthcare (pins baseline; the generic
  // 1953 rule would push the baseline to 30 — wrong for the USSR)
  "population.medianAge": 26, // war losses skewed the pyramid young
  "population.birthRate": 52, // high post-war fertility (0-100 index; see uniformStateMetrics)
  "population.urbanizationRate": 44, // pre-Khrushchev urbanization wave
  "population.populationGrowth": 1.7, // post-war recovery boom
  "population.demographicDecline": 5, // very young population
  "education.literacyRate": 87, // likbez campaigns near-done among the young; older rural cohorts lag
  "education.highSchoolGradRate": 25, // seven-year school standard; full secondary still elite
  "education.testPerformance": 80,
  "governance.voterTurnout": 99, // single-list elections (pins baseline vs the ≤80 democratic clamp)
  "governance.debtToGdp": 15, // minimal external debt
  "publicSafety.crimeRate": 1_000, // post-war banditry receding under police state
  "publicSafety.violentCrimeRate": 85,
  "publicSafety.incarcerationRate": 1_400, // Gulag at maximum extent (~2.5M in camps)
  "mediaInformation.pressFreedom": 3, // total state control (Stalin; Doctors' Plot era)
  "mediaInformation.newsTrust": 50,
  "mediaInformation.disinformationRisk": 5, // era rule: no viral misinformation channels
  "mediaInformation.mediaPolarization": 5, // monolithic state media
  // Windowed policy roots era-zeroed (match stateBaselines1953's hold-at-0 rule)
  "environment.renewableEnergy": 0,
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 0,
  // ── Extended (uniform) paths — same coverage as the UK 1953 overlay where applicable ──
  "economic.laborParticipation": 80, // women fully mobilized, slightly below the 1979 peak
  "economic.matchingFriction": 4, // command allocation of labor
  "economic.tradeBalance": 0.5,
  "economic.productivityGrowth": 4.5, // catch-up industrialization
  "economic.rdIntensity": 2.5, // atomic program, military-industrial R&D
  "economic.propertyValueIndex": 10, // no private property market
  "economic.commercialValueIndex": 8,
  "economic.ruralRevitalization": 60, // collectivized agriculture; majority-rural country
  "economic.foodSecurity": 45, // collectivization inefficiency, chronic shortages
  "economic.exportDependency": 6, // near-autarky, Comecon barter only
  "economic.manufacturingCompetitiveness": 55, // heavy industry strong, consumer goods weak
  "economic.regulatoryBurden": 95, // total command economy
  "economic.economicFreedom": 5,
  "education.universityEnrollment": 5, // expanding Soviet higher education
  "education.apprenticeshipRate": 8, // FZO / labor-reserve trade schools
  "education.academicPressure": 55,
  "healthcare.affordabilityIndex": 65, // free at point of use but scarce
  "healthcare.mentalHealthAccess": 5, // asylums; punitive psychiatry emerging
  "healthcare.socialCareQuality": 25,
  "healthcare.elderCareQuality": 30,
  "infrastructure.transportEfficiency": 45, // rail-heavy; roads poor
  "publicSafety.antiSocialBehaviourRate": 4,
  "publicSafety.knifeCrimeRate": 2,
  "publicSafety.firearmRights": 3, // strict state monopoly on arms
  "environment.floodRisk": 10,
  "environment.naturalDisasterPreparedness": 35,
  "environment.nuclearSafety": 0, // no civilian nuclear until Obninsk 1954
  "social.childPoverty": 40, // post-war deprivation, war orphans
  "social.housingAffordability": 60, // severe overcrowding — kommunalka pressure index (lower is better)
  "social.roughSleeping": 3,
  "social.workLifeBalance": 40, // long hours, six-day week
  "social.foreignWorkerIntegration": 20, // closed borders
  "social.genderEquality": 55, // formal equality, women in the workforce
  "social.housingSupplyGrowth": 1.5, // mass housing (khrushchevka) wave starts 1955+
  "governance.devolutionSatisfaction": 30, // hyper-centralized union
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 85, // WWII victory, superpower status
  "governance.civilLiberties": 3, // late-Stalinist terror
  "governance.militaryReadiness": 90, // massive conscript army; Korean War; H-bomb Aug 1953
  "governance.borderSecurity": 95, // Iron Curtain
  "mediaInformation.stateMediaControl": 98,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  CEN: {
    // Moscow core — regime showcase
    "economic.medianIncome": 13_800,
    "healthcare.lifeExpectancy": 64,
    "population.urbanizationRate": 58,
    "population.medianAge": 28,
    "education.literacyRate": 94,
    "education.highSchoolGradRate": 35,
    "infrastructure.transportEfficiency": 60, // Metro, rail hub
    "social.childPoverty": 32,
  },
  NWR: {
    // Leningrad — siege-scarred but industrial showcase
    "economic.medianIncome": 13_100,
    "healthcare.lifeExpectancy": 63,
    "population.urbanizationRate": 62,
    "population.medianAge": 28,
    "education.literacyRate": 94,
    "education.highSchoolGradRate": 34,
    "infrastructure.transportEfficiency": 55,
  },
  URA: {
    // Urals — wartime-relocated heavy industry
    "economic.medianIncome": 11_500,
    "economic.manufacturingCompetitiveness": 65,
    "population.urbanizationRate": 55,
    "publicSafety.incarcerationRate": 1_800, // camp-belt geography
  },
  WSB: {
    "economic.medianIncome": 11_200,
    "population.urbanizationRate": 48,
    "publicSafety.incarcerationRate": 1_900,
  },
  ESB: {
    "economic.medianIncome": 10_800,
    "population.urbanizationRate": 46,
    "publicSafety.incarcerationRate": 2_400, // Norillag and the eastern camp complexes
    "healthcare.lifeExpectancy": 58,
  },
  FEA: {
    "economic.medianIncome": 11_200,
    "population.urbanizationRate": 50,
    "publicSafety.incarcerationRate": 2_600, // Kolyma / Magadan
    "healthcare.lifeExpectancy": 57,
  },
  CBE: {
    "economic.medianIncome": 9_200,
    "healthcare.lifeExpectancy": 60,
    "population.urbanizationRate": 36,
    "economic.foodSecurity": 42,
  },
  VOL: {
    "economic.medianIncome": 9_800,
    "population.urbanizationRate": 42,
  },
  NOR: {
    "economic.medianIncome": 10_800,
    "population.urbanizationRate": 46,
    "publicSafety.incarcerationRate": 2_000, // White Sea camp legacy
    "healthcare.lifeExpectancy": 59,
  },
  NCA: {
    "economic.medianIncome": 8_900,
    "population.urbanizationRate": 34,
    "healthcare.lifeExpectancy": 62,
    "population.birthRate": 58,
  },
  KAZ: {
    // Virgin Lands campaign begins 1954; deportee populations
    "economic.medianIncome": 8_500,
    "population.urbanizationRate": 32,
    "population.medianAge": 23,
    "population.birthRate": 60,
    "education.literacyRate": 78,
    "publicSafety.incarcerationRate": 2_200, // Karlag / Steplag
  },
  TRA: {
    // Caucasus — longevity pocket, grey-market agriculture
    "economic.medianIncome": 8_900,
    "healthcare.lifeExpectancy": 65,
    "population.urbanizationRate": 34,
    "population.birthRate": 58,
    "education.literacyRate": 82,
  },
  CAS: {
    // Central Asia — poorest, youngest, most rural
    "economic.medianIncome": 7_200,
    "economic.povertyRate": 32,
    "healthcare.lifeExpectancy": 56,
    "population.medianAge": 21,
    "population.birthRate": 68,
    "population.populationGrowth": 2.8,
    "population.urbanizationRate": 26,
    "education.literacyRate": 68,
    "social.genderEquality": 35,
    "social.childPoverty": 55,
  },
  MOL: {
    // Annexed 1940/1944; sovietization + 1946-47 famine epicentre
    "economic.medianIncome": 7_900,
    "economic.foodSecurity": 38,
    "healthcare.lifeExpectancy": 59,
    "population.urbanizationRate": 24,
    "education.literacyRate": 72,
    "population.birthRate": 58,
  },
};

export const ruMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  RU_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
