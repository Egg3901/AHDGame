import type { MetricPresetBundle } from "@/lib/seeds/cn/cnMetricPresets";

/**
 * 1953 China — Mao Zedong / PRC First Five-Year Plan (1953-57); Korean War ending (armistice
 * July 1953); agricultural collectivisation beginning (mutual aid teams → cooperatives);
 * Soviet-model industrialisation; population ~588M. Life expectancy ~42–44 (up from ~36 in 1949).
 * Near-total illiteracy (60-70%); literacy campaign underway. No nuclear (first test 1964).
 * State media monopoly. Gender equality promoted in Mao ideology (Marriage Law 1950) but deeply
 * patriarchal in practice outside cities. Massive rural poverty; Hukou system establishing.
 *
 * `seedCNStateMetrics` overlays this onto modern `cnStateMetrics` with a PARTIAL merge — any
 * path absent here silently retains the ~2023 base. Core economic/demographic paths below
 * (gdpGrowth, medianIncome, povertyRate, urbanizationRate, …) pin against that leak; values
 * follow `metricCatalog` CORE5 / INCOME_ANCHORS where authored, and `cnRegionCensusData1953`
 * for regional urbanization tilts. Windowed roots that baselines zero (broadband, social
 * credit, Belt-and-Road, social media) are pinned here too so metrics and baselines agree.
 */

const CN_REGIONS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (modern cnStateMetrics leaks without these — anti-anachronism) ──
  "economic.gdpGrowth": 6.0, // metricCatalog CORE5 CN 1953; 1st FYP reconstruction boom
  // #income-gdp-scale-audit: the 1953 CN budget GDP (NATIONAL_BUDGET_SEED_CONFIGS_1953)
  // is USD-anchored ($33.3B; ¥CNY 82B / 2.46, like US/DE/JP/NG/IT), but this
  // overlay's old 400 was mislabeled "USD-anchored" while actually tracking a
  // stale CNY-nominal figure (¥1,000 pre-#3498) — the two conventions never
  // matched, so the ratio came out 7.2x GDP/capita ($33.3B / 588M = $56.63;
  // medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]). Re-authored in the
  // GDP's actual USD convention: $80 national (ratio ~1.45) — plausible for
  // 1953 China, among the poorest countries in the world at official exchange
  // rates (nominal, not PPP).
  "economic.medianIncome": 80,
  "economic.povertyRate": 30, // metricCatalog CORE5 CN 1953 (gameplay-scaled; absolute poverty higher)
  "economic.unemploymentRate": 4.5, // metricCatalog CORE5 CN 1953; open unemployment low under command
  "economic.smallBusinessFormation": 0.5, // private enterprise nationalised; residual peddlers only
  "economic.commonProsperityIndex": 20, // matches stateBaselines1953; slogan/campaign is 2021-era
  "healthcare.lifeExpectancy": 42, // metricCatalog CORE5 CN 1953
  "healthcare.nhsWaitingTime": 30, // weeks; pre-barefoot-doctor (1960s); rural provision essentially absent in 1953
  "education.literacyRate": 32, // mid of CN literacy band (best 50 / worst 15); ~60-70% illiterate
  "population.urbanizationRate": 12, // NBS 1953 ~11% urban; header 88% rural
  // UN WPP 1950 China median age 23.9 / 1955 22.2 → ~23.3 in 1953. Prior overlay
  // wrongly pinned 30 (a ~2000 China); seedCN does not run the 1953 adjuster.
  "population.medianAge": 23,
  // 0–100 fertility INDEX. TFR ~6 in the early PRC (pre-wan-xi-shao); young
  // high-fertility peer of RU CAS (age 21 → index 68). Formula at 23 ≈ 53.5
  // would understate the boom.
  "population.birthRate": 64,
  "population.populationGrowth": 2.0, // high fertility after 1950 stabilisation (vs modern −0.1)
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 14, // minimal road network outside the treaty ports
  "environment.protectedLand": 0.2, // % of land; no protection regime yet
  "infrastructure.powerGridReliability": 78, // % uptime; pre-industrial grid outside the treaty ports; rural water untreated
  "infrastructure.waterQuality": 28, // treated-supply index
  "environment.renewableEnergy": 0, // coal (+ early hydro); match baseline hold-at-0
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "governance.socialCreditCoverage": 0, // system did not exist
  "governance.beltAndRoadEngagement": 0, // BRI is 2013+
  "mediaInformation.socialMediaSentiment": 0, // no platforms
  "mediaInformation.pressFreedom": 5, // total party-state press; Xinhua monopoly
  "mediaInformation.disinformationRisk": 5, // pre-viral mass media (propaganda ≠ viral misinfo)
  "mediaInformation.mediaPolarization": 8, // monolithic state media

  // ── Extended (uniform) paths — same coverage style as 1991/2019 CN overlays ──
  "economic.laborParticipation": 68, // collectivist pressure on all to work
  "economic.matchingFriction": 8.0, // command allocation, not markets
  "economic.tradeBalance": -1.0, // importing Soviet machinery
  "economic.productivityGrowth": 6.0, // base-level growth from reconstruction
  "economic.rdIntensity": 0.2,
  "economic.propertyValueIndex": 5, // private property abolished
  "economic.commercialValueIndex": 5, // no commercial real estate
  "economic.ruralRevitalization": 90, // overwhelmingly rural (88% rural)
  "economic.foodSecurity": 52, // land reform improving distribution; famines recent
  "economic.exportDependency": 8, // minimal trade; Soviet barter mostly
  "economic.manufacturingCompetitiveness": 25, // starting from pre-industrial base
  "economic.regulatoryBurden": 90, // command economy — everything regulated
  "economic.economicFreedom": 5, // near-zero — command economy
  "education.highSchoolGradRate": 8, // most never finish primary
  "education.universityEnrollment": 0.5,
  "education.apprenticeshipRate": 1.0,
  "education.academicPressure": 30,
  "healthcare.uninsuredRate": 80, // barefoot doctors not yet deployed
  "healthcare.affordabilityIndex": 25,
  "healthcare.mentalHealthAccess": 5,
  "healthcare.socialCareQuality": 12,
  "healthcare.elderCareQuality": 15, // Confucian filial piety; family care
  "infrastructure.transportEfficiency": 18, // minimal rail; roads terrible
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 25, // Yellow River/Yangtze flood risk (1954 floods catastrophic)
  "environment.naturalDisasterPreparedness": 20,
  "environment.nuclearSafety": 0,
  "environment.energyTransitionProgress": 2, // coal; early hydro
  "social.childPoverty": 72,
  "social.housingAffordability": 10, // state-allocated (danwei) housing — cheap but crowded
  "social.roughSleeping": 6,
  "social.workLifeBalance": 35,
  "social.foreignWorkerIntegration": 10, // near-zero foreigners; Soviet advisers exception
  "social.genderEquality": 28, // Marriage Law 1950 — Mao ideology gender equality; practice different
  "social.housingSupplyGrowth": 3.0, // danwei construction
  "governance.debtToGdp": 12, // command economy manages own debt
  "governance.devolutionSatisfaction": 30, // highly centralised; provinces have limited autonomy
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 78, // liberation narrative; Korean War "victory"
  "governance.civilLiberties": 10, // one-party state; thought reform campaigns; anti-rightist
  "governance.militaryReadiness": 72, // Korean War army; world's largest
  "population.demographicDecline": 2, // very young, rapidly growing
  "mediaInformation.stateMediaControl": 98, // total state control; Xinhua only
};

const TILTS_1953: Record<string, Record<string, number>> = {
  DB: {
    // Dongbei (Manchuria) — industrial heartland (Soviet-pattern heavy industry)
    "economic.gdpGrowth": 7.5,
    "economic.medianIncome": 92,
    "economic.povertyRate": 26,
    "economic.manufacturingCompetitiveness": 42,
    "economic.ruralRevitalization": 78,
    "education.literacyRate": 38,
    "healthcare.lifeExpectancy": 43,
    "infrastructure.transportEfficiency": 30, // best in China (Japanese colonial legacy)
    "social.childPoverty": 60,
    "governance.nationalPride": 80,
    "population.urbanizationRate": 26, // cnRegionCensusData1953 urban share
    "population.medianAge": 24, // industrial cities older than interior
    "population.birthRate": 60,
  },
  HB: {
    // Huabei (North China / Beijing / Tianjin)
    "economic.gdpGrowth": 6.5,
    "economic.medianIncome": 88,
    "economic.manufacturingCompetitiveness": 35,
    "education.literacyRate": 38,
    "education.universityEnrollment": 1.0, // Peking University etc.
    "healthcare.lifeExpectancy": 43,
    "infrastructure.transportEfficiency": 25,
    "social.childPoverty": 65,
    "population.urbanizationRate": 16,
    "population.medianAge": 24,
    "population.birthRate": 60,
  },
  HD: {
    // Huadong (East / Shanghai)
    "economic.gdpGrowth": 6.5,
    "economic.medianIncome": 96,
    "economic.povertyRate": 25,
    "economic.manufacturingCompetitiveness": 40,
    "economic.exportDependency": 15,
    "economic.tradeBalance": 0.5,
    "education.literacyRate": 38,
    "healthcare.lifeExpectancy": 44,
    "infrastructure.transportEfficiency": 28,
    "social.childPoverty": 58,
    "population.urbanizationRate": 14,
    "population.medianAge": 25, // Shanghai oldest tilt
    "population.birthRate": 58,
  },
  HZ: {
    // Huazhong (Central) — agrarian grain heartland
    "economic.medianIncome": 72,
    "economic.povertyRate": 34,
    "education.literacyRate": 28,
    "population.urbanizationRate": 8,
    "population.medianAge": 23,
    "population.birthRate": 64,
  },
  HN: {
    // Huanan (South) — pre-SEZ; Canton trade residue only
    "economic.medianIncome": 84,
    "economic.povertyRate": 32,
    "education.literacyRate": 28,
    "population.urbanizationRate": 9,
    "population.medianAge": 23,
    "population.birthRate": 64,
  },
  XN: {
    // Xinan (Southwest / Sichuan / Yunnan / Guizhou)
    "economic.gdpGrowth": 5.0,
    "economic.medianIncome": 64,
    "economic.povertyRate": 38,
    "economic.ruralRevitalization": 95,
    "education.literacyRate": 22,
    "healthcare.lifeExpectancy": 40,
    "social.childPoverty": 80,
    "healthcare.uninsuredRate": 90,
    "infrastructure.transportEfficiency": 10,
    "environment.floodRisk": 20,
    "population.urbanizationRate": 5,
    "population.medianAge": 21, // rural southwest youngest
    "population.birthRate": 68,
  },
  XB: {
    // Xibei (Northwest / Xinjiang / Gansu / Qinghai)
    "economic.gdpGrowth": 5.0,
    "economic.medianIncome": 68,
    "economic.povertyRate": 36,
    "economic.ruralRevitalization": 92,
    "education.literacyRate": 24,
    "healthcare.lifeExpectancy": 40,
    "social.childPoverty": 78,
    "healthcare.uninsuredRate": 88,
    "infrastructure.transportEfficiency": 8,
    "governance.civilLiberties": 5, // minority suppression already
    "population.urbanizationRate": 8,
    "population.medianAge": 21,
    "population.birthRate": 68,
  },
};

export const cnMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  CN_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
