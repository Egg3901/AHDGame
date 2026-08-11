import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Italy region initial metrics — ~1979 (First Republic). Italy is 1979-preset-only.
 * High inflation (~15%), the sharp North–South divide (Mezzogiorno), large state
 * holdings (IRI/ENI), strong unions. `medianIncome` is annual household income in
 * lira.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(7.5),
    medianIncome: mv(7_000_000), // annual household lira
    gdpGrowth: mv(4.0),
    povertyRate: mv(16),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.5), // strong SME tradition
    laborParticipation: mv(60),
    matchingFriction: mv(6),
    tradeBalance: mv(-1.0),
    productivityGrowth: mv(2.8),
    rdIntensity: mv(1.0),
    exportDependency: mv(22),
    manufacturingCompetitiveness: mv(72),
  },
  education: {
    highSchoolGradRate: mv(58),
    testPerformance: mv(90),
    educationSpending: mv(7_000),
    literacyRate: mv(96),
    workforceSkill: mv(64),
    apprenticeshipRate: mv(4),
  },
  healthcare: {
    uninsuredRate: mv(3), // Servizio Sanitario Nazionale founded 1978
    affordabilityIndex: mv(66),
    physicianRate: mv(2.6),
    lifeExpectancy: mv(74.0),
    preventableMortality: mv(330),
    publicHealthPreparedness: mv(58),
  },
  infrastructure: {
    roadCondition: mv(64),
    broadbandAccess: mv(0),
    publicTransit: mv(62),
    waterQuality: mv(76),
    powerGridReliability: mv(98.8),
    infrastructureInvestmentGap: mv(30),
  },
  publicSafety: {
    crimeRate: mv(4_200),
    violentCrimeRate: mv(160), // anni di piombo terrorism era
    policePerCapita: mv(4.0),
    incarcerationRate: mv(60),
    recidivismRate: mv(42),
    publicSafetyConfidence: mv(48),
  },
  environment: {
    airQuality: mv(32),
    renewableEnergy: mv(20), // hydro-heavy
    carbonEmissions: mv(7),
    recyclingRate: mv(8),
    climateResilience: mv(50),
    protectedLand: mv(8),
  },
  social: {
    socialMobility: mv(46),
    incomeInequality: mv(40),
    homelessnessRate: mv(4),
    foodInsecurity: mv(7),
    civicParticipation: mv(72),
    socialCohesion: mv(52),
    housingSupplyGrowth: mv(2.0),
  },
  governance: {
    governmentTransparency: mv(42),
    budgetBalance: mv(-8.0), // chronic large deficits
    debtToGdp: mv(58),
    corruptionIndex: mv(48),
    voterTurnout: mv(90),
    publicTrust: mv(42), // unstable coalitions, terrorism
    coDeterminationQuality: mv(55),
  },
  population: {
    populationGrowth: mv(0.4),
    urbanizationRate: mv(66),
    medianAge: mv(33),
    migrationRate: mv(-0.1),
  },
  mediaInformation: {
    mediaPolarization: mv(45),
    disinformationRisk: mv(18),
    pressFreedom: mv(68),
    socialMediaSentiment: mv(0),
    newsTrust: mv(50),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  urbanizationRate: number;
  medianAge: number;
}>;

const OVERRIDES: Record<string, Override> = {
  IT_NW: {
    medianIncome: 9_500_000,
    unemploymentRate: 5.0,
    costOfLiving: 112,
    urbanizationRate: 78,
    povertyRate: 8,
  }, // industrial north
  IT_NE: {
    medianIncome: 8_800_000,
    unemploymentRate: 4.5,
    costOfLiving: 106,
    urbanizationRate: 66,
    povertyRate: 8,
  },
  IT_TUS: {
    medianIncome: 8_000_000,
    unemploymentRate: 6.0,
    costOfLiving: 102,
    urbanizationRate: 64,
  },
  IT_LAZ: {
    medianIncome: 8_200_000,
    unemploymentRate: 7.0,
    costOfLiving: 108,
    urbanizationRate: 82,
  },
  IT_CAM: {
    medianIncome: 5_000_000,
    unemploymentRate: 11.0,
    costOfLiving: 92,
    povertyRate: 26,
    urbanizationRate: 70,
    medianAge: 30,
  }, // Naples / Mezzogiorno
  IT_SUD: {
    medianIncome: 4_600_000,
    unemploymentRate: 12.0,
    costOfLiving: 88,
    povertyRate: 30,
    urbanizationRate: 52,
    medianAge: 31,
  },
  IT_SIC: {
    medianIncome: 4_400_000,
    unemploymentRate: 12.5,
    costOfLiving: 88,
    povertyRate: 32,
    urbanizationRate: 56,
    medianAge: 31,
  },
  IT_SAR: {
    medianIncome: 4_800_000,
    unemploymentRate: 11.5,
    costOfLiving: 90,
    povertyRate: 28,
    urbanizationRate: 54,
  },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "IT",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
    },
    education: { ...BASELINE.education },
    healthcare: {
      ...BASELINE.healthcare,
      ...(o.lifeExpectancy !== undefined && { lifeExpectancy: mv(o.lifeExpectancy) }),
    },
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

export const itStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
