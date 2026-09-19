/**
 * Austria 1953 metric overlays — occupied Second Republic / early reconstruction.
 *
 * Base `atStateMetrics` is authored on ~1979 (late Kreisky) values. Without this
 * overlay a 1953-default world keeps 1979 life expectancy (~72.4), literacy 99,
 * and near-full-employment Austro-Keynesian metrics — anachronistic for a country
 * still under four-power occupation (State Treaty 1955) with life expectancy near
 * 67 (Statistik Austria / UN Demographic Yearbook 1950-55). Region ids match
 * `atRegionCensusData1953`.
 *
 * `medianIncome` is annual household schilling, re-derived (#income-gdp-scale-audit)
 * against the 1953 budget's own GDP/capita — the old Maddison-scaled-off-1979-
 * nominal method (the same mistake diagnosed and fixed for FR/ES/TR) measured
 * out at ratio 8.06x GDP/capita (öS 85B / 6.93M = öS 12,266;
 * medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]). Re-authored at 18,400
 * (ratio ~1.55). Broadband/internet did not exist.
 * `population.birthRate` is the 0–100 fertility INDEX (metricDefinitions), not
 * a crude birth rate — TFR ~2.1 maps to the mid-50s of that index.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const AT_REGIONS = ["AT_VIE", "AT_NOE", "AT_OOE", "AT_STK", "AT_TYR"] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 atStateMetrics) ──
  "economic.gdpGrowth": 5.5, // post-occupation recovery; ERP / reconstruction boom
  "economic.medianIncome": 18_400,
  "economic.povertyRate": 18, // war damage + DP/refugee residual; lower than Greece
  "economic.unemploymentRate": 4.5, // above 1979 full-employment; still absorbing war labour
  "healthcare.lifeExpectancy": 67, // Statistik Austria / UN Demographic Yearbook 1950-55 ≈66–68
  "healthcare.nhsWaitingTime": 9, // weeks; Krankenkassen functioning but capital-starved under four-power occupation
  "education.literacyRate": 98, // near-universal; Volksschule modal peak
  "education.highSchoolGradRate": 22, // Matura still selective (atRegionCensusData1953 tertiary ~4–6%)
  "education.universityEnrollment": 4, // small elite universities
  "population.urbanizationRate": 49, // Statistik Austria 1951 — Vienna dominant; countryside agrarian
  "population.medianAge": 34, // thin male mid-cohort (WWII losses); older than FI/GR
  "population.populationGrowth": 0.2, // low natural increase; refugee inflow tapering
  "population.birthRate": 52, // 0–100 fertility index; TFR ≈2.1 (Statistik Austria ~1953)
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 48, // Alpine roads, occupation-era underinvestment
  "environment.protectedLand": 1.5, // % of land; Hohe Tauern protection partial and voluntary
  "infrastructure.powerGridReliability": 95, // % uptime; Alpine hydro strong; occupation slows mains investment
  "infrastructure.waterQuality": 82, // treated-supply index
  "environment.renewableEnergy": 45, // Alpine hydro already large share of electricity
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 5, // hydro; no commercial nuclear
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 58,
  "economic.matchingFriction": 3.5,
  "economic.tradeBalance": -2.0, // goods deficit; tourism nascent
  "economic.productivityGrowth": 4.5,
  "economic.rdIntensity": 0.5,
  "economic.propertyValueIndex": 30,
  "economic.commercialValueIndex": 32,
  "economic.ruralRevitalization": 62, // large peasant / mountain-farm sector
  "economic.foodSecurity": 70,
  "economic.exportDependency": 16,
  "economic.manufacturingCompetitiveness": 65, // steel / engineering recovering; ÖIAG precursors
  "economic.regulatoryBurden": 52, // Proporz + guild licensing already present
  "economic.economicFreedom": 52,
  "education.apprenticeshipRate": 28, // Lehre tradition already strong
  "education.academicPressure": 42,
  "healthcare.uninsuredRate": 6, // Krankenkassen expanding; not yet near-universal
  "healthcare.affordabilityIndex": 68,
  "healthcare.mentalHealthAccess": 22,
  "healthcare.socialCareQuality": 38,
  "healthcare.elderCareQuality": 35,
  "infrastructure.transportEfficiency": 55, // ÖBB rebuilt; Alpine roads thin
  "publicSafety.antiSocialBehaviourRate": 3,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 48,
  "environment.nuclearSafety": 0,
  "social.childPoverty": 18,
  "social.housingAffordability": 18, // Gemeindebau expanding; urban shortage
  "social.roughSleeping": 3,
  "social.workLifeBalance": 50,
  "social.foreignWorkerIntegration": 42, // DPs / Volksdeutsche; guest-worker era later
  "social.genderEquality": 32,
  "social.housingSupplyGrowth": 3.0,
  "governance.debtToGdp": 28,
  "governance.devolutionSatisfaction": 48, // Länder federalism; occupation overlays
  "governance.coDeterminationQuality": 62, // Sozialpartnerschaft forming
  "governance.nationalPride": 55, // occupation; State Treaty not yet
  "governance.civilLiberties": 68, // free press in West zones; occupation limits
  "governance.militaryReadiness": 15, // no Bundesheer until 1955
  "population.demographicDecline": 18, // aging from war losses
  "mediaInformation.stateMediaControl": 28, // ORF precursor; party press
  "mediaInformation.pressFreedom": 72,
  "mediaInformation.disinformationRisk": 14,
  "mediaInformation.mediaPolarization": 38, // Lager press
};

const TILTS_1953: Record<string, Record<string, number>> = {
  AT_VIE: {
    // Vienna — occupied capital; administrative + industrial hub
    "economic.medianIncome": 24_300,
    "economic.unemploymentRate": 3.5,
    "economic.povertyRate": 12,
    "healthcare.lifeExpectancy": 68,
    "education.literacyRate": 99,
    "education.universityEnrollment": 8,
    "education.highSchoolGradRate": 32,
    "population.urbanizationRate": 94, // atRegionCensusData1953
    "population.birthRate": 48,
    "infrastructure.transportEfficiency": 68,
    "social.childPoverty": 12,
    "social.housingAffordability": 12,
  },
  AT_NOE: {
    // Lower Austria — agrarian ring around Vienna
    "economic.medianIncome": 15_900,
    "economic.povertyRate": 22,
    "economic.ruralRevitalization": 72,
    "healthcare.lifeExpectancy": 66,
    "education.literacyRate": 97,
    "population.urbanizationRate": 24, // atRegionCensusData1953
    "social.childPoverty": 22,
  },
  AT_OOE: {
    // Upper Austria — Linz steel / Voest recovery
    "economic.medianIncome": 19_900,
    "economic.manufacturingCompetitiveness": 72,
    "healthcare.lifeExpectancy": 67,
    "population.urbanizationRate": 32,
    "education.literacyRate": 98,
  },
  AT_STK: {
    // Styria — Graz + mining / steel
    "economic.medianIncome": 16_600,
    "economic.manufacturingCompetitiveness": 68,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 32,
    "economic.povertyRate": 20,
  },
  AT_TYR: {
    // Tyrol / West — Alpine tourism nascent; rural Catholic
    "economic.medianIncome": 17_400,
    "economic.ruralRevitalization": 78,
    "healthcare.lifeExpectancy": 67,
    "population.urbanizationRate": 26, // atRegionCensusData1953
    "population.medianAge": 32,
    "infrastructure.transportEfficiency": 45,
  },
};

export const atMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  AT_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
