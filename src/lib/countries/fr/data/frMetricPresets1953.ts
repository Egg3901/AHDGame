/**
 * France 1953 metric overlays — Fourth Republic / Monnet Plan reconstruction.
 *
 * Base `frStateMetrics` is authored on ~1979 (Giscard) values. Without this
 * overlay a 1953-default world keeps 1979 life expectancy (~73.5), literacy 99,
 * and urbanization (~73) — anachronistic for a country still ~half rural
 * (INSEE 1954 census) with life expectancy ~66 (INED / UN Demographic Yearbook
 * 1950-55). Region ids match `frRegionCensusData1953`.
 *
 * `medianIncome` is annual household income in ANCIENS FRANCS (AF), the unit
 * the 1953 GDP seed is denominated in (budgets.ts FR FY1953: FFr 16,450B old
 * francs). This is NOT the same unit as the ~1979 `frStateMetrics` baseline,
 * which is in NOUVEAUX FRANCS — the 1960 redenomination cut two zeros (1 NF =
 * 100 AF, ordonnance 58-1341 of 27 Dec 1958, effective 1 Jan 1960).
 *
 * The original authoring took `1979 nominal NF × 0.42` (the Maddison Project
 * REAL GDP/cap ratio 1953≈5,000 vs 1979≈12,000 1990 Int$) and left the result
 * in NF. That is wrong twice over: it applies a real-volume ratio to a nominal
 * value and skips the redenomination entirely. The nominal chain is
 *
 *   AF_1953 = NF_1979 × 100 (AF per NF) ÷ ~5 (INSEE consumer price level
 *             1953→1979) × 0.42 (real income ratio)  ≈  NF_1979 × 8.4
 *
 * and since the old values already carried the ×0.42, the correction is a flat
 * ×(8.4 / 0.42) = ×20 on every figure below. Cross-check against
 * the seed's own national accounts: GDP/capita = 16,450B AF / 42.8M = 384,000
 * AF, so a 420,000 AF median household (3.2 persons) is ~1.1× GDP/capita —
 * the same income-to-GDP/capita relationship the FR 1979 seed carries
 * (50,000 NF against 2,500B NF / 53.5M = 46,700 NF, ratio 1.07).
 *
 * Sanity check against wage records: INSEE puts the 1953 average net annual
 * salary near 380,000 AF and the SMIG at 78.65 AF/hour; a household with ~1.4
 * earners plus non-wage income lands in the 340,000-600,000 AF range seeded
 * here. Broadband/internet did not exist.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const FR_REGIONS = [
  "FR_IDF",
  "FR_NOR",
  "FR_EST",
  "FR_OUE",
  "FR_SOU",
  "FR_ARA",
  "FR_MED",
  "FR_CEN",
] as const;

const NATIONAL_1953: Record<string, number> = {
  // ── Core paths (anti-anachronism vs ~1979 frStateMetrics) ──
  "economic.gdpGrowth": 4.5, // monetaryEra FR 1953 trendGdpGrowth; Trente Glorieuses onset
  "economic.medianIncome": 420_000, // anciens francs; 21k NF × 100/5 (see header)
  "economic.povertyRate": 22, // pre-welfare-state absolute poverty; post-war rationing ended ~1949
  "economic.unemploymentRate": 2.0, // near-full employment; reconstruction labour demand
  "healthcare.lifeExpectancy": 66, // INED / UN Demographic Yearbook 1950-55 ≈66–67
  "healthcare.nhsWaitingTime": 8, // weeks; Securite sociale (1945) maturing; strong urban hospital provision
  "education.literacyRate": 96, // near-universal; certificat d'études still the modal peak (INSEE 1954)
  "education.highSchoolGradRate": 18, // baccalauréat elite (<5% of cohort; INSEE 1954 education)
  "education.universityEnrollment": 4, // small elite universities
  "population.urbanizationRate": 55, // INSEE 1954 — provincial France still heavily rural
  "population.medianAge": 33, // WWII losses + early baby boom; older than Turkey, younger than SE
  // 0-100 fertility INDEX (population.birthRate; metricDefinitions
  // `unit: "index"`), NOT a crude per-1000 rate. Real France 1953 TFR ≈2.7
  // (INED, the "baby boom" that ran ahead of the rest of Western Europe) —
  // birthRateIndexToTFR(76, 2.06) = 2.06*(0.4+0.76*1.2) = 2.74. This field
  // was previously ABSENT, so FR fell through seedCohortVectors'
  // DEFAULT_BIRTH_RATE = 50 (TFR 2.06) — understating the postwar French
  // baby boom, one of Western Europe's strongest.
  "population.birthRate": 76,
  "population.populationGrowth": 0.8, // baby boom underway
  "infrastructure.broadbandAccess": 0, // internet did not exist
  "infrastructure.roadCondition": 50, // route nationale network war-damaged
  "environment.protectedLand": 1.2, // % of land; forest reserves; the parcs nationaux act is 1960
  "infrastructure.powerGridReliability": 96, // % uptime; EDF nationalised 1946, rural electrification pushing on
  "infrastructure.waterQuality": 82, // treated-supply index
  "environment.renewableEnergy": 8, // hydro (CNR / Rhône) only; coal/oil dominant
  "environment.recyclingRate": 0, // no municipal recycling programmes
  "environment.climateResilience": 0,
  "environment.energyTransitionProgress": 0, // coal + early hydro; nuclear not yet (Marcoule 1956)
  "mediaInformation.socialMediaSentiment": 0, // no platforms
  "governance.roboticsAdoption": 0,

  // ── Extended uniform paths ──
  "economic.laborParticipation": 58, // high male; female participation falling from wartime peak
  "economic.matchingFriction": 3.5,
  "economic.tradeBalance": 0.5, // OEEC / early EPU; still importing capital goods
  "economic.productivityGrowth": 4.5, // Monnet Plan productivity catch-up
  "economic.rdIntensity": 0.6, // CEA nuclear research; civilian R&D thin
  "economic.propertyValueIndex": 28, // reconstruction; housing still scarce
  "economic.commercialValueIndex": 30,
  "economic.ruralRevitalization": 58, // large peasant sector; remembrement underway
  "economic.foodSecurity": 72, // self-sufficient after end of rationing
  "economic.exportDependency": 14,
  "economic.manufacturingCompetitiveness": 68, // Renault nationalised; steel/coal via CECA (1951)
  "economic.regulatoryBurden": 55, // dirigiste planning + nationalised sector
  "economic.economicFreedom": 48,
  "education.apprenticeshipRate": 3.5,
  "education.academicPressure": 45,
  "healthcare.uninsuredRate": 8, // Sécurité sociale (1945) broadening; not yet universal in practice
  "healthcare.affordabilityIndex": 62,
  "healthcare.mentalHealthAccess": 18,
  "healthcare.socialCareQuality": 32,
  "healthcare.elderCareQuality": 30,
  "infrastructure.transportEfficiency": 52, // SNCF rebuilt; no autoroutes yet (A1 1960s)
  "publicSafety.antiSocialBehaviourRate": 4,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 14,
  "environment.naturalDisasterPreparedness": 42,
  "environment.nuclearSafety": 0, // no commercial nuclear yet
  "social.childPoverty": 24,
  "social.housingAffordability": 14, // cheap but severe shortage (bombing + rural exodus)
  "social.roughSleeping": 5,
  "social.workLifeBalance": 48,
  "social.foreignWorkerIntegration": 40, // Italian/Spanish/Polish inter-war cohorts; Algerian inflow tiny
  "social.genderEquality": 28, // women vote since 1944; labour-market equality distant
  "social.housingSupplyGrowth": 3.5, // HLM reconstruction boom
  "governance.debtToGdp": 30, // post-war debt elevated but falling
  "governance.devolutionSatisfaction": 42, // highly centralised Jacobin state
  "governance.nationalPride": 62, // Fourth Republic fragile; Resistance legacy
  "governance.civilLiberties": 70, // free press; Algeria war not yet (1954)
  "governance.militaryReadiness": 55, // Indochina war; conscript army
  "population.demographicDecline": 8, // baby boom
  "mediaInformation.stateMediaControl": 35, // ORTF precursor / RTF public radio-TV
  "mediaInformation.pressFreedom": 72,
  "mediaInformation.disinformationRisk": 12,
  "mediaInformation.mediaPolarization": 40, // Fourth Republic party press
};

const TILTS_1953: Record<string, Record<string, number>> = {
  FR_IDF: {
    // Paris / Île-de-France — administrative + industrial capital
    "economic.medianIncome": 600_000, // AF; Paris salaries ~1.4× national (INSEE 1954)
    "economic.unemploymentRate": 1.5,
    "economic.povertyRate": 14,
    "economic.manufacturingCompetitiveness": 75,
    "healthcare.lifeExpectancy": 68, // INED urban advantage
    "education.literacyRate": 98,
    "education.universityEnrollment": 9,
    "education.highSchoolGradRate": 28,
    "population.urbanizationRate": 88, // frRegionCensusData1953 urban share
    "infrastructure.transportEfficiency": 68, // métro + SNCF hub
    "social.childPoverty": 16,
    "social.housingAffordability": 10,
    "population.birthRate": 66, // urban capital; below the rural/Catholic west
  },
  FR_NOR: {
    // Nord / Normandy / Picardy — coal, textiles, farming
    "economic.medianIncome": 380_000, // AF
    "economic.manufacturingCompetitiveness": 72,
    "economic.ruralRevitalization": 55,
    "healthcare.lifeExpectancy": 65,
    "population.urbanizationRate": 52,
    "social.childPoverty": 28,
  },
  FR_EST: {
    // Alsace-Lorraine / Champagne — steel, mining, CECA heartland
    "economic.medianIncome": 440_000, // AF
    "economic.manufacturingCompetitiveness": 74,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 55,
    "education.literacyRate": 97,
  },
  FR_OUE: {
    // Brittany / Pays de la Loire — agrarian, Catholic, emigration to Paris
    "economic.medianIncome": 340_000, // AF; smallholder Brittany, lowest cash income
    "economic.povertyRate": 28,
    "economic.ruralRevitalization": 78,
    "healthcare.lifeExpectancy": 65,
    "education.literacyRate": 94,
    "education.highSchoolGradRate": 12,
    "population.urbanizationRate": 28, // frRegionCensusData1953
    "infrastructure.transportEfficiency": 40,
    "social.childPoverty": 32,
    "population.birthRate": 84, // rural, devoutly Catholic Brittany — highest FR fertility
  },
  FR_SOU: {
    // Aquitaine / Pyrénées — wine, Bordeaux bourgeoisie, Basque country
    "economic.medianIncome": 380_000, // AF
    "economic.ruralRevitalization": 68,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 40,
    "population.medianAge": 34,
  },
  FR_ARA: {
    // Rhône-Alpes / Auvergne — Lyon second industrial city
    "economic.medianIncome": 460_000, // AF; Lyon industry
    "economic.manufacturingCompetitiveness": 76,
    "healthcare.lifeExpectancy": 67,
    "population.urbanizationRate": 48,
    "infrastructure.transportEfficiency": 55,
  },
  FR_MED: {
    // Provence / Languedoc — Marseille port; early North African presence
    "economic.medianIncome": 400_000, // AF
    "economic.unemploymentRate": 2.5,
    "healthcare.lifeExpectancy": 66,
    "population.urbanizationRate": 56,
    "social.foreignWorkerIntegration": 48,
  },
  FR_CEN: {
    // Centre / Bourgogne / Franche-Comté — agricultural heartland
    "economic.medianIncome": 350_000, // AF
    "economic.povertyRate": 26,
    "economic.ruralRevitalization": 75,
    "healthcare.lifeExpectancy": 64,
    "education.literacyRate": 94,
    "population.urbanizationRate": 30,
    "population.medianAge": 35,
    "social.childPoverty": 30,
  },
};

export const frMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  FR_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
