import type { MetricPresetBundle } from "@/lib/seeds/jp/jpMetricPresets";

/**
 * 1953 Japan — Yoshida Shigeru (Liberal Party); San Francisco Peace Treaty (April 1952)
 * ended Occupation; Korean War procurement boom driving recovery; Yoshida Doctrine: minimal
 * defence (<1% GDP), economy priority. Self-Defence Forces just established (1954). No
 * nuclear power (first plant Tōkai 1966). Still largely agricultural (55% urban). Life
 * expectancy ~63 (Statistics Bureau / UN Demographic Yearbook 1950-55 — up from ~52 in
 * 1947 but still well below Western Europe; modern jpStateMetrics ~83–85 must not leak).
 * Education system reformed under Occupation (6-3-3-4 system); university enrollment low.
 * Severe gender inequality; women expected to leave work on marriage (Confucian norms +
 * pre-Equal Employment Opportunity Act).
 */

const JP_REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 62, // high — farming absorbs everyone; no retirement norms
  "economic.matchingFriction": 4.0,
  "economic.tradeBalance": -2.0, // still running a trade deficit; Korea procurement helps
  "economic.productivityGrowth": 8.0, // extraordinary recovery growth (~10% GDP/yr)
  "economic.rdIntensity": 0.4, // virtually no civilian R&D
  // USD-anchored median household income (INCOME_ANCHORS JP 1953; refs #3498)
  "economic.medianIncome": 700,
  "economic.propertyValueIndex": 25,
  "economic.commercialValueIndex": 30,
  "economic.ruralRevitalization": 72, // Japan still majority rural
  "economic.foodSecurity": 68, // rice rationing ended 1952
  "economic.exportDependency": 18, // still rebuilding export capacity
  "economic.manufacturingCompetitiveness": 65, // recovering fast (textiles/steel)
  "economic.regulatoryBurden": 60, // MITI heavy industrial policy
  "economic.economicFreedom": 48, // dirigiste; zaibatsu dissolution → keiretsu
  "education.highSchoolGradRate": 45, // most students left after middle school
  "education.universityEnrollment": 7, // small elite universities
  "education.apprenticeshipRate": 2.0,
  "education.academicPressure": 55, // exam pressure already intense
  "healthcare.uninsuredRate": 40, // National Health Insurance not universal until 1961
  "healthcare.affordabilityIndex": 45,
  // Statistics Bureau of Japan / UN Demographic Yearbook 1950-55: e0 ≈61–64.
  // Wartime trough ~52 (1947); recovery was fast but 1953 is still ~10 yrs below
  // NW Europe. Adjuster alone yields clamp(83−11)=72 — the era-band ceiling —
  // so without this overlay Japan falsely sits at Western-European peak.
  "healthcare.lifeExpectancy": 63,
  "healthcare.nhsWaitingTime": 11, // weeks; 1938 NHI expanding fast in the recovery; universal coverage still 8 years off (1961)
  "healthcare.mentalHealthAccess": 10, // essentially none
  "healthcare.socialCareQuality": 20, // family-based care only
  "healthcare.elderCareQuality": 25,
  "infrastructure.transportEfficiency": 45, // steam rail; no Shinkansen (1964); roads poor
  "infrastructure.roadCondition": 32, // war-devastated; almost nothing paved outside cities
  "environment.protectedLand": 2.8, // % of land; 1934 national parks system already substantial
  "infrastructure.powerGridReliability": 93, // % uptime; grid rebuilt post-war; urban mains ahead of the countryside
  "infrastructure.waterQuality": 72, // treated-supply index
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 20,
  "environment.naturalDisasterPreparedness": 50,
  "environment.nuclearSafety": 0, // no nuclear plants; deep anti-nuclear sentiment (Hiroshima)
  "environment.energyTransitionProgress": 0, // coal + hydro
  "social.childPoverty": 38, // high; wartime generation still impoverished
  "social.housingAffordability": 18, // housing cheap but often destroyed/crowded
  "social.roughSleeping": 8,
  "social.workLifeBalance": 40, // very long hours; no legal protections
  "social.foreignWorkerIntegration": 20, // near-zero immigration; Zainichi Koreans marginalised
  "social.genderEquality": 15, // Occupation-era constitution has equality; practice very different
  "social.housingSupplyGrowth": 4.0, // massive building programme
  "governance.debtToGdp": 18, // low — war debt written off (San Francisco Treaty)
  "governance.devolutionSatisfaction": 52, // 47 prefectures have moderate autonomy
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 55, // conflicted — defeat + recovery + pacifism
  "governance.civilLiberties": 65, // new constitution very liberal; some Cold War pressures
  "governance.militaryReadiness": 20, // Yoshida Doctrine — minimal SDF
  // UN WPP 1950 Japan median age 22.3 / 1955 23.6 → ~22.7 in 1953 (not modern ~48).
  // Adjuster alone left every region at 36 (modern −8) — a 1990s Japan.
  "population.medianAge": 22,
  // 0–100 fertility INDEX (not crude rate). Formula 65 − age×0.5 ≈ 54 at age 22;
  // post-war baby boom (TFR ~3 early-1950s, falling from ~4.5 in 1947) sits here.
  "population.birthRate": 54,
  "population.demographicDecline": 8, // baby boom; young population
  "mediaInformation.stateMediaControl": 20, // NHK public; press free under constitution
};

const TILTS_1953: Record<string, Record<string, number>> = {
  KAN: {
    // Kanto (Tokyo)
    "economic.medianIncome": 900,
    "economic.manufacturingCompetitiveness": 70,
    "economic.exportDependency": 28,
    "economic.propertyValueIndex": 35,
    "economic.commercialValueIndex": 40,
    "infrastructure.transportEfficiency": 55,
    "education.universityEnrollment": 15,
    // University hospitals rebuilt; urban public-health edge over rural prefectures
    "healthcare.lifeExpectancy": 65,
    "social.childPoverty": 30,
    "population.medianAge": 24, // capital older than rural prefectures
    "population.birthRate": 50, // urban fertility already below national
  },
  KNS: {
    // Kansai (Osaka/Kyoto/Kobe)
    "economic.medianIncome": 850,
    "economic.manufacturingCompetitiveness": 72,
    "economic.exportDependency": 25,
    "infrastructure.transportEfficiency": 52,
    "healthcare.lifeExpectancy": 64.5, // industrial Kansai; hospitals recovering from bombing
    "social.childPoverty": 32,
    "population.medianAge": 23,
    "population.birthRate": 52,
  },
  CHU: {
    // Chubu (Nagoya)
    "economic.medianIncome": 780,
    "economic.manufacturingCompetitiveness": 68,
    "economic.rdIntensity": 0.5,
    "healthcare.lifeExpectancy": 63.5,
    "population.medianAge": 23,
    "population.birthRate": 53,
  },
  TOH: {
    // Tohoku
    "economic.medianIncome": 600,
    "economic.ruralRevitalization": 80,
    "social.childPoverty": 42,
    "governance.nationalPride": 52,
    // Sparse care; higher rural infant/TB mortality vs Kanto (MHLW regional pattern)
    "healthcare.lifeExpectancy": 61,
    "population.medianAge": 21, // rural younger (high fertility; reverse of modern Japan)
    "population.birthRate": 56,
  },
  HOK: {
    // Hokkaido
    "economic.medianIncome": 620,
    "economic.ruralRevitalization": 82,
    "economic.foodSecurity": 75,
    "social.childPoverty": 40,
    "healthcare.lifeExpectancy": 61.5, // frontier settlement; thin hospital network
    "population.medianAge": 22,
    "population.birthRate": 55,
  },
  KYU: {
    // Kyushu
    "economic.medianIncome": 650,
    "economic.ruralRevitalization": 78,
    "social.childPoverty": 40,
    "healthcare.lifeExpectancy": 62.5,
    "population.medianAge": 22,
    "population.birthRate": 55,
  },
};

export const jpMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  JP_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
