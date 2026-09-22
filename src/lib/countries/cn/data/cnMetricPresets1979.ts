import type { MetricPresetBundle } from "@/lib/seeds/cn/cnMetricPresets";

/**
 * 1979 China — Deng Xiaoping (paramount leader from Dec 1978; Hua Guofeng nominal chairman).
 * "Four Modernizations" announced 1978; household responsibility system pilot in Anhui/Sichuan;
 * Sino-Vietnamese War (Feb-March 1979); US diplomatic recognition (Jan 1979). Cultural
 * Revolution (1966-76) devastation: educated generation "lost"; universities reopened 1977;
 * gaokao reinstated 1977. Population ~975M; urbanization only 19%. Life expectancy 67.1.
 * Danwei (work-unit) system still total. Barely-reformed command economy: rural decollectivisation
 * beginning; SEZs (Shenzhen/Zhuhai) established 1980. Trade minimal; opening beginning.
 */

const CN_REGIONS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] as const;

const NATIONAL_1979: Record<string, number> = {
  "economic.laborParticipation": 72, // danwei system; urban full employment by command
  "economic.matchingFriction": 7.0, // command allocation; reform only just starting
  "economic.tradeBalance": -0.5, // near-balance; trade starting to open
  "economic.productivityGrowth": 5.5, // base-level growth from beginning reforms
  "economic.rdIntensity": 0.5, // military R&D; civilian emerging post-CR damage
  "economic.propertyValueIndex": 8, // state-allocated; danwei housing; no market
  "economic.commercialValueIndex": 8,
  "economic.ruralRevitalization": 82, // still ~81% rural (1979); reform just beginning
  "economic.foodSecurity": 58, // reforms improving from CR famine risk; still tight
  "economic.exportDependency": 10, // trade liberalisation just starting; SEZs in planning
  "economic.manufacturingCompetitiveness": 30, // state-enterprise heavy industry; inefficient
  "economic.regulatoryBurden": 88, // command economy still dominant; reform nascent
  "economic.economicFreedom": 8, // beginning to thaw; market pricing pilot
  "education.highSchoolGradRate": 30, // gaokao reinstated 1977; CR damage still severe
  "education.universityEnrollment": 1.5,
  "education.apprenticeshipRate": 2.0, // vocational training in factories
  "education.academicPressure": 55, // gaokao extremely competitive; low slots
  "healthcare.uninsuredRate": 40, // barefoot doctors still deployed; rural cooperative
  "healthcare.affordabilityIndex": 42, // cooperative medical insurance; urban danwei covers
  "healthcare.mentalHealthAccess": 8,
  "healthcare.socialCareQuality": 18,
  "healthcare.elderCareQuality": 22, // filial piety + danwei; danwei pension not portable
  "infrastructure.transportEfficiency": 28, // rail expanding; roads still poor; Shanghai–Beijing decent
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 25, // Yellow River/Yangtze management improving
  "environment.naturalDisasterPreparedness": 28,
  "environment.nuclearSafety": 5, // Qinshan nuclear planning; no civilian plants yet
  "environment.energyTransitionProgress": 4, // coal dominant; Gezhouba dam (Yangtze) construction
  "social.childPoverty": 58, // absolute poverty very high; rural reform just starting
  "social.housingAffordability": 12, // danwei-allocated; crowded but cheap; no market
  "social.roughSleeping": 4,
  "social.workLifeBalance": 40, // danwei-assigned work; political campaigns reduced
  "social.foreignWorkerIntegration": 10, // near-zero; Soviet advisers gone; Japan/US businessmen
  "social.genderEquality": 32, // Mao rhetoric of equality; reform opening changes
  "social.housingSupplyGrowth": 2.5, // danwei construction; market housing not yet
  "governance.debtToGdp": 10, // command economy; minimal external debt; domestic
  "governance.devolutionSatisfaction": 32, // highly centralised CCP; reform decentralising slightly
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 72, // Four Modernizations optimism; Sino-Vietnam "victory"
  "governance.civilLiberties": 18, // Democracy Wall (Oct 1978–March 1979 crackdown); reform
  "governance.militaryReadiness": 68, // PLA world's largest; Sino-Vietnam battle-tested
  "population.demographicDecline": 4, // one-child policy announced 1979 (enforced 1980)
  "mediaInformation.stateMediaControl": 95, // Xinhua monopoly; People's Daily; Democracy Wall crushed
};

const TILTS_1979: Record<string, Record<string, number>> = {
  DB: {
    "economic.manufacturingCompetitiveness": 42, // Manchuria — Soviet-pattern heavy industry
    "economic.ruralRevitalization": 72,
    "infrastructure.transportEfficiency": 38, // best railway in China
    "social.childPoverty": 50,
  },
  HB: {
    "economic.manufacturingCompetitiveness": 38,
    "infrastructure.transportEfficiency": 35, // Beijing nearby; improving
    "education.universityEnrollment": 3.0, // Peking/Tsinghua universities
    "social.childPoverty": 52,
  },
  HD: {
    "economic.manufacturingCompetitiveness": 45, // Shanghai — most advanced
    "economic.exportDependency": 18,
    "economic.tradeBalance": 1.0,
    "infrastructure.transportEfficiency": 42,
    "social.childPoverty": 45,
    "economic.economicFreedom": 12, // reform pilot sites in East
  },
  HZ: {
    "economic.ruralRevitalization": 78,
    "social.childPoverty": 55,
  },
  HN: {
    "economic.ruralRevitalization": 80,
    "economic.foodSecurity": 62,
    "social.childPoverty": 60,
  },
  XN: {
    "economic.ruralRevitalization": 92,
    "social.childPoverty": 78,
    "healthcare.uninsuredRate": 58,
    "infrastructure.transportEfficiency": 15,
    "environment.floodRisk": 22,
  },
  XB: {
    "economic.ruralRevitalization": 90,
    "social.childPoverty": 75,
    "healthcare.uninsuredRate": 55,
    "infrastructure.transportEfficiency": 12,
    "governance.civilLiberties": 10, // Xinjiang/Tibetan minority suppression
  },
};

export const cnMetricPresets1979: MetricPresetBundle = Object.fromEntries(
  CN_REGIONS.map((region) => [region, { ...NATIONAL_1979, ...(TILTS_1979[region] ?? {}) }])
);
