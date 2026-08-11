import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * China macro-region initial metrics — approximate 2023 NBS / World Bank data,
 * tuned for gameplay feel.
 *
 * Units and conventions:
 *   unemploymentRate   — %, e.g. 5.2 means 5.2%
 *   medianIncome       — annual household income in CNY
 *   gdpGrowth          — year-over-year % change
 *   povertyRate        — % below national poverty line
 *   costOfLiving       — index, 100 = national mean
 *   crimeRate          — incidents per 100k population
 *   lifeExpectancy     — years at birth
 *   carbonEmissions    — tons CO2 per capita per year (lower = better)
 *   corruptionIndex    — 0-100 scale (lower = cleaner; Transparency Int'l style)
 *   voterTurnout       — % turnout in NPC delegate elections
 *
 * All values use `{ value, trend? }` wrappers expected by the engine.
 */

function mv(value: number, trend?: number) {
  return { value, trend };
}

/**
 * China national baseline. Each region overrides via `buildMetrics` below so
 * the per-region definitions stay compact. National-average values calibrated
 * to reflect 2023 China macroeconomic and social statistics.
 */
const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(5.2),
    medianIncome: mv(100_000),
    gdpGrowth: mv(5.2),
    povertyRate: mv(0.6),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(6.8),
    laborParticipation: mv(76),
    matchingFriction: mv(3.2),
    tradeBalance: mv(2.5),
    productivityGrowth: mv(3.0),
    rdIntensity: mv(2.4),
    commonProsperityIndex: mv(35),
  },
  education: {
    testPerformance: mv(86),
    educationSpending: mv(14_000),
    literacyRate: mv(97),
    workforceSkill: mv(74),
  },
  healthcare: {
    physicianRate: mv(3.2),
    lifeExpectancy: mv(77.1),
    preventableMortality: mv(140),
    publicHealthPreparedness: mv(72),
    mentalHealthAccess: mv(42),
  },
  infrastructure: {
    roadCondition: mv(78),
    broadbandAccess: mv(94),
    publicTransit: mv(72),
    waterQuality: mv(82),
    powerGridReliability: mv(99.8),
    infrastructureInvestmentGap: mv(18),
  },
  publicSafety: {
    crimeRate: mv(4_800),
    violentCrimeRate: mv(120),
    policePerCapita: mv(3.8),
    incarcerationRate: mv(155),
    recidivismRate: mv(28),
    publicSafetyConfidence: mv(78),
  },
  environment: {
    airQuality: mv(52),
    renewableEnergy: mv(30),
    carbonEmissions: mv(7.4),
    recyclingRate: mv(32),
    climateResilience: mv(58),
    protectedLand: mv(18),
  },
  social: {
    socialMobility: mv(48),
    incomeInequality: mv(38),
    homelessnessRate: mv(3),
    foodInsecurity: mv(4),
    civicParticipation: mv(82),
    socialCohesion: mv(72),
    housingAffordability: mv(32),
    housingSupplyGrowth: mv(2.2),
  },
  governance: {
    governmentTransparency: mv(45),
    budgetBalance: mv(-2.8),
    debtToGdp: mv(83),
    corruptionIndex: mv(42),
    voterTurnout: mv(90),
    publicTrust: mv(72),
    socialCreditCoverage: mv(45),
    beltAndRoadEngagement: mv(60),
  },
  population: {
    populationGrowth: mv(-0.1),
    urbanizationRate: mv(65),
    medianAge: mv(38.4),
    // Net annual international migration % (China was net-emigration in the 1991 era).
    migrationRate: mv(0.0),
  },
  mediaInformation: {
    mediaPolarization: mv(35),
    disinformationRisk: mv(55),
    pressFreedom: mv(22),
    socialMediaSentiment: mv(58),
    newsTrust: mv(68),
  },
};

/**
 * Region-specific overrides. Only deltas from BASELINE — unlisted metrics
 * fall back to the national value. Calibrated to reflect well-known structural
 * differences across China's macro-regions.
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
}>;

const OVERRIDES: Record<string, Override> = {
  // ── Dongbei (Northeast) — aging rust belt ─────────────────────────────────
  DB: {
    unemploymentRate: 7.5,
    medianIncome: 72_000,
    gdpGrowth: 2.8,
    costOfLiving: 88,
    lifeExpectancy: 76.2,
    urbanizationRate: 68,
    populationGrowth: -0.8,
    medianAge: 43.0,
  },

  // ── Huabei (North) — includes Beijing, Tianjin ────────────────────────────
  HB: {
    unemploymentRate: 4.8,
    medianIncome: 110_000,
    gdpGrowth: 4.5,
    costOfLiving: 108,
    lifeExpectancy: 77.8,
    urbanizationRate: 72,
  },

  // ── Huadong (East) — Shanghai-Yangtze corridor ────────────────────────────
  HD: {
    unemploymentRate: 3.8,
    medianIncome: 148_000,
    gdpGrowth: 6.2,
    costOfLiving: 128,
    lifeExpectancy: 79.2,
    urbanizationRate: 82,
    testPerformance: 92,
    publicTransit: 88,
    housingAffordability: 18,
  },

  // ── Huazhong (Central) ────────────────────────────────────────────────────
  HZ: {
    unemploymentRate: 6.2,
    medianIncome: 80_000,
    gdpGrowth: 5.5,
    costOfLiving: 88,
    lifeExpectancy: 76.5,
    urbanizationRate: 60,
  },

  // ── Huanan (South) — Guangdong-Pearl River powerhouse ─────────────────────
  HN: {
    unemploymentRate: 3.5,
    medianIncome: 135_000,
    gdpGrowth: 6.8,
    costOfLiving: 120,
    lifeExpectancy: 78.8,
    urbanizationRate: 78,
    renewableEnergy: 22,
  },

  // ── Xinan (Southwest) — hydropower-rich ───────────────────────────────────
  XN: {
    unemploymentRate: 6.8,
    medianIncome: 68_000,
    gdpGrowth: 6.0,
    costOfLiving: 80,
    lifeExpectancy: 75.0,
    urbanizationRate: 48,
    renewableEnergy: 48,
  },

  // ── Xibei (Northwest) ─────────────────────────────────────────────────────
  XB: {
    unemploymentRate: 7.2,
    medianIncome: 62_000,
    gdpGrowth: 4.8,
    costOfLiving: 75,
    lifeExpectancy: 74.5,
    urbanizationRate: 42,
    migrationRate: 0.0,
  },
};

/** Merge the baseline with per-region overrides, keeping the full shape intact. */
function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "CN",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
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
    },
    social: {
      ...BASELINE.social,
      ...(o.housingAffordability !== undefined && {
        housingAffordability: mv(o.housingAffordability),
      }),
      ...(o.socialCohesion !== undefined && { socialCohesion: mv(o.socialCohesion) }),
    },
    governance: {
      ...BASELINE.governance,
      ...(o.voterTurnout !== undefined && { voterTurnout: mv(o.voterTurnout) }),
      ...(o.publicTrust !== undefined && { publicTrust: mv(o.publicTrust) }),
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

export const cnStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
