import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Sweden region initial metrics — ~1979 (the Swedish model). Sweden is
 * 1979-preset-only. Near-full employment, very low inequality, the world's most
 * generous welfare state, high taxes, hydro-heavy energy, the freest press.
 * `medianIncome` is annual household income in kronor.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(2.0), // active labour-market policy, near-full employment
    medianIncome: mv(90_000), // annual household kronor
    gdpGrowth: mv(3.8),
    povertyRate: mv(6),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(3.5),
    laborParticipation: mv(70), // high female participation
    matchingFriction: mv(3),
    tradeBalance: mv(0.5),
    productivityGrowth: mv(2.6),
    rdIntensity: mv(2.0),
    exportDependency: mv(28),
    manufacturingCompetitiveness: mv(82),
  },
  education: {
    highSchoolGradRate: mv(72),
    testPerformance: mv(96),
    educationSpending: mv(11_000),
    literacyRate: mv(99),
    workforceSkill: mv(76),
    apprenticeshipRate: mv(5),
  },
  healthcare: {
    uninsuredRate: mv(0), // universal public healthcare
    affordabilityIndex: mv(82),
    physicianRate: mv(2.2),
    lifeExpectancy: mv(75.5),
    preventableMortality: mv(280),
    publicHealthPreparedness: mv(72),
  },
  infrastructure: {
    roadCondition: mv(78),
    broadbandAccess: mv(0),
    publicTransit: mv(74),
    waterQuality: mv(90),
    powerGridReliability: mv(99.7),
    infrastructureInvestmentGap: mv(16),
  },
  publicSafety: {
    crimeRate: mv(3_000),
    violentCrimeRate: mv(60),
    policePerCapita: mv(2.8),
    incarcerationRate: mv(55),
    recidivismRate: mv(36),
    publicSafetyConfidence: mv(70),
  },
  environment: {
    airQuality: mv(22),
    renewableEnergy: mv(45), // large hydro base
    carbonEmissions: mv(9),
    recyclingRate: mv(20),
    climateResilience: mv(70),
    protectedLand: mv(8),
  },
  social: {
    socialMobility: mv(68),
    incomeInequality: mv(24), // among the lowest in the world
    homelessnessRate: mv(2),
    foodInsecurity: mv(3),
    civicParticipation: mv(74),
    socialCohesion: mv(70),
    housingSupplyGrowth: mv(2.4), // tail end of the Million Programme
  },
  governance: {
    governmentTransparency: mv(75), // strong transparency tradition
    budgetBalance: mv(-3.0),
    debtToGdp: mv(30),
    corruptionIndex: mv(15), // very low corruption
    voterTurnout: mv(90),
    publicTrust: mv(66),
    coDeterminationQuality: mv(78), // strong codetermination (MBL 1976)
  },
  population: {
    populationGrowth: mv(0.2),
    urbanizationRate: mv(70),
    medianAge: mv(36),
    migrationRate: mv(0.2),
  },
  mediaInformation: {
    mediaPolarization: mv(25),
    disinformationRisk: mv(10),
    pressFreedom: mv(90), // freest press in the world
    socialMediaSentiment: mv(0),
    newsTrust: mv(70),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  povertyRate: number;
  costOfLiving: number;
  urbanizationRate: number;
  medianAge: number;
}>;

const OVERRIDES: Record<string, Override> = {
  SE_STH: { medianIncome: 108_000, costOfLiving: 114, urbanizationRate: 88, unemploymentRate: 1.6 },
  SE_GOT: { medianIncome: 96_000, costOfLiving: 104, urbanizationRate: 78 },
  SE_SKA: { medianIncome: 88_000, costOfLiving: 100, urbanizationRate: 66 },
  SE_EAS: { medianIncome: 86_000, costOfLiving: 98, urbanizationRate: 62 },
  SE_SML: { medianIncome: 82_000, costOfLiving: 94, urbanizationRate: 52, medianAge: 38 },
  SE_VML: { medianIncome: 84_000, costOfLiving: 96, urbanizationRate: 60, unemploymentRate: 2.6 }, // industrial
  SE_NOR: {
    medianIncome: 82_000,
    costOfLiving: 96,
    urbanizationRate: 50,
    unemploymentRate: 3.0,
    medianAge: 38,
  }, // resource North
  SE_UPP: { medianIncome: 88_000, costOfLiving: 100, urbanizationRate: 58 },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "SE",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
    },
    education: { ...BASELINE.education },
    healthcare: { ...BASELINE.healthcare },
    infrastructure: { ...BASELINE.infrastructure },
    publicSafety: { ...BASELINE.publicSafety },
    environment: { ...BASELINE.environment },
    social: { ...BASELINE.social },
    governance: { ...BASELINE.governance },
    population: {
      ...BASELINE.population,
      ...(o.urbanizationRate !== undefined && { urbanizationRate: mv(o.urbanizationRate) }),
      ...(o.medianAge !== undefined && { medianAge: mv(o.medianAge) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const seStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
