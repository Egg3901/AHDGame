import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Spain region initial metrics — ~1979 (the Transition). Spain is 1979-preset-only.
 * Rapidly rising unemployment (transition crisis), high inflation (~16%), a sharp
 * developed-North / poorer-South gradient, low public debt (Franco legacy), and a
 * newly free press. `medianIncome` is annual household income in pesetas.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(9.0),
    medianIncome: mv(700_000), // annual household pesetas
    gdpGrowth: mv(1.0), // post-oil-crisis near-stagnation
    povertyRate: mv(19),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.0),
    laborParticipation: mv(52), // low female participation in 1979
    matchingFriction: mv(7),
    tradeBalance: mv(-2.0),
    productivityGrowth: mv(2.5),
    rdIntensity: mv(0.4),
    exportDependency: mv(14),
    manufacturingCompetitiveness: mv(66),
  },
  education: {
    highSchoolGradRate: mv(50),
    testPerformance: mv(88),
    educationSpending: mv(5_500),
    literacyRate: mv(93),
    workforceSkill: mv(58),
    apprenticeshipRate: mv(3),
  },
  healthcare: {
    uninsuredRate: mv(15), // pre-universal (Seguridad Social expanding)
    affordabilityIndex: mv(60),
    physicianRate: mv(2.3),
    lifeExpectancy: mv(75.5),
    preventableMortality: mv(310),
    publicHealthPreparedness: mv(54),
  },
  infrastructure: {
    roadCondition: mv(58),
    broadbandAccess: mv(0),
    publicTransit: mv(56),
    waterQuality: mv(74),
    powerGridReliability: mv(98.5),
    infrastructureInvestmentGap: mv(34),
  },
  publicSafety: {
    crimeRate: mv(3_600),
    violentCrimeRate: mv(140), // ETA terrorism era
    policePerCapita: mv(4.5),
    incarcerationRate: mv(55),
    recidivismRate: mv(42),
    publicSafetyConfidence: mv(46),
  },
  environment: {
    airQuality: mv(36),
    renewableEnergy: mv(22), // hydro-heavy
    carbonEmissions: mv(5),
    recyclingRate: mv(6),
    climateResilience: mv(48),
    protectedLand: mv(6),
  },
  social: {
    socialMobility: mv(48),
    incomeInequality: mv(38),
    homelessnessRate: mv(4),
    foodInsecurity: mv(8),
    civicParticipation: mv(58),
    socialCohesion: mv(50),
    housingSupplyGrowth: mv(2.6),
  },
  governance: {
    governmentTransparency: mv(45),
    budgetBalance: mv(-2.0),
    debtToGdp: mv(16), // very low (Franco legacy)
    corruptionIndex: mv(45),
    voterTurnout: mv(68),
    publicTrust: mv(48), // young, hopeful but fragile democracy
    coDeterminationQuality: mv(50),
  },
  population: {
    populationGrowth: mv(1.0),
    urbanizationRate: mv(70),
    medianAge: mv(30),
    migrationRate: mv(-0.2), // returning emigrants vs out-migration
  },
  mediaInformation: {
    mediaPolarization: mv(40),
    disinformationRisk: mv(18),
    pressFreedom: mv(60), // newly free post-Franco
    socialMediaSentiment: mv(0),
    newsTrust: mv(52),
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
  violentCrimeRate: number;
}>;

const OVERRIDES: Record<string, Override> = {
  ES_MAD: {
    medianIncome: 980_000,
    unemploymentRate: 7.0,
    costOfLiving: 115,
    urbanizationRate: 92,
    povertyRate: 10,
  },
  ES_CAT: {
    medianIncome: 920_000,
    unemploymentRate: 8.0,
    costOfLiving: 110,
    urbanizationRate: 82,
    povertyRate: 11,
  }, // industrial
  ES_AND: {
    medianIncome: 480_000,
    unemploymentRate: 14.0,
    costOfLiving: 88,
    povertyRate: 32,
    urbanizationRate: 58,
    medianAge: 28,
  }, // poorer south
  ES_VAL: { medianIncome: 680_000, unemploymentRate: 9.0, costOfLiving: 98, urbanizationRate: 70 },
  ES_PVB: {
    medianIncome: 900_000,
    unemploymentRate: 9.0,
    costOfLiving: 108,
    urbanizationRate: 80,
    violentCrimeRate: 240,
  }, // industrial; ETA
  ES_GAL: {
    medianIncome: 500_000,
    unemploymentRate: 8.0,
    costOfLiving: 86,
    povertyRate: 28,
    urbanizationRate: 46,
    medianAge: 33,
  },
  ES_NOR: { medianIncome: 720_000, unemploymentRate: 9.5, costOfLiving: 98, urbanizationRate: 66 },
  ES_CEN: {
    medianIncome: 540_000,
    unemploymentRate: 10.0,
    costOfLiving: 88,
    povertyRate: 26,
    urbanizationRate: 54,
    medianAge: 33,
  },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "ES",
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
    publicSafety: {
      ...BASELINE.publicSafety,
      ...(o.violentCrimeRate !== undefined && { violentCrimeRate: mv(o.violentCrimeRate) }),
    },
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

export const esStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
