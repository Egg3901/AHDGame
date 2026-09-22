import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Brazil macro-region initial metrics — approximate 2022–2023 IBGE / IPEA
 * data, tuned for gameplay feel.
 *
 * Units and conventions:
 *   unemploymentRate   — %, e.g. 8.7 means 8.7%
 *   medianIncome       — annual household income in BRL
 *   gdpGrowth          — year-over-year % change
 *   povertyRate        — % below the national poverty line
 *   costOfLiving       — index, 100 = national mean
 *   crimeRate          — incidents per 100k population
 *   lifeExpectancy     — years at birth
 *   carbonEmissions    — tons CO2 per capita per year (lower = better)
 *   corruptionIndex    — 0-100 scale (lower = cleaner; Transparency Int'l style)
 *   voterTurnout       — % turnout in most recent general election
 *
 * All values use `{ value, trend? }` wrappers expected by the engine.
 */

function mv(value: number, trend?: number) {
  return { value, trend };
}

/**
 * Brazil national baseline. Each region overrides via `buildMetrics` below so
 * the per-region definitions stay compact. National-average values pulled from
 * IBGE 2022 (economy), Atlas da Violência (crime), DATASUS (health),
 * ANEEL (environment), and TSE (turnout).
 */
const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(8.7),
    medianIncome: mv(28_000),
    gdpGrowth: mv(2.9),
    povertyRate: mv(31.6),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.5),
    laborParticipation: mv(64),
    matchingFriction: mv(4.5),
    tradeBalance: mv(1.2),
    productivityGrowth: mv(0.8),
    rdIntensity: mv(1.2),
  },
  education: {
    testPerformance: mv(68),
    educationSpending: mv(4_200),
    literacyRate: mv(94),
    workforceSkill: mv(58),
  },
  healthcare: {
    physicianRate: mv(2.3),
    lifeExpectancy: mv(73.8),
    preventableMortality: mv(185),
    publicHealthPreparedness: mv(58),
    mentalHealthAccess: mv(38),
  },
  infrastructure: {
    roadCondition: mv(48),
    broadbandAccess: mv(78),
    publicTransit: mv(42),
    waterQuality: mv(72),
    powerGridReliability: mv(98.5),
    infrastructureInvestmentGap: mv(45),
  },
  publicSafety: {
    crimeRate: mv(28_000),
    violentCrimeRate: mv(2_200),
    policePerCapita: mv(2.8),
    incarcerationRate: mv(368),
    recidivismRate: mv(52),
    publicSafetyConfidence: mv(32),
  },
  environment: {
    airQuality: mv(62),
    renewableEnergy: mv(82),
    carbonEmissions: mv(2.4),
    recyclingRate: mv(18),
    climateResilience: mv(52),
    protectedLand: mv(28),
  },
  social: {
    socialMobility: mv(38),
    incomeInequality: mv(52),
    homelessnessRate: mv(14),
    foodInsecurity: mv(22),
    civicParticipation: mv(72),
    socialCohesion: mv(44),
    housingAffordability: mv(36),
    housingSupplyGrowth: mv(1.6),
  },
  governance: {
    governmentTransparency: mv(42),
    budgetBalance: mv(-6.5),
    debtToGdp: mv(74),
    corruptionIndex: mv(63),
    voterTurnout: mv(79),
    publicTrust: mv(28),
  },
  population: {
    populationGrowth: mv(0.6),
    urbanizationRate: mv(87),
    medianAge: mv(33.5),
    // Net annual international migration % (Brazil ~neutral / slight emigration).
    migrationRate: mv(0.1),
  },
  mediaInformation: {
    mediaPolarization: mv(68),
    disinformationRisk: mv(72),
    pressFreedom: mv(52),
    socialMediaSentiment: mv(45),
    newsTrust: mv(38),
  },
};

/**
 * Region-specific overrides. Only deltas from BASELINE — unlisted metrics
 * fall back to the national value. Calibrated to reflect well-known
 * structural differences (Norte/Nordeste poverty gap, Sudeste wealth concentration,
 * Sul European-heritage prosperity, Centro-Oeste agribusiness boom).
 */
type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  gdpGrowth: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  crimeRate: number;
  urbanizationRate: number;
  renewableEnergy: number;
  medianAge: number;
  smallBusinessFormation: number;
  testPerformance: number;
  publicTransit: number;
  housingAffordability: number;
  socialCohesion: number;
}>;

const OVERRIDES: Record<string, Override> = {
  // ── Norte ─────────────────────────────────────────────────────────────────
  // Amazon basin: youngest population, high hydroelectric share, poverty despite
  // resource wealth, strong population growth, frontier economics.
  NORTE: {
    unemploymentRate: 9.5,
    medianIncome: 22_000,
    gdpGrowth: 3.8,
    povertyRate: 42.0,
    costOfLiving: 88,
    lifeExpectancy: 72.0,
    crimeRate: 32_000,
    urbanizationRate: 76,
    renewableEnergy: 92,
    medianAge: 28.0,
  },

  // ── Nordeste ──────────────────────────────────────────────────────────────
  // Historically the poorest region; highest unemployment, lowest incomes,
  // strong PT base through Bolsa Família. Afro-Brazilian cultural heartland.
  NORDESTE: {
    unemploymentRate: 12.4,
    medianIncome: 18_000,
    gdpGrowth: 2.2,
    povertyRate: 48.0,
    costOfLiving: 80,
    lifeExpectancy: 72.5,
    crimeRate: 35_000,
    urbanizationRate: 78,
    housingAffordability: 28,
  },

  // ── Centro-Oeste ──────────────────────────────────────────────────────────
  // Agribusiness boom (soy, beef), lowest unemployment, Brasília federal
  // spending, high smallBusinessFormation, conservative rural stronghold.
  CENTRO_OESTE: {
    unemploymentRate: 6.8,
    medianIncome: 34_000,
    gdpGrowth: 4.2,
    povertyRate: 20.0,
    costOfLiving: 104,
    lifeExpectancy: 74.5,
    crimeRate: 25_000,
    urbanizationRate: 90,
    smallBusinessFormation: 7.0,
  },

  // ── Sudeste ───────────────────────────────────────────────────────────────
  // São Paulo / Rio / Minas Gerais economic engine; highest incomes, best
  // education scores, strong public transit (SP Metro), high cost of living.
  SUDESTE: {
    unemploymentRate: 7.8,
    medianIncome: 38_000,
    gdpGrowth: 3.2,
    povertyRate: 22.0,
    costOfLiving: 115,
    lifeExpectancy: 75.8,
    crimeRate: 22_000,
    urbanizationRate: 95,
    testPerformance: 74,
    publicTransit: 58,
  },

  // ── Sul ───────────────────────────────────────────────────────────────────
  // European-heritage states (Paraná, Santa Catarina, Rio Grande do Sul);
  // lowest poverty, best life expectancy, strongest social cohesion, CDO-lean.
  SUL: {
    unemploymentRate: 5.9,
    medianIncome: 36_000,
    gdpGrowth: 3.5,
    povertyRate: 14.0,
    costOfLiving: 108,
    lifeExpectancy: 76.8,
    crimeRate: 18_000,
    urbanizationRate: 86,
    testPerformance: 76,
    socialCohesion: 56,
  },
};

/** Merge the baseline with per-region overrides, keeping the full shape intact. */
function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "BR",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
      ...(o.smallBusinessFormation !== undefined && {
        smallBusinessFormation: mv(o.smallBusinessFormation),
      }),
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
    },
    population: {
      ...BASELINE.population,
      ...(o.urbanizationRate !== undefined && { urbanizationRate: mv(o.urbanizationRate) }),
      ...(o.medianAge !== undefined && { medianAge: mv(o.medianAge) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const brStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
