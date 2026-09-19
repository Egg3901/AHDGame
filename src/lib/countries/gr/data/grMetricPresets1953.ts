/**
 * Greece 1953 metric overlays — post-civil-war kingdom / Marshall Plan recovery.
 *
 * Base `grStateMetrics` is authored on ~1979 (Metapolitefsi) values. Without this
 * overlay a 1953-default world keeps 1979 life expectancy (~73.5), literacy, and
 * urbanization — far above post-civil-war Greece, which was materially poorer and
 * less urbanised than Austria or Finland (ELSTAT 1951 census; Maddison GDP/cap
 * ~half of AT/FI). Life expectancy sat near 65 (UN Demographic Yearbook 1950-55).
 * Region ids match `grRegionCensusData1953`.
 *
 * `medianIncome` is annual household drachmae, re-derived (#income-gdp-scale-audit)
 * against the 1953 budget's own GDP/capita — the old Maddison-scaled-off-1979-
 * nominal method (the same mistake diagnosed and fixed for FR/ES/TR) measured
 * out at ratio 15.7x GDP/capita (₯50B / 7.6M = ₯6,579;
 * medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]). Re-authored ~11x
 * lower (ratio ~1.4). Broadband/internet did not exist.
 * `population.birthRate` is the 0–100 fertility INDEX (metricDefinitions) —
 * Greece's early-1950s TFR ≈2.5–2.7 maps to the mid-50s of that index.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const GR_REGIONS = ["GR_ATT", "GR_MAC", "GR_THE", "GR_EPC", "GR_PEL", "GR_ISL"] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 grStateMetrics) ──
  "economic.gdpGrowth": 6.5, // Marshall Plan / reconstruction; high catch-up growth
  "economic.medianIncome": 9_300,
  "economic.povertyRate": 38, // civil-war devastation; absolute rural poverty high
  "economic.unemploymentRate": 6.0, // open unemployment + massive rural underemployment
  "healthcare.lifeExpectancy": 65, // UN Demographic Yearbook 1950-55 ≈64–66
  "healthcare.nhsWaitingTime": 21, // weeks; civil-war aftermath; health infrastructure destroyed and not yet rebuilt
  "education.literacyRate": 74, // ELSTAT 1951 — national illiteracy still high, esp. rural women
  "education.highSchoolGradRate": 10, // secondary elite (grRegionCensusData1953 tertiary ~4–6%)
  "education.universityEnrollment": 2.5,
  "population.urbanizationRate": 37, // ELSTAT 1951 — Athens influx just beginning; interior rural
  "population.medianAge": 27, // high fertility; young pyramid after war losses
  "population.populationGrowth": 1.0,
  "population.birthRate": 56, // 0–100 fertility index; TFR ≈2.5–2.7 (ELSTAT / UN WPP ~1953)
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 25, // civil-war destruction
  "environment.protectedLand": 0.9, // % of land; Olympus (1938) and Parnassos
  "infrastructure.powerGridReliability": 87, // % uptime; civil-war damage; supply outside Athens intermittent
  "infrastructure.waterQuality": 52, // treated-supply index
  "environment.renewableEnergy": 15, // early hydro (Achelous plans); lignite/oil dominant
  "environment.recyclingRate": 0,
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 0,
  "mediaInformation.socialMediaSentiment": 0,
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 52, // low female formal participation
  "economic.matchingFriction": 5.0,
  "economic.tradeBalance": -3.0, // import-dependent; tobacco/shipping/emigrant remittances
  "economic.productivityGrowth": 5.5,
  "economic.rdIntensity": 0.2,
  "economic.propertyValueIndex": 22,
  "economic.commercialValueIndex": 24,
  "economic.ruralRevitalization": 75, // agriculture still ~50% of workforce (ELSTAT 1951)
  "economic.foodSecurity": 55, // recovery from wartime famine; still fragile
  "economic.exportDependency": 10,
  "economic.manufacturingCompetitiveness": 42, // light industry; heavy industry thin
  "economic.regulatoryBurden": 58,
  "economic.economicFreedom": 42,
  "education.apprenticeshipRate": 4,
  "education.academicPressure": 35,
  "healthcare.uninsuredRate": 35, // IKA expanding but rural coverage thin
  "healthcare.affordabilityIndex": 42,
  "healthcare.mentalHealthAccess": 12,
  "healthcare.socialCareQuality": 22,
  "healthcare.elderCareQuality": 20,
  "infrastructure.transportEfficiency": 35, // roads/ports war-damaged; rail limited
  "publicSafety.antiSocialBehaviourRate": 5,
  "publicSafety.knifeCrimeRate": 3,
  "environment.floodRisk": 16,
  "environment.naturalDisasterPreparedness": 30, // 1953 Ionian earthquake fresh
  "environment.nuclearSafety": 0,
  "social.childPoverty": 40,
  "social.housingAffordability": 22, // cheap rural; Athens shortage from migration
  "social.roughSleeping": 6,
  "social.workLifeBalance": 42,
  "social.foreignWorkerIntegration": 28, // Thracian Muslim minority; emigration out, not in
  "social.genderEquality": 22,
  "social.housingSupplyGrowth": 2.5,
  "governance.debtToGdp": 25,
  "governance.devolutionSatisfaction": 35, // highly centralised kingdom
  "governance.coDeterminationQuality": 28,
  "governance.nationalPride": 58, // civil-war scars; monarchy restored
  "governance.civilLiberties": 45, // emergency laws / surveillance residual after civil war
  "governance.militaryReadiness": 55, // large army; NATO 1952
  "population.demographicDecline": 10,
  "mediaInformation.stateMediaControl": 40, // state radio; press under political pressure
  "mediaInformation.pressFreedom": 48,
  "mediaInformation.disinformationRisk": 22,
  "mediaInformation.mediaPolarization": 55, // civil-war cleavage in press
};

const TILTS_1953: Record<string, Record<string, number>> = {
  GR_ATT: {
    // Attica / Athens — capital; refugee + rural migrant influx
    "economic.medianIncome": 14_200,
    "economic.unemploymentRate": 5.0,
    "economic.povertyRate": 28,
    "economic.manufacturingCompetitiveness": 55,
    "healthcare.lifeExpectancy": 66,
    "education.literacyRate": 85,
    "education.universityEnrollment": 6,
    "education.highSchoolGradRate": 18,
    "population.urbanizationRate": 80, // grRegionCensusData1953
    "population.birthRate": 52,
    "infrastructure.transportEfficiency": 48,
    "healthcare.uninsuredRate": 22,
    "social.childPoverty": 28,
    "social.housingAffordability": 14,
  },
  GR_MAC: {
    // Macedonia — Thessaloniki second city; tobacco / agriculture
    "economic.medianIncome": 8_900,
    "economic.povertyRate": 40,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 72,
    "population.urbanizationRate": 34,
    "social.foreignWorkerIntegration": 35, // Thracian/Slavic minority presence
    "social.childPoverty": 42,
  },
  GR_THE: {
    // Thessaly — grain plain; still heavily rural
    "economic.medianIncome": 7_600,
    "economic.povertyRate": 42,
    "economic.ruralRevitalization": 82,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 70,
    "population.urbanizationRate": 28,
    "social.childPoverty": 44,
  },
  GR_EPC: {
    // Epirus / NW — poorest mainland; mountainous; emigration
    "economic.medianIncome": 6_700,
    "economic.povertyRate": 48,
    "economic.ruralRevitalization": 88,
    "healthcare.lifeExpectancy": 63,
    "education.literacyRate": 65,
    "education.highSchoolGradRate": 6,
    "population.urbanizationRate": 22, // grRegionCensusData1953
    "population.birthRate": 58,
    "infrastructure.transportEfficiency": 25,
    "social.childPoverty": 50,
  },
  GR_PEL: {
    // Peloponnese — currants / olive; civil-war scarred
    "economic.medianIncome": 7_300,
    "economic.povertyRate": 42,
    "economic.ruralRevitalization": 80,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 72,
    "population.urbanizationRate": 26,
    "social.childPoverty": 44,
  },
  GR_ISL: {
    // Islands — shipping remittances; tourism nascent; earthquake zone
    "economic.medianIncome": 8_500,
    "economic.povertyRate": 36,
    "healthcare.lifeExpectancy": 65,
    "education.literacyRate": 76,
    "population.urbanizationRate": 30,
    "population.medianAge": 28,
    "environment.naturalDisasterPreparedness": 35, // 1953 Cephalonia quake
    "economic.exportDependency": 18, // shipping / diaspora remittances
  },
};

export const grMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  GR_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
