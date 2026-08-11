import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Ireland planning regions initial metrics — approximate 2022/2023 CSO /
 * ESRI Ireland data, tuned for gameplay feel.
 *
 * Units and conventions:
 *   unemploymentRate   — %, e.g. 4.2 means 4.2%
 *   medianIncome       — annual household income in EUR
 *   gdpGrowth          — year-over-year % change
 *   povertyRate        — % below 60% median-income threshold
 *   costOfLiving       — index, 100 = national mean
 *   crimeRate          — incidents per 100k population
 *   lifeExpectancy     — years at birth
 *   carbonEmissions    — tons CO2 per capita per year (lower = better)
 *   corruptionIndex    — 0-100 scale (lower = cleaner; Transparency Int'l style)
 *   voterTurnout       — % turnout in most recent Dáil election
 *
 * All values use `{ value, trend? }` wrappers expected by the engine.
 */

function mv(value: number, trend?: number) {
  return { value, trend };
}

/**
 * Ireland national baseline. Each region overrides via `buildMetrics` below so
 * the per-region definitions stay compact.
 *
 * National-average values drawn from CSO (economy), An Garda Síochána (crime),
 * HSE/CSO (health), SEAI (energy), and Comisiún Toghcháin (elections).
 */
const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(4.2),
    medianIncome: mv(42_000),
    gdpGrowth: mv(3.5),
    povertyRate: mv(11.3),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(8.5),
    laborParticipation: mv(73),
    matchingFriction: mv(2.2),
    tradeBalance: mv(11.5),
    productivityGrowth: mv(2.4),
    rdIntensity: mv(1.6),
    // IE-specific
    mncDependency: mv(60), // Dept of Finance 2023: ~60% of corp-tax from top-10 MNCs
    gniStarGap: mv(35), // CSO 2022: GDP exceeds GNI* by ~35%
    fdiPipelineStrength: mv(78), // IDA Ireland 2022 — 248 investments / 19k jobs
    capDependency: mv(65), // Teagasc 2022: CAP ≈ 65% of avg family-farm income
  },
  education: {
    testPerformance: mv(92),
    educationSpending: mv(10_500),
    literacyRate: mv(99),
    workforceSkill: mv(82),
  },
  healthcare: {
    physicianRate: mv(3.4),
    lifeExpectancy: mv(82.2),
    preventableMortality: mv(110),
    publicHealthPreparedness: mv(72),
    mentalHealthAccess: mv(58),
    // IE-specific
    slaintecareProgress: mv(38), // HSE 2023 — partial rollout ~5 yrs into 10-yr plan
    hseWaitingListMonths: mv(14), // NTPF Q4 2023 — median outpatient wait
  },
  infrastructure: {
    roadCondition: mv(70),
    broadbandAccess: mv(88),
    publicTransit: mv(55),
    waterQuality: mv(96),
    powerGridReliability: mv(99.9),
    infrastructureInvestmentGap: mv(28),
  },
  publicSafety: {
    crimeRate: mv(2_800),
    violentCrimeRate: mv(80),
    policePerCapita: mv(3.0),
    incarcerationRate: mv(90),
    recidivismRate: mv(38),
    publicSafetyConfidence: mv(72),
  },
  environment: {
    airQuality: mv(82),
    renewableEnergy: mv(42),
    carbonEmissions: mv(8.0),
    recyclingRate: mv(42),
    climateResilience: mv(68),
    protectedLand: mv(15),
    // IE-specific
    agriEmissionsShare: mv(38), // EPA 2023 — methane + N₂O dominant
  },
  social: {
    socialMobility: mv(62),
    incomeInequality: mv(32),
    homelessnessRate: mv(5),
    foodInsecurity: mv(6),
    civicParticipation: mv(56),
    socialCohesion: mv(65),
    housingAffordability: mv(28),
    housingSupplyGrowth: mv(1.4),
    // IE-specific
    housingCompletionsRate: mv(5.6), // ~32k completions 2023 ÷ population
    vacantPropertyRate: mv(9), // Census 2022 vacant-dwellings %
    rentalPressureIndex: mv(72), // RTB Q4 2023 — Dublin rent / median income proxy
    irishLanguageStrength: mv(40), // Census 2022 — ~40% claim some Gaeilge ability
  },
  governance: {
    governmentTransparency: mv(74),
    budgetBalance: mv(0.8),
    debtToGdp: mv(43),
    corruptionIndex: mv(20),
    voterTurnout: mv(62),
    publicTrust: mv(52),
    // IE-specific
    unityReferendumSupport: mv(42), // B&A 2023 — RoI polling on N-S unity
    directProvisionLoad: mv(85), // DCEDIY 2023 — IPAS centres ~85% utilization
  },
  population: {
    populationGrowth: mv(1.2),
    urbanizationRate: mv(64),
    medianAge: mv(38.6),
    // Net annual international migration % (modest Celtic-Tiger-era inflow).
    migrationRate: mv(0.6),
  },
  mediaInformation: {
    mediaPolarization: mv(35),
    disinformationRisk: mv(32),
    pressFreedom: mv(86),
    socialMediaSentiment: mv(56),
    newsTrust: mv(52),
  },
};

/**
 * Region-specific overrides. Only deltas from BASELINE — unlisted metrics
 * fall back to the national value. Calibrated to reflect well-known
 * structural differences (Dublin vs rural, east vs west, border region).
 */
type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  gdpGrowth: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  crimeRate: number;
  voterTurnout: number;
  renewableEnergy: number;
  urbanizationRate: number;
  medianAge: number;
  populationGrowth: number;
  housingAffordability: number;
  publicTransit: number;
  roadCondition: number;
  publicTrust: number;
  socialCohesion: number;
  testPerformance: number;
  migrationRate: number;
  // IE-specific overrides
  mncDependency: number;
  fdiPipelineStrength: number;
  capDependency: number;
  housingCompletionsRate: number;
  vacantPropertyRate: number;
  rentalPressureIndex: number;
  irishLanguageStrength: number;
  unityReferendumSupport: number;
  agriEmissionsShare: number;
}>;

const OVERRIDES: Record<string, Override> = {
  // ── Leinster ─────────────────────────────────────────────────────────────
  DUB: {
    unemploymentRate: 5.1,
    medianIncome: 52_000,
    gdpGrowth: 4.2,
    costOfLiving: 128,
    lifeExpectancy: 83.0,
    crimeRate: 4_200,
    urbanizationRate: 99,
    housingAffordability: 18,
    publicTransit: 72,
    migrationRate: 0.8,
    // IE-specific
    mncDependency: 80,
    housingCompletionsRate: 7.2,
    vacantPropertyRate: 5,
    rentalPressureIndex: 85,
    irishLanguageStrength: 25,
  },
  KIL: {
    unemploymentRate: 3.8,
    medianIncome: 46_000,
    gdpGrowth: 3.8,
    costOfLiving: 108,
    housingAffordability: 32,
    // IE-specific
    mncDependency: 72,
    rentalPressureIndex: 76,
  },
  MID: {
    unemploymentRate: 5.5,
    medianIncome: 36_000,
    gdpGrowth: 2.2,
    costOfLiving: 88,
    urbanizationRate: 42,
    publicTransit: 28,
    // IE-specific
    mncDependency: 30,
    vacantPropertyRate: 14,
    capDependency: 80,
  },
  WEX: {
    unemploymentRate: 5.8,
    medianIncome: 35_000,
    gdpGrowth: 2.0,
    costOfLiving: 85,
    urbanizationRate: 50,
    // IE-specific
    mncDependency: 38,
    vacantPropertyRate: 12,
    capDependency: 70,
  },

  // ── Munster ───────────────────────────────────────────────────────────────
  LIM: {
    unemploymentRate: 4.5,
    medianIncome: 40_000,
    gdpGrowth: 3.2,
    costOfLiving: 92,
    renewableEnergy: 55,
    // IE-specific
    mncDependency: 68,
  },
  COR: {
    unemploymentRate: 3.9,
    medianIncome: 41_000,
    gdpGrowth: 4.0,
    costOfLiving: 96,
    renewableEnergy: 48,
    migrationRate: 0.5,
    // IE-specific
    mncDependency: 72,
    fdiPipelineStrength: 88,
    irishLanguageStrength: 45,
  },

  // ── Connacht ──────────────────────────────────────────────────────────────
  GAL: {
    unemploymentRate: 6.2,
    medianIncome: 34_000,
    gdpGrowth: 2.4,
    costOfLiving: 82,
    urbanizationRate: 40,
    renewableEnergy: 60,
    // IE-specific
    mncDependency: 35,
    capDependency: 78,
    irishLanguageStrength: 75,
    agriEmissionsShare: 52,
  },

  // ── Ulster (Republic portion) ──────────────────────────────────────────────
  DON: {
    unemploymentRate: 7.5,
    medianIncome: 32_000,
    gdpGrowth: 1.8,
    costOfLiving: 80,
    urbanizationRate: 38,
    migrationRate: 0.3,
    // IE-specific
    mncDependency: 22,
    capDependency: 75,
    irishLanguageStrength: 60,
    unityReferendumSupport: 58,
    agriEmissionsShare: 48,
  },
};

/** Merge the baseline with per-region overrides, keeping the full shape intact. */
function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "IE",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
      ...(o.mncDependency !== undefined && { mncDependency: mv(o.mncDependency) }),
      ...(o.fdiPipelineStrength !== undefined && {
        fdiPipelineStrength: mv(o.fdiPipelineStrength),
      }),
      ...(o.capDependency !== undefined && { capDependency: mv(o.capDependency) }),
    },
    education: {
      ...BASELINE.education,
      ...(o.testPerformance !== undefined && { testPerformance: mv(o.testPerformance) }),
    },
    healthcare: {
      ...BASELINE.healthcare,
      ...(o.lifeExpectancy !== undefined && { lifeExpectancy: mv(o.lifeExpectancy) }),
    },
    infrastructure: {
      ...BASELINE.infrastructure,
      ...(o.publicTransit !== undefined && { publicTransit: mv(o.publicTransit) }),
      ...(o.roadCondition !== undefined && { roadCondition: mv(o.roadCondition) }),
    },
    publicSafety: {
      ...BASELINE.publicSafety,
      ...(o.crimeRate !== undefined && { crimeRate: mv(o.crimeRate) }),
    },
    environment: {
      ...BASELINE.environment,
      ...(o.renewableEnergy !== undefined && { renewableEnergy: mv(o.renewableEnergy) }),
      ...(o.agriEmissionsShare !== undefined && { agriEmissionsShare: mv(o.agriEmissionsShare) }),
    },
    social: {
      ...BASELINE.social,
      ...(o.housingAffordability !== undefined && {
        housingAffordability: mv(o.housingAffordability),
      }),
      ...(o.socialCohesion !== undefined && { socialCohesion: mv(o.socialCohesion) }),
      ...(o.housingCompletionsRate !== undefined && {
        housingCompletionsRate: mv(o.housingCompletionsRate),
      }),
      ...(o.vacantPropertyRate !== undefined && {
        vacantPropertyRate: mv(o.vacantPropertyRate),
      }),
      ...(o.rentalPressureIndex !== undefined && {
        rentalPressureIndex: mv(o.rentalPressureIndex),
      }),
      ...(o.irishLanguageStrength !== undefined && {
        irishLanguageStrength: mv(o.irishLanguageStrength),
      }),
    },
    governance: {
      ...BASELINE.governance,
      ...(o.voterTurnout !== undefined && { voterTurnout: mv(o.voterTurnout) }),
      ...(o.publicTrust !== undefined && { publicTrust: mv(o.publicTrust) }),
      ...(o.unityReferendumSupport !== undefined && {
        unityReferendumSupport: mv(o.unityReferendumSupport),
      }),
    },
    population: {
      ...BASELINE.population,
      ...(o.urbanizationRate !== undefined && { urbanizationRate: mv(o.urbanizationRate) }),
      ...(o.medianAge !== undefined && { medianAge: mv(o.medianAge) }),
      ...(o.populationGrowth !== undefined && { populationGrowth: mv(o.populationGrowth) }),
      ...(o.migrationRate !== undefined && { migrationRate: mv(o.migrationRate) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const ieStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
