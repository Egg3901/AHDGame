import type { MetricPresetBundle } from "@/lib/seeds/jp/jpMetricPresets";

/**
 * 1979 Japan — Ohira Masayoshi (LDP); second oil shock (Iran Revolution) hitting hard;
 * Japan's adjustment to the 1973 oil shock complete — pivot from energy-intensive to
 * knowledge-intensive industry underway (Toyota Just-In-Time, Sony Walkman 1979, Canon cameras).
 * Lifetime employment system (shūshin koyō) at absolute peak. Universal health insurance since
 * 1961. Japan's life expectancy (~75.9) becoming world's highest. Shinkansen network expanding.
 * Nuclear power: 22 plants (26.7 GW) operating. Trade surplus ballooning. Yen strengthening
 * (227 ¥/$ in 1979). Very low unemployment (2.1%). Women working but leaving on marriage.
 * No broadband. Population ~116M.
 */

const JP_REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

const NATIONAL_1979: Record<string, number> = {
  "economic.laborParticipation": 65, // high — lifetime employment full absorption
  "economic.matchingFriction": 2.2, // unemployment only 2.1%
  "economic.tradeBalance": 2.5, // growing surplus (cars/electronics)
  "economic.productivityGrowth": 3.5, // strong knowledge-intensive catch-up
  "economic.rdIntensity": 1.8, // MITI-driven R&D rising fast (from 0.4% in 1953)
  "economic.propertyValueIndex": 55, // land prices rising; Tokyo expensive
  "economic.commercialValueIndex": 58,
  "economic.ruralRevitalization": 50, // Japan still ~24% rural; rice subsidies
  "economic.foodSecurity": 72, // rice self-sufficient; protein imports
  "economic.exportDependency": 32, // export-led growth model mature
  "economic.manufacturingCompetitiveness": 90, // peak — Toyota/Honda/Nissan/Sony/Panasonic
  "economic.regulatoryBurden": 62, // MITI industrial policy still heavy; keiretsu system
  "economic.economicFreedom": 55, // directed capitalism (Japan Inc.)
  "education.highSchoolGradRate": 89, // almost universal by 1979 (huge jump from 45% in 1953)
  "education.universityEnrollment": 28, // Japan's university enrollment spike
  "education.apprenticeshipRate": 1.5, // OJT in-company training dominant instead
  "education.academicPressure": 80, // exam hell (juken) at peak; suicides reported
  "healthcare.uninsuredRate": 2, // universal since 1961; compliance high
  "healthcare.affordabilityIndex": 78,
  "healthcare.mentalHealthAccess": 18, // stigma; asylums; limited community care
  "healthcare.socialCareQuality": 42,
  "healthcare.elderCareQuality": 50, // aging population pressure beginning
  "infrastructure.transportEfficiency": 80, // Shinkansen Osaka+Hakata; metro dense
  "publicSafety.antiSocialBehaviourRate": 2, // famously low crime (yakuza separate ecosystem)
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 20,
  "environment.naturalDisasterPreparedness": 68, // earthquake/tsunami awareness; improving systems
  "environment.nuclearSafety": 62, // 22 plants but post-TMI (1979) awareness rising
  "environment.energyTransitionProgress": 8, // post-oil-shock: conservation mandated; nuke/hydro
  "social.childPoverty": 15, // strong family safety net; full employment
  "social.housingAffordability": 20, // cramped but affordable; Tokyo excepted
  "social.roughSleeping": 3,
  "social.workLifeBalance": 32, // karoshi (overwork) undiscovered but present; ~60-hr weeks
  "social.foreignWorkerIntegration": 18, // near-zero immigration; Zainichi Koreans marginalised
  "social.genderEquality": 28, // "office ladies" expected to leave on marriage; EEOA 1986
  "social.housingSupplyGrowth": 2.0, // apartment construction; danchi
  "governance.debtToGdp": 30, // post-oil-shock deficits building; lower than later
  "governance.devolutionSatisfaction": 55, // prefectural system; limited autonomy
  "governance.roboticsAdoption": 5, // industrial robots pioneering — FANUC/Yaskawa
  "governance.nationalPride": 72, // economic miracle success; post-war pride restored
  "governance.civilLiberties": 70, // constitution liberal; LDP one-party dominance
  "governance.militaryReadiness": 35, // Yoshida Doctrine modified; SDF 260,000; <1% GDP
  "population.demographicDecline": 25, // birth rate falling; aging society beginning
  "mediaInformation.stateMediaControl": 18, // NHK public; commercial TV dominant; press free
};

const TILTS_1979: Record<string, Record<string, number>> = {
  KAN: {
    "economic.manufacturingCompetitiveness": 90,
    "economic.propertyValueIndex": 72,
    "economic.commercialValueIndex": 80,
    "economic.exportDependency": 40,
    "economic.rdIntensity": 2.5,
    "infrastructure.transportEfficiency": 92, // Shinkansen hub; Yamanote Line
    "education.universityEnrollment": 40, // Tokyo's elite universities
    "social.childPoverty": 10,
    "population.demographicDecline": 22,
  },
  KNS: {
    "economic.manufacturingCompetitiveness": 92, // Osaka/Kobe — trading/manufacturing
    "economic.exportDependency": 38,
    "economic.propertyValueIndex": 62,
    "infrastructure.transportEfficiency": 85,
    "social.childPoverty": 14,
  },
  CHU: {
    "economic.manufacturingCompetitiveness": 92, // Nagoya — Toyota City; highest robots
    "economic.rdIntensity": 2.2,
    "governance.roboticsAdoption": 10, // Toyota Production System birthplace
    "population.demographicDecline": 22,
  },
  TOH: {
    "economic.ruralRevitalization": 62,
    "social.childPoverty": 20,
    "economic.manufacturingCompetitiveness": 80,
  },
  HOK: {
    "economic.ruralRevitalization": 70,
    "economic.foodSecurity": 85, // Hokkaido dairy/fishery
    "social.childPoverty": 18,
    "population.demographicDecline": 28,
  },
  KYU: {
    "economic.ruralRevitalization": 58,
    "social.childPoverty": 18,
    "economic.manufacturingCompetitiveness": 85,
  },
  SHI: {
    "economic.ruralRevitalization": 60,
    "economic.foodSecurity": 78,
    "social.childPoverty": 16,
  },
  CGK: {
    "economic.rdIntensity": 1.6,
    "economic.manufacturingCompetitiveness": 85,
    "social.childPoverty": 16,
  },
};

export const jpMetricPresets1979: MetricPresetBundle = Object.fromEntries(
  JP_REGIONS.map((region) => [region, { ...NATIONAL_1979, ...(TILTS_1979[region] ?? {}) }])
);
