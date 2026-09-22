import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Austria region initial metrics — ~1979 (late Kreisky era). One of Europe's
 * quietest success stories: near-full employment held up by Austro-Keynesian
 * deficit spending and the nationalised industries, a hard-schilling peg to
 * the D-Mark keeping inflation low, Sozialpartnerschaft delivering almost
 * zero strikes, and a large state-owned sector (ÖIAG) hiding structural rot
 * in steel. `medianIncome` is annual household schilling.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(2.1), // full employment as declared policy
    medianIncome: mv(190_000), // annual household schilling
    gdpGrowth: mv(4.7), // strong 1979 on stimulus
    povertyRate: mv(10),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.5), // Gewerbeordnung guild licensing
    laborParticipation: mv(60),
    matchingFriction: mv(3),
    tradeBalance: mv(-4.0), // goods deficit offset by tourism
    productivityGrowth: mv(3.2),
    rdIntensity: mv(1.1),
    exportDependency: mv(24),
    manufacturingCompetitiveness: mv(70),
  },
  education: {
    highSchoolGradRate: mv(78),
    testPerformance: mv(96),
    educationSpending: mv(5_400),
    literacyRate: mv(99),
    workforceSkill: mv(74), // Lehre apprenticeship system
    apprenticeshipRate: mv(42),
  },
  healthcare: {
    uninsuredRate: mv(2), // near-universal Krankenkassen coverage
    affordabilityIndex: mv(76),
    physicianRate: mv(2.6),
    lifeExpectancy: mv(72.4),
    preventableMortality: mv(260),
    publicHealthPreparedness: mv(68),
  },
  infrastructure: {
    roadCondition: mv(74),
    broadbandAccess: mv(0),
    publicTransit: mv(74),
    waterQuality: mv(88),
    powerGridReliability: mv(99.2), // Alpine hydro backbone
    infrastructureInvestmentGap: mv(22),
  },
  publicSafety: {
    crimeRate: mv(2_600),
    violentCrimeRate: mv(60),
    policePerCapita: mv(3.2),
    incarcerationRate: mv(90),
    recidivismRate: mv(40),
    publicSafetyConfidence: mv(74),
  },
  environment: {
    airQuality: mv(66),
    renewableEnergy: mv(58), // hydro-dominated grid
    carbonEmissions: mv(7),
    recyclingRate: mv(8),
    climateResilience: mv(60),
    protectedLand: mv(12),
  },
  social: {
    socialMobility: mv(58),
    incomeInequality: mv(30),
    homelessnessRate: mv(1.5),
    foodInsecurity: mv(3),
    civicParticipation: mv(62), // Lager party memberships still massive
    socialCohesion: mv(68), // Sozialpartnerschaft consensus
    housingSupplyGrowth: mv(2.5), // Gemeindebau social housing
  },
  governance: {
    governmentTransparency: mv(52), // Proporz patronage
    budgetBalance: mv(-3.0), // Austro-Keynesian deficits
    debtToGdp: mv(30),
    corruptionIndex: mv(38),
    voterTurnout: mv(92),
    publicTrust: mv(66),
    coDeterminationQuality: mv(78), // chambers + works councils
  },
  population: {
    populationGrowth: mv(0.0), // stagnant natural growth
    urbanizationRate: mv(54),
    medianAge: mv(35),
    migrationRate: mv(0.3), // Yugoslav/Turkish guest workers
  },
  mediaInformation: {
    mediaPolarization: mv(40), // ORF monopoly + party papers
    disinformationRisk: mv(18),
    pressFreedom: mv(74),
    socialMediaSentiment: mv(0),
    newsTrust: mv(58),
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
  AT_VIE: {
    medianIncome: 215_000,
    costOfLiving: 110,
    povertyRate: 8,
    lifeExpectancy: 72,
    urbanizationRate: 94,
    violentCrimeRate: 85,
  }, // the imperial capital, shrinking and ageing but richest
  AT_NOE: {
    medianIncome: 175_000,
    costOfLiving: 96,
    povertyRate: 12,
    lifeExpectancy: 72,
    urbanizationRate: 32,
  }, // agrarian east + Vienna commuter belt
  AT_OOE: {
    medianIncome: 195_000,
    costOfLiving: 98,
    povertyRate: 9,
    lifeExpectancy: 72.5,
    urbanizationRate: 44,
  }, // VOEST Linz industry + Salzburg tourism
  AT_STK: {
    unemploymentRate: 2.8,
    medianIncome: 170_000,
    costOfLiving: 95,
    povertyRate: 13,
    lifeExpectancy: 72,
    urbanizationRate: 42,
  }, // Mur-Mürz rustbelt steel towns already softening
  AT_TYR: {
    medianIncome: 185_000,
    costOfLiving: 102,
    povertyRate: 9,
    lifeExpectancy: 73,
    urbanizationRate: 40,
  }, // Alpine tourism boom
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "AT",
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

export const atStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
