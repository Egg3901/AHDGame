import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * German Bundesländer initial metrics — approximate 2022 Destatis / Wegweiser
 * Kommune data, tuned for gameplay feel.
 *
 * Units and conventions:
 *   unemploymentRate   — %, e.g. 5.2 means 5.2%
 *   medianIncome       — annual household net income in EUR
 *   gdpGrowth          — year-over-year % change
 *   povertyRate        — % below 60% median-income threshold (Armutsquote)
 *   costOfLiving       — index, 100 = national mean
 *   crimeRate          — incidents per 100k population
 *   lifeExpectancy     — years at birth
 *   carbonEmissions    — tons CO2 per capita per year (lower = better)
 *   corruptionIndex    — 0-100 scale (lower = cleaner; Transparency Int'l style)
 *   voterTurnout       — % turnout in most recent Bundestag election
 *
 * All values use `{ value, trend? }` wrappers expected by the engine.
 */

function mv(value: number, trend?: number) {
  return { value, trend };
}

/**
 * Germany national baseline. Each Land overrides via `mergeMetrics` below so
 * the per-Land definitions stay compact (~1 screen each instead of ~80 lines).
 *
 * National-average values pulled from Destatis 2022 (economy), BKA (crime),
 * RKI/Destatis (health), BMU (environment), and Bundeswahlleiter (turnout).
 */
const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(5.2),
    medianIncome: mv(50_000),
    gdpGrowth: mv(1.5),
    povertyRate: mv(16.0),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(6.0),
    laborParticipation: mv(78),
    matchingFriction: mv(2.5),
    tradeBalance: mv(6.5),
    productivityGrowth: mv(1.1),
    rdIntensity: mv(3.1),
    exportDependency: mv(47),
    manufacturingCompetitiveness: mv(78),
    // DE-specific metric baselines (real Jan-2020 / 2022 nationwide averages)
    eastWestConvergence: mv(75), // 0-100, West ~85, East ~65, post-reunification ~75 nationwide
    mittelstandHealth: mv(70), // 0-100, pre-COVID Mittelstand peak
  },
  education: {
    testPerformance: mv(88),
    educationSpending: mv(9_200),
    literacyRate: mv(99),
    workforceSkill: mv(80),
    apprenticeshipRate: mv(4.5),
  },
  healthcare: {
    physicianRate: mv(4.5),
    lifeExpectancy: mv(81.2),
    preventableMortality: mv(120),
    publicHealthPreparedness: mv(76),
    mentalHealthAccess: mv(62),
  },
  infrastructure: {
    roadCondition: mv(72),
    broadbandAccess: mv(92),
    publicTransit: mv(72),
    waterQuality: mv(94),
    powerGridReliability: mv(99.95),
    infrastructureInvestmentGap: mv(22),
  },
  publicSafety: {
    crimeRate: mv(6_500),
    violentCrimeRate: mv(220),
    policePerCapita: mv(3.2),
    incarcerationRate: mv(67),
    recidivismRate: mv(34),
    publicSafetyConfidence: mv(70),
  },
  environment: {
    airQuality: mv(78),
    renewableEnergy: mv(46),
    carbonEmissions: mv(8.2),
    recyclingRate: mv(67),
    climateResilience: mv(70),
    protectedLand: mv(37),
    energyTransitionProgress: mv(55),
  },
  social: {
    socialMobility: mv(58),
    incomeInequality: mv(29),
    homelessnessRate: mv(4),
    foodInsecurity: mv(8),
    civicParticipation: mv(64),
    socialCohesion: mv(70),
    housingAffordability: mv(55),
    housingSupplyGrowth: mv(1.0),
    // DE-specific
    kitaCoverage: mv(73), // % of eligible children with Kita-Platz (Jan 2020 ~73%)
    wohnungsBauRate: mv(3.8), // new units per 1k residents per year
  },
  governance: {
    governmentTransparency: mv(75),
    budgetBalance: mv(-1.2),
    debtToGdp: mv(66),
    corruptionIndex: mv(22),
    voterTurnout: mv(76),
    publicTrust: mv(58),
    coDeterminationQuality: mv(72),
    // DE-specific
    schuldenbremseHeadroom: mv(0.2), // % of GDP under 0.35% structural-deficit cap (~57% utilization)
    bundeswehrReadiness: mv(55), // Materielle Einsatzbereitschaft reports cited ~55% pre-Sondervermögen
    rentenStabilitaet: mv(65), // healthy under Doppelte Haltelinie but demographically pressured
    euCohesionScore: mv(78), // Merkel-era pro-EU integration consensus high
  },
  population: {
    populationGrowth: mv(0.1),
    urbanizationRate: mv(77),
    medianAge: mv(44.9),
    // Net annual international migration % (post-reunification inflow).
    migrationRate: mv(0.4),
  },
  mediaInformation: {
    mediaPolarization: mv(44),
    disinformationRisk: mv(38),
    pressFreedom: mv(82),
    socialMediaSentiment: mv(54),
    newsTrust: mv(58),
  },
};

/**
 * Land-specific overrides. Only deltas from BASELINE — unlisted metrics
 * fall back to the national value. Calibrated to reflect well-known
 * structural differences (Ost-West gap, urban/rural, north/south).
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
  // ── Süden ────────────────────────────────────────────────────────────────
  BW: {
    unemploymentRate: 3.8,
    medianIncome: 56_000,
    gdpGrowth: 1.9,
    povertyRate: 12.8,
    costOfLiving: 108,
    lifeExpectancy: 82.1,
    crimeRate: 5_200,
    voterTurnout: 80,
    renewableEnergy: 52,
    urbanizationRate: 80,
    medianAge: 44.2,
    populationGrowth: 0.5,
    housingAffordability: 45,
    testPerformance: 92,
  },
  BY: {
    unemploymentRate: 3.2,
    medianIncome: 58_000,
    gdpGrowth: 2.0,
    povertyRate: 12.1,
    costOfLiving: 109,
    lifeExpectancy: 82.4,
    crimeRate: 5_100,
    voterTurnout: 79,
    renewableEnergy: 55,
    urbanizationRate: 75,
    medianAge: 44.0,
    populationGrowth: 0.6,
    housingAffordability: 42,
    testPerformance: 93,
  },

  // ── Westen ───────────────────────────────────────────────────────────────
  NW: {
    unemploymentRate: 6.9,
    medianIncome: 48_000,
    gdpGrowth: 1.2,
    povertyRate: 18.7,
    costOfLiving: 101,
    lifeExpectancy: 80.4,
    crimeRate: 7_800,
    voterTurnout: 76,
    renewableEnergy: 36,
    urbanizationRate: 85,
    medianAge: 44.6,
    populationGrowth: 0.1,
    housingAffordability: 52,
    testPerformance: 87,
  },
  HE: {
    unemploymentRate: 4.9,
    medianIncome: 53_000,
    gdpGrowth: 1.7,
    povertyRate: 16.2,
    costOfLiving: 107,
    lifeExpectancy: 81.0,
    crimeRate: 7_200,
    voterTurnout: 78,
    renewableEnergy: 48,
    urbanizationRate: 77,
    medianAge: 44.6,
    populationGrowth: 0.4,
    housingAffordability: 48,
    testPerformance: 88,
  },
  RP: {
    unemploymentRate: 4.5,
    medianIncome: 48_500,
    gdpGrowth: 1.5,
    povertyRate: 16.8,
    costOfLiving: 99,
    lifeExpectancy: 80.8,
    crimeRate: 6_400,
    voterTurnout: 77,
    renewableEnergy: 54,
    urbanizationRate: 58,
    medianAge: 45.6,
    populationGrowth: 0.1,
    housingAffordability: 62,
    testPerformance: 87,
  },
  SL: {
    unemploymentRate: 6.6,
    medianIncome: 45_000,
    gdpGrowth: 0.8,
    povertyRate: 18.0,
    costOfLiving: 97,
    lifeExpectancy: 80.2,
    crimeRate: 7_000,
    voterTurnout: 75,
    renewableEnergy: 32,
    urbanizationRate: 68,
    medianAge: 46.3,
    populationGrowth: -0.3,
    housingAffordability: 65,
    testPerformance: 84,
  },

  // ── Norden ───────────────────────────────────────────────────────────────
  NI: {
    unemploymentRate: 5.5,
    medianIncome: 48_000,
    gdpGrowth: 1.4,
    povertyRate: 16.9,
    costOfLiving: 98,
    lifeExpectancy: 80.7,
    crimeRate: 6_300,
    voterTurnout: 76,
    renewableEnergy: 62,
    urbanizationRate: 58,
    medianAge: 45.5,
    populationGrowth: 0.2,
    housingAffordability: 64,
    testPerformance: 86,
  },
  SH: {
    unemploymentRate: 5.0,
    medianIncome: 47_000,
    gdpGrowth: 1.5,
    povertyRate: 16.1,
    costOfLiving: 99,
    lifeExpectancy: 80.9,
    crimeRate: 6_200,
    voterTurnout: 78,
    renewableEnergy: 70,
    urbanizationRate: 55,
    medianAge: 46.4,
    populationGrowth: 0.3,
    housingAffordability: 68,
    testPerformance: 86,
  },
  HH: {
    unemploymentRate: 7.3,
    medianIncome: 51_000,
    gdpGrowth: 1.6,
    povertyRate: 20.1,
    costOfLiving: 113,
    lifeExpectancy: 80.8,
    crimeRate: 11_800,
    voterTurnout: 79,
    renewableEnergy: 42,
    urbanizationRate: 100,
    medianAge: 42.3,
    populationGrowth: 0.6,
    housingAffordability: 28,
    testPerformance: 88,
    publicTransit: 92,
  },
  BRE: {
    unemploymentRate: 10.1,
    medianIncome: 44_000,
    gdpGrowth: 0.9,
    povertyRate: 25.8,
    costOfLiving: 104,
    lifeExpectancy: 79.8,
    crimeRate: 14_200,
    voterTurnout: 74,
    renewableEnergy: 38,
    urbanizationRate: 100,
    medianAge: 43.8,
    populationGrowth: 0.1,
    housingAffordability: 52,
    testPerformance: 82,
    publicTransit: 86,
  },

  // ── Osten ────────────────────────────────────────────────────────────────
  BE: {
    unemploymentRate: 9.1,
    medianIncome: 42_000,
    gdpGrowth: 1.8,
    povertyRate: 19.8,
    costOfLiving: 104,
    lifeExpectancy: 80.8,
    crimeRate: 13_500,
    voterTurnout: 75,
    renewableEnergy: 35,
    urbanizationRate: 100,
    medianAge: 42.7,
    populationGrowth: 0.8,
    housingAffordability: 38,
    testPerformance: 84,
    publicTransit: 95,
    migrationRate: 0.6,
  },
  BB: {
    unemploymentRate: 6.2,
    medianIncome: 41_000,
    gdpGrowth: 1.3,
    povertyRate: 15.9,
    costOfLiving: 92,
    lifeExpectancy: 80.2,
    crimeRate: 5_700,
    voterTurnout: 75,
    renewableEnergy: 78,
    urbanizationRate: 38,
    medianAge: 47.7,
    populationGrowth: 0.3,
    housingAffordability: 72,
    testPerformance: 82,
    publicTrust: 48,
  },
  MV: {
    unemploymentRate: 8.4,
    medianIncome: 38_500,
    gdpGrowth: 0.6,
    povertyRate: 20.8,
    costOfLiving: 90,
    lifeExpectancy: 79.2,
    crimeRate: 6_100,
    voterTurnout: 70,
    renewableEnergy: 82,
    urbanizationRate: 33,
    medianAge: 47.9,
    populationGrowth: -0.3,
    housingAffordability: 78,
    testPerformance: 80,
    publicTrust: 42,
    socialCohesion: 58,
  },
  SN: {
    unemploymentRate: 6.0,
    medianIncome: 39_500,
    gdpGrowth: 1.1,
    povertyRate: 17.1,
    costOfLiving: 90,
    lifeExpectancy: 80.6,
    crimeRate: 7_100,
    voterTurnout: 75,
    renewableEnergy: 42,
    urbanizationRate: 55,
    medianAge: 46.6,
    populationGrowth: -0.1,
    housingAffordability: 74,
    testPerformance: 90,
    publicTrust: 44,
    socialCohesion: 56,
  },
  ST: {
    unemploymentRate: 7.9,
    medianIncome: 38_000,
    gdpGrowth: 0.5,
    povertyRate: 20.0,
    costOfLiving: 89,
    lifeExpectancy: 79.1,
    crimeRate: 8_400,
    voterTurnout: 70,
    renewableEnergy: 72,
    urbanizationRate: 42,
    medianAge: 48.0,
    populationGrowth: -0.5,
    housingAffordability: 80,
    testPerformance: 83,
    publicTrust: 40,
    socialCohesion: 56,
  },
  TH: {
    unemploymentRate: 5.8,
    medianIncome: 39_000,
    gdpGrowth: 0.7,
    povertyRate: 16.2,
    costOfLiving: 91,
    lifeExpectancy: 80.7,
    crimeRate: 6_300,
    voterTurnout: 74,
    renewableEnergy: 55,
    urbanizationRate: 45,
    medianAge: 47.9,
    populationGrowth: -0.3,
    housingAffordability: 78,
    testPerformance: 87,
    publicTrust: 46,
    socialCohesion: 58,
  },
};

/** Merge the baseline with per-Land overrides, keeping the full shape intact. */
function buildMetrics(landId: string): StateMetrics {
  const o = OVERRIDES[landId] ?? {};
  return withUniformMetricSet({
    _id: landId,
    countryId: "DE",
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

export const deStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
