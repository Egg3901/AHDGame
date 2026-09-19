import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Nigeria geopolitical-zone initial metrics — approximate 2022–2023 NBS /
 * NDLEA / NOI Polls / TI / V-Dem data, tuned for gameplay feel.
 *
 * Units and conventions:
 *   unemploymentRate   — %, e.g. 33.3 means 33.3%
 *   medianIncome       — annual household income in NGN
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
 * Nigeria national baseline. Each region overrides via `buildMetrics` below so
 * the per-zone definitions stay compact. National-average values pulled from
 * NBS 2022 (economy, labour), DHS 2023 (health, education), NPC 2022 (population),
 * NEITI 2022 (environment, energy), and INEC 2019 (turnout).
 */
const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(33.3),
    medianIncome: mv(1_200_000),
    gdpGrowth: mv(3.0),
    povertyRate: mv(40.1),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(4.0),
    laborParticipation: mv(55),
    matchingFriction: mv(7.0),
    tradeBalance: mv(0.5),
    productivityGrowth: mv(0.5),
    rdIntensity: mv(0.2),
  },
  education: {
    testPerformance: mv(45),
    educationSpending: mv(1_500),
    literacyRate: mv(62),
    workforceSkill: mv(40),
  },
  healthcare: {
    physicianRate: mv(0.4),
    lifeExpectancy: mv(53.0),
    preventableMortality: mv(350),
    publicHealthPreparedness: mv(40),
    mentalHealthAccess: mv(20),
  },
  infrastructure: {
    roadCondition: mv(35),
    broadbandAccess: mv(35),
    publicTransit: mv(25),
    waterQuality: mv(45),
    powerGridReliability: mv(50),
    infrastructureInvestmentGap: mv(65),
  },
  publicSafety: {
    crimeRate: mv(12_000),
    violentCrimeRate: mv(800),
    policePerCapita: mv(1.5),
    incarcerationRate: mv(30),
    recidivismRate: mv(45),
    publicSafetyConfidence: mv(25),
  },
  environment: {
    airQuality: mv(50),
    renewableEnergy: mv(18),
    carbonEmissions: mv(0.6),
    recyclingRate: mv(5),
    climateResilience: mv(30),
    protectedLand: mv(12),
  },
  social: {
    socialMobility: mv(25),
    incomeInequality: mv(45),
    homelessnessRate: mv(10),
    foodInsecurity: mv(40),
    civicParticipation: mv(45),
    socialCohesion: mv(35),
    housingAffordability: mv(45),
    housingSupplyGrowth: mv(1.0),
  },
  governance: {
    governmentTransparency: mv(30),
    budgetBalance: mv(-5.0),
    debtToGdp: mv(38),
    corruptionIndex: mv(80),
    voterTurnout: mv(35),
    publicTrust: mv(20),
  },
  population: {
    populationGrowth: mv(2.4),
    urbanizationRate: mv(53),
    medianAge: mv(17.5),
    // Net annual international migration % (Nigeria ≈ net emigration, brain drain).
    migrationRate: mv(-0.3),
  },
  mediaInformation: {
    mediaPolarization: mv(60),
    disinformationRisk: mv(70),
    pressFreedom: mv(45),
    socialMediaSentiment: mv(40),
    newsTrust: mv(30),
  },
};

/**
 * Zone-specific overrides. Only deltas from BASELINE — unlisted metrics
 * fall back to the national value. Calibrated to reflect well-known
 * structural differences (NORTH_EAST insurgency, SOUTH_SOUTH oil-wealth +
 * militancy, SOUTH_WEST Lagos economic engine, NORTH_WEST population weight,
 * NORTH_CENTRAL middle-belt swing, SOUTH_EAST Igbo commercial networks).
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
  // ── NORTH_WEST ─────────────────────────────────────────────────────────────
  // Kano / Kaduna / Sokoto heartland: largest population, Hausa-Fulani core,
  // APC stronghold, subsistence agriculture + banditry security challenges.
  NORTH_WEST: {
    unemploymentRate: 38.0,
    medianIncome: 900_000,
    gdpGrowth: 2.6,
    povertyRate: 52.0,
    costOfLiving: 88,
    lifeExpectancy: 51.0,
    crimeRate: 14_000,
    urbanizationRate: 42,
    medianAge: 16.0,
  },

  // ── NORTH_EAST ─────────────────────────────────────────────────────────────
  // Borno / Yobe / Adamawa: Boko Haram insurgency, lowest infrastructure /
  // education / publicSafety, IDP crisis, subsistence farming.
  NORTH_EAST: {
    unemploymentRate: 42.0,
    medianIncome: 750_000,
    gdpGrowth: 1.8,
    povertyRate: 60.0,
    costOfLiving: 82,
    lifeExpectancy: 49.5,
    crimeRate: 18_000,
    urbanizationRate: 35,
    testPerformance: 35,
    publicTransit: 18,
    socialCohesion: 25,
    medianAge: 16.0,
  },

  // ── NORTH_CENTRAL ──────────────────────────────────────────────────────────
  // Plateau / Benue / FCT-Abuja: middle-belt swing zone, ethnically diverse,
  // agriculture + federal-capital spending, herder-farmer tensions.
  NORTH_CENTRAL: {
    unemploymentRate: 35.0,
    medianIncome: 1_100_000,
    gdpGrowth: 3.2,
    povertyRate: 42.0,
    costOfLiving: 98,
    lifeExpectancy: 52.5,
    crimeRate: 11_000,
    urbanizationRate: 50,
  },

  // ── SOUTH_WEST ─────────────────────────────────────────────────────────────
  // Lagos / Ogun / Oyo: economic engine, APC heartland (Tinubu network),
  // best education scores, highest incomes, densest transit (Lagos BRT),
  // highest cost of living.
  SOUTH_WEST: {
    unemploymentRate: 28.0,
    medianIncome: 1_900_000,
    gdpGrowth: 4.0,
    povertyRate: 26.0,
    costOfLiving: 118,
    lifeExpectancy: 55.5,
    crimeRate: 10_000,
    urbanizationRate: 72,
    smallBusinessFormation: 6.0,
    testPerformance: 58,
    publicTransit: 42,
    medianAge: 19.0,
  },

  // ── SOUTH_SOUTH ────────────────────────────────────────────────────────────
  // Niger Delta (Rivers / Delta / Bayelsa): oil-wealth paradox, gas flaring +
  // environmental degradation, militancy / pipeline sabotage, PDP base.
  SOUTH_SOUTH: {
    unemploymentRate: 36.0,
    medianIncome: 1_500_000,
    gdpGrowth: 2.8,
    povertyRate: 45.0,
    costOfLiving: 105,
    lifeExpectancy: 52.0,
    crimeRate: 16_000,
    urbanizationRate: 60,
    renewableEnergy: 8,
    medianAge: 18.0,
  },

  // ── SOUTH_EAST ─────────────────────────────────────────────────────────────
  // Igbo heartland (Anambra / Imo / Enugu): commercial networks, APGA base,
  // highest small-business formation, strong education, Biafra-era cohesion.
  SOUTH_EAST: {
    unemploymentRate: 32.0,
    medianIncome: 1_400_000,
    gdpGrowth: 3.6,
    povertyRate: 32.0,
    costOfLiving: 102,
    lifeExpectancy: 54.0,
    crimeRate: 9_000,
    urbanizationRate: 58,
    smallBusinessFormation: 7.0,
    testPerformance: 56,
    socialCohesion: 42,
    medianAge: 19.0,
  },
};

/** Merge the baseline with per-zone overrides, keeping the full shape intact. */
function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "NG",
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

export const ngStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
