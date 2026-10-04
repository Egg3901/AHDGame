import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Hungary region initial metrics — latest available pre-2027 fallback. These
 * are authored gameplay estimates, not observed 2027 values. Budapest
 * concentrates services and FDI; the northwest (Gyor) carries the auto
 * industry; the northeast and the Plain trail on income and health.
 * `medianIncome` is annual household forint.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(4.5),
    medianIncome: mv(4_100_000), // annual household forint
    gdpGrowth: mv(0.6), // 2024 stagnation after the 2023 contraction
    povertyRate: mv(19),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.5),
    laborParticipation: mv(63),
    matchingFriction: mv(6),
    tradeBalance: mv(-2.5), // goods deficit partly offset by services
    productivityGrowth: mv(1.2),
    rdIntensity: mv(1.4),
    exportDependency: mv(78), // auto + battery export engine
    manufacturingCompetitiveness: mv(62),
  },
  education: {
    highSchoolGradRate: mv(88),
    testPerformance: mv(78),
    educationSpending: mv(49_000),
    literacyRate: mv(99),
    workforceSkill: mv(62),
    apprenticeshipRate: mv(8), // dual VET through the auto plants
  },
  healthcare: {
    uninsuredRate: mv(6), // near-universal TAJ with contribution gaps
    affordabilityIndex: mv(58),
    physicianRate: mv(3.5),
    lifeExpectancy: mv(76.5),
    preventableMortality: mv(380),
    publicHealthPreparedness: mv(60),
  },
  infrastructure: {
    roadCondition: mv(64),
    broadbandAccess: mv(92),
    publicTransit: mv(62),
    waterQuality: mv(74),
    powerGridReliability: mv(99.2),
    infrastructureInvestmentGap: mv(28),
  },
  publicSafety: {
    crimeRate: mv(3_400),
    violentCrimeRate: mv(110),
    policePerCapita: mv(3.2),
    incarcerationRate: mv(180),
    recidivismRate: mv(42),
    publicSafetyConfidence: mv(54),
  },
  environment: {
    airQuality: mv(58), // Budapest winter heating smog
    renewableEnergy: mv(18), // solar boom this decade
    carbonEmissions: mv(4.6),
    recyclingRate: mv(35),
    climateResilience: mv(52),
    protectedLand: mv(5),
  },
  social: {
    socialMobility: mv(46),
    incomeInequality: mv(45),
    homelessnessRate: mv(4),
    foodInsecurity: mv(10),
    civicParticipation: mv(48),
    socialCohesion: mv(52),
    housingSupplyGrowth: mv(1.8),
  },
  governance: {
    governmentTransparency: mv(38),
    budgetBalance: mv(-4.5),
    debtToGdp: mv(73),
    corruptionIndex: mv(58),
    voterTurnout: mv(70), // authored baseline; 2026 election is the political roster anchor
    publicTrust: mv(44),
    coDeterminationQuality: mv(40),
  },
  population: {
    populationGrowth: mv(-0.4), // natural decrease, partly offset by immigration
    urbanizationRate: mv(72),
    medianAge: mv(44),
    migrationRate: mv(0.6),
  },
  mediaInformation: {
    mediaPolarization: mv(68), // KESMA-aligned vs independent press
    disinformationRisk: mv(42),
    pressFreedom: mv(44),
    socialMediaSentiment: mv(0),
    newsTrust: mv(36),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  literacyRate: number;
  urbanizationRate: number;
  violentCrimeRate: number;
}>;

const OVERRIDES: Record<string, Override> = {
  HU_BUD: {
    medianIncome: 5_400_000,
    costOfLiving: 118,
    povertyRate: 12,
    lifeExpectancy: 77.5,
    literacyRate: 99,
    urbanizationRate: 96,
    violentCrimeRate: 150,
  }, // Budapest conurbation
  HU_PES: {
    medianIncome: 4_600_000,
    costOfLiving: 106,
    povertyRate: 15,
    lifeExpectancy: 76.5,
    literacyRate: 99,
    urbanizationRate: 68,
  }, // agglomeration commuter belt
  HU_TRW: {
    medianIncome: 4_300_000,
    costOfLiving: 98,
    povertyRate: 17,
    lifeExpectancy: 76.5,
    literacyRate: 99,
    urbanizationRate: 58,
  }, // Gyor auto industry + western border wages
  HU_TRS: {
    medianIncome: 3_600_000,
    costOfLiving: 92,
    povertyRate: 22,
    lifeExpectancy: 76,
    literacyRate: 98,
    urbanizationRate: 52,
  },
  HU_NOR: {
    medianIncome: 3_400_000,
    costOfLiving: 90,
    povertyRate: 25,
    lifeExpectancy: 75,
    literacyRate: 98,
    urbanizationRate: 54,
  }, // Borsod deprivation belt
  HU_ALF: {
    medianIncome: 3_500_000,
    costOfLiving: 90,
    povertyRate: 24,
    lifeExpectancy: 75.5,
    literacyRate: 98,
    urbanizationRate: 52,
  }, // agrarian Plain, Debrecen battery-plant upside
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "HU",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
      ...(o.costOfLiving !== undefined && { costOfLiving: mv(o.costOfLiving) }),
    },
    education: {
      ...BASELINE.education,
      ...(o.literacyRate !== undefined && { literacyRate: mv(o.literacyRate) }),
    },
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
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const huStateMetrics2027: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
export default huStateMetrics2027;
