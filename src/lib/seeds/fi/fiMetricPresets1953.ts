/**
 * Finland 1953 metric overlays — postwar republic / war-reparations industrialisation.
 *
 * Base `fiStateMetrics` is authored on ~1979 (late Kekkonen) values. Without this
 * overlay a 1953-default world keeps 1979 life expectancy (~72.9) and urban welfare
 * metrics, flattening the fact that 1953 Finland was still majority-rural with life
 * expectancy near 67 (Statistics Finland / UN Demographic Yearbook 1950-55) and a
 * young baby-boom pyramid. Region ids match `fiRegionCensusData1953`.
 *
 * `medianIncome` is annual household OLD markka (pre-1963 100:1 redenomination,
 * matching the budget's own huge nominal scale — mk 790B / 4.15M = mk 190,361
 * per capita), re-derived (#income-gdp-scale-audit) against that GDP/capita
 * rather than Maddison-scaled off the 1979 nominal figure — the old method
 * (the same mistake diagnosed and fixed for FR/ES/TR) measured out at ratio
 * 0.108x GDP/capita (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]),
 * badly UNDER-scaled by roughly the redenomination factor. Re-authored ~14x
 * higher (ratio ~1.5). Broadband/internet did not exist.
 * `population.birthRate` is the 0–100 fertility INDEX (metricDefinitions) —
 * Finland's mid-1950s TFR ≈2.9–3.0 maps to the high-50s/low-60s of that index.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const FI_REGIONS = ["FI_UUS", "FI_SW", "FI_HAM", "FI_EAS", "FI_OST", "FI_LAP"] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 fiStateMetrics) ──
  "economic.gdpGrowth": 5.0, // reparations-driven industrialisation; wood/metal export boom
  "economic.medianIncome": 292_500,
  "economic.povertyRate": 20, // rural poverty + Karelian resettlement burden
  "economic.unemploymentRate": 3.0, // labour scarce; emigration to Sweden beginning
  "healthcare.lifeExpectancy": 67, // Statistics Finland / UN Demographic Yearbook 1950-55 ≈66–68
  "healthcare.nhsWaitingTime": 13, // weeks; war-reparations austerity; rural provision thin outside the south
  "education.literacyRate": 98, // near-universal; kansakoulu modal peak
  "education.highSchoolGradRate": 18, // lukio still selective (fiRegionCensusData1953 tertiary ~2–7%)
  "education.universityEnrollment": 3.5,
  "population.urbanizationRate": 38, // Statistics Finland 1950 — still majority rural/agrarian
  "population.medianAge": 28, // great baby-boom cohorts (fiRegionCensusData1953 young share)
  "population.populationGrowth": 1.1, // baby boom
  "population.birthRate": 60, // 0–100 fertility index; TFR ≈2.9–3.0 (Statistics Finland ~1953)
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 42, // sparse network, reparations austerity
  "environment.protectedLand": 2.2, // % of land; large northern reserves relative to population
  "infrastructure.powerGridReliability": 95, // % uptime; hydro grid solid; rural wells still common
  "infrastructure.waterQuality": 84, // treated-supply index
  "environment.renewableEnergy": 40, // large hydro + wood fuel; no nuclear until Loviisa 1977
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 8,
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 60, // high male; rising female farm/factory labour
  "economic.matchingFriction": 3.0,
  "economic.tradeBalance": 0.5, // reparations to USSR + Western wood/metal exports
  "economic.productivityGrowth": 4.5,
  "economic.rdIntensity": 0.6,
  "economic.propertyValueIndex": 26,
  "economic.commercialValueIndex": 28,
  "economic.ruralRevitalization": 72, // agriculture still ~35% of workforce
  "economic.foodSecurity": 68,
  "economic.exportDependency": 22, // wood, pulp, metal products
  "economic.manufacturingCompetitiveness": 62, // shipyards / metal for reparations
  "economic.regulatoryBurden": 48,
  "economic.economicFreedom": 55,
  "education.apprenticeshipRate": 8,
  "education.academicPressure": 38,
  "healthcare.uninsuredRate": 8, // sickness funds expanding; universal centres later
  "healthcare.affordabilityIndex": 65,
  "healthcare.mentalHealthAccess": 20,
  "healthcare.socialCareQuality": 35,
  "healthcare.elderCareQuality": 32,
  "infrastructure.transportEfficiency": 48, // VR rail strong; roads thin in north/east
  "publicSafety.antiSocialBehaviourRate": 2,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 6,
  "environment.naturalDisasterPreparedness": 50,
  "environment.nuclearSafety": 0,
  "social.childPoverty": 20,
  "social.housingAffordability": 20, // urban shortage from rural→Helsinki migration
  "social.roughSleeping": 2,
  "social.workLifeBalance": 48,
  "social.foreignWorkerIntegration": 30, // Swedish-speaking minority; tiny immigrant share
  "social.genderEquality": 45, // ahead of most of Europe; farm women already in labour force
  "social.housingSupplyGrowth": 3.2,
  "governance.debtToGdp": 18,
  "governance.devolutionSatisfaction": 52, // län autonomy moderate
  "governance.coDeterminationQuality": 55, // SAK / employer bargaining
  "governance.nationalPride": 70, // Winter/Continuation War memory; Paasikivi–Kekkonen line
  "governance.civilLiberties": 78,
  "governance.militaryReadiness": 68, // large conscript force; FCMA treaty constraints
  "population.demographicDecline": 8, // baby boom
  "mediaInformation.stateMediaControl": 22, // Yleisradio public; press free
  "mediaInformation.pressFreedom": 85,
  "mediaInformation.disinformationRisk": 10,
  "mediaInformation.mediaPolarization": 28,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  FI_UUS: {
    // Uusimaa / Helsinki — commercial + administrative capital
    "economic.medianIncome": 418_000,
    "economic.unemploymentRate": 2.0,
    "economic.povertyRate": 12,
    "healthcare.lifeExpectancy": 68,
    "education.literacyRate": 99,
    "education.universityEnrollment": 8,
    "education.highSchoolGradRate": 28,
    "population.urbanizationRate": 72, // fiRegionCensusData1953
    "population.birthRate": 55,
    "infrastructure.transportEfficiency": 62,
    "social.childPoverty": 12,
    "social.foreignWorkerIntegration": 40, // largest Swedish-speaking share
  },
  FI_SW: {
    // Southwest — Turku / industrial + Swedish coast
    "economic.medianIncome": 306_500,
    "economic.manufacturingCompetitiveness": 68,
    "healthcare.lifeExpectancy": 67,
    "population.urbanizationRate": 40,
    "social.foreignWorkerIntegration": 38,
  },
  FI_HAM: {
    // Häme — inland industry + cold-farm smallholdings
    "economic.medianIncome": 278_600,
    "economic.ruralRevitalization": 70,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 36,
  },
  FI_EAS: {
    // East — Karelian resettlement; poorest, most rural
    "economic.medianIncome": 223_000,
    "economic.povertyRate": 28,
    "economic.ruralRevitalization": 82,
    "healthcare.lifeExpectancy": 65,
    "education.literacyRate": 96,
    "education.highSchoolGradRate": 10,
    "population.urbanizationRate": 20, // fiRegionCensusData1953
    "population.birthRate": 64,
    "infrastructure.transportEfficiency": 38,
    "social.childPoverty": 28,
  },
  FI_OST: {
    // Ostrobothnia — agrarian; Swedish-speaking west coast
    "economic.medianIncome": 250_700,
    "economic.povertyRate": 24,
    "economic.ruralRevitalization": 80,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 22,
    "population.birthRate": 62,
    "social.foreignWorkerIntegration": 42,
  },
  FI_LAP: {
    // Lapland — sparsest; Sámi minority; timber / mining
    "economic.medianIncome": 209_000,
    "economic.povertyRate": 30,
    "economic.ruralRevitalization": 85,
    "healthcare.lifeExpectancy": 65,
    "education.literacyRate": 95,
    "population.urbanizationRate": 16, // fiRegionCensusData1953
    "population.birthRate": 65,
    "population.medianAge": 26,
    "infrastructure.transportEfficiency": 32,
    "social.childPoverty": 30,
  },
};

export const fiMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  FI_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
