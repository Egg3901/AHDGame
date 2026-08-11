import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * France region initial metrics — ~1979 (Giscard era). France is 1979-preset-only.
 * Developed mixed economy: rising unemployment (~6%), high incomes (FFr),
 * moderate growth, low public debt, nuclear-led energy program, strong public
 * services. `medianIncome` is annual household income in French francs.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(6.0),
    medianIncome: mv(50_000), // annual household FFr
    gdpGrowth: mv(3.3),
    povertyRate: mv(12),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(4.0),
    laborParticipation: mv(67),
    matchingFriction: mv(5),
    tradeBalance: mv(-1.0),
    productivityGrowth: mv(2.5),
    rdIntensity: mv(1.8),
    exportDependency: mv(20),
    manufacturingCompetitiveness: mv(75),
  },
  education: {
    highSchoolGradRate: mv(70),
    testPerformance: mv(94),
    educationSpending: mv(9_000),
    literacyRate: mv(99),
    workforceSkill: mv(70),
    apprenticeshipRate: mv(4),
  },
  healthcare: {
    uninsuredRate: mv(1), // near-universal Sécurité sociale
    affordabilityIndex: mv(72),
    physicianRate: mv(2.0),
    lifeExpectancy: mv(73.5),
    preventableMortality: mv(330),
    publicHealthPreparedness: mv(64),
  },
  infrastructure: {
    roadCondition: mv(72),
    broadbandAccess: mv(0),
    publicTransit: mv(72), // strong rail (SNCF), Paris métro; TGV imminent
    waterQuality: mv(82),
    powerGridReliability: mv(99.4),
    infrastructureInvestmentGap: mv(22),
  },
  publicSafety: {
    crimeRate: mv(4_000),
    violentCrimeRate: mv(150),
    policePerCapita: mv(3.5),
    incarcerationRate: mv(75),
    recidivismRate: mv(40),
    publicSafetyConfidence: mv(58),
  },
  environment: {
    airQuality: mv(35),
    renewableEnergy: mv(18), // hydro-led (nuclear program ramping separately)
    carbonEmissions: mv(9),
    recyclingRate: mv(12),
    climateResilience: mv(55),
    protectedLand: mv(10),
  },
  social: {
    socialMobility: mv(52),
    incomeInequality: mv(38),
    homelessnessRate: mv(4),
    foodInsecurity: mv(6),
    civicParticipation: mv(64),
    socialCohesion: mv(58),
    housingSupplyGrowth: mv(2.2),
  },
  governance: {
    governmentTransparency: mv(55),
    budgetBalance: mv(-1.0),
    debtToGdp: mv(21), // low public debt in 1979
    corruptionIndex: mv(30),
    voterTurnout: mv(83),
    publicTrust: mv(50),
    coDeterminationQuality: mv(55),
  },
  population: {
    populationGrowth: mv(0.4),
    urbanizationRate: mv(73),
    medianAge: mv(32),
    migrationRate: mv(0.2),
  },
  mediaInformation: {
    mediaPolarization: mv(35),
    disinformationRisk: mv(15),
    pressFreedom: mv(72),
    socialMediaSentiment: mv(0),
    newsTrust: mv(55),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  gdpGrowth: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  urbanizationRate: number;
  medianAge: number;
}>;

const OVERRIDES: Record<string, Override> = {
  FR_IDF: {
    medianIncome: 68_000,
    costOfLiving: 120,
    unemploymentRate: 5.0,
    urbanizationRate: 92,
    medianAge: 31,
  }, // Paris
  FR_NOR: { medianIncome: 44_000, costOfLiving: 92, unemploymentRate: 8.0, urbanizationRate: 70 }, // industrial decline
  FR_EST: { medianIncome: 48_000, costOfLiving: 96, unemploymentRate: 6.5, urbanizationRate: 66 },
  FR_OUE: {
    medianIncome: 44_000,
    costOfLiving: 92,
    povertyRate: 14,
    urbanizationRate: 52,
    medianAge: 34,
  }, // rural west
  FR_SOU: { medianIncome: 45_000, costOfLiving: 93, urbanizationRate: 56, medianAge: 35 },
  FR_ARA: { medianIncome: 52_000, costOfLiving: 100, urbanizationRate: 70 }, // Lyon
  FR_MED: {
    medianIncome: 47_000,
    costOfLiving: 102,
    unemploymentRate: 7.5,
    urbanizationRate: 72,
    medianAge: 35,
  },
  FR_CEN: { medianIncome: 44_000, costOfLiving: 92, urbanizationRate: 54, medianAge: 35 },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "FR",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
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

export const frStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
