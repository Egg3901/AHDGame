import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";
import { bgRegions2027 } from "./bgRegions2027";

/**
 * Bulgaria region initial metrics for the 2027 world. These are authored
 * gameplay estimates, not NSI observations, with one exception: each region's
 * `medianIncome` (annual EUR) derives from its own seeded GDP and population
 * at a 0.45 household-income share, so the Sofia-led Southwestern region and
 * the Northwestern region keep their observed output gap. Replace 1:1 with an
 * authored NSI bundle when one exists.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const HOUSEHOLD_INCOME_SHARE = 0.45;

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(4),
    medianIncome: mv(0),
    gdpGrowth: mv(2.2),
    povertyRate: mv(21),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5),
    laborParticipation: mv(58),
    matchingFriction: mv(6),
    tradeBalance: mv(-3),
    productivityGrowth: mv(2),
    rdIntensity: mv(0.8),
    exportDependency: mv(60),
    manufacturingCompetitiveness: mv(56),
  },
  education: {
    highSchoolGradRate: mv(80),
    testPerformance: mv(72),
    educationSpending: mv(1_200),
    literacyRate: mv(98),
    workforceSkill: mv(56),
    apprenticeshipRate: mv(5),
  },
  healthcare: {
    uninsuredRate: mv(10),
    affordabilityIndex: mv(50),
    physicianRate: mv(4.2),
    lifeExpectancy: mv(75.5),
    preventableMortality: mv(450),
    publicHealthPreparedness: mv(52),
  },
  infrastructure: {
    roadCondition: mv(56),
    broadbandAccess: mv(88),
    publicTransit: mv(56),
    waterQuality: mv(68),
    powerGridReliability: mv(98),
    infrastructureInvestmentGap: mv(34),
  },
  publicSafety: {
    crimeRate: mv(2_400),
    violentCrimeRate: mv(90),
    policePerCapita: mv(3.8),
    incarcerationRate: mv(100),
    recidivismRate: mv(40),
    publicSafetyConfidence: mv(48),
  },
  environment: {
    airQuality: mv(56),
    renewableEnergy: mv(24),
    carbonEmissions: mv(5.5),
    recyclingRate: mv(30),
    climateResilience: mv(50),
    protectedLand: mv(34),
  },
  social: {
    socialMobility: mv(44),
    incomeInequality: mv(52),
    homelessnessRate: mv(3),
    foodInsecurity: mv(10),
    civicParticipation: mv(40),
    socialCohesion: mv(50),
    housingSupplyGrowth: mv(1.5),
  },
  governance: {
    governmentTransparency: mv(42),
    budgetBalance: mv(-4.3),
    debtToGdp: mv(35.5),
    corruptionIndex: mv(58),
    voterTurnout: mv(42),
    publicTrust: mv(34),
    coDeterminationQuality: mv(36),
  },
  population: {
    populationGrowth: mv(-0.6),
    urbanizationRate: mv(73),
    medianAge: mv(45),
    migrationRate: mv(-0.3),
  },
  mediaInformation: {
    mediaPolarization: mv(62),
    disinformationRisk: mv(52),
    pressFreedom: mv(46),
    socialMediaSentiment: mv(0),
    newsTrust: mv(36),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  urbanizationRate: number;
}>;

const OVERRIDES: Record<string, Override> = {
  BG31: {
    unemploymentRate: 7,
    povertyRate: 30,
    costOfLiving: 88,
    lifeExpectancy: 73.5,
    urbanizationRate: 62,
  }, // Vidin/Montana/Vratsa: the poorest, fastest-shrinking NUTS II region
  BG32: {
    unemploymentRate: 5,
    povertyRate: 24,
    costOfLiving: 92,
    lifeExpectancy: 75,
    urbanizationRate: 68,
  }, // Ruse/Veliko Tarnovo Danube belt
  BG33: {
    unemploymentRate: 5,
    povertyRate: 23,
    costOfLiving: 98,
    lifeExpectancy: 75,
    urbanizationRate: 70,
  }, // Varna port and coast, Shumen/Targovishte interior
  BG34: {
    unemploymentRate: 4.5,
    povertyRate: 22,
    costOfLiving: 98,
    lifeExpectancy: 75,
    urbanizationRate: 72,
  }, // Burgas port, Stara Zagora energy complex
  BG41: {
    unemploymentRate: 2.5,
    povertyRate: 14,
    costOfLiving: 118,
    lifeExpectancy: 77,
    urbanizationRate: 86,
  }, // Sofia capital region, services and IT
  BG42: {
    unemploymentRate: 4.5,
    povertyRate: 24,
    costOfLiving: 94,
    lifeExpectancy: 75.5,
    urbanizationRate: 68,
  }, // Plovdiv industry, Kardzhali/Smolyan Rhodopes
};

function buildMetrics(region: (typeof bgRegions2027)[number]): StateMetrics {
  const id = String(region._id);
  const o = OVERRIDES[id] ?? {};
  const gdpPerCapita = ((region.gdp ?? 0) * 1_000_000) / Math.max(1, region.population ?? 1);
  const medianIncome = Math.round((gdpPerCapita * HOUSEHOLD_INCOME_SHARE) / 100) * 100;
  return withUniformMetricSet({
    _id: id,
    countryId: "BG",
    economic: {
      ...BASELINE.economic,
      medianIncome: mv(medianIncome),
      ...(o.unemploymentRate !== undefined && { unemploymentRate: mv(o.unemploymentRate) }),
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
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const bgStateMetrics2027: StateMetrics[] = bgRegions2027.map(buildMetrics);
export default bgStateMetrics2027;
