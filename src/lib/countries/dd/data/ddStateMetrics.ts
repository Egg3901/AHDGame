import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * East Germany region initial metrics — ~1979 (the GDR command economy). DD is
 * 1979-preset-only. Full employment, administered/subsidised prices, low
 * inequality, near-universal literacy, a pervasive security state (very low press
 * freedom), and heavy lignite-driven pollution. `medianIncome` is annual
 * household income in Mark der DDR.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(0.3), // full employment (planned economy)
    medianIncome: mv(14_000), // annual household Mark der DDR
    gdpGrowth: mv(2.5),
    povertyRate: mv(8),
    costOfLiving: mv(100), // administered, heavily subsidised
    smallBusinessFormation: mv(0.5),
    laborParticipation: mv(80), // high female participation
    matchingFriction: mv(1),
    tradeBalance: mv(-1.0),
    productivityGrowth: mv(2.0),
    rdIntensity: mv(2.5),
    exportDependency: mv(24), // Comecon trade
    manufacturingCompetitiveness: mv(62),
  },
  education: {
    highSchoolGradRate: mv(85),
    testPerformance: mv(95),
    educationSpending: mv(6_000),
    literacyRate: mv(99),
    workforceSkill: mv(74),
    apprenticeshipRate: mv(8), // strong vocational system
  },
  healthcare: {
    uninsuredRate: mv(0), // universal state healthcare
    affordabilityIndex: mv(72),
    physicianRate: mv(2.2),
    lifeExpectancy: mv(72.0),
    preventableMortality: mv(340),
    publicHealthPreparedness: mv(62),
  },
  infrastructure: {
    roadCondition: mv(56),
    broadbandAccess: mv(0),
    publicTransit: mv(74), // extensive rail/tram
    waterQuality: mv(62),
    powerGridReliability: mv(98.0),
    infrastructureInvestmentGap: mv(34),
  },
  publicSafety: {
    crimeRate: mv(1_800), // low ordinary crime, heavy policing
    violentCrimeRate: mv(50),
    policePerCapita: mv(6.0), // Stasi + Volkspolizei
    incarcerationRate: mv(160), // includes political imprisonment
    recidivismRate: mv(35),
    publicSafetyConfidence: mv(50),
  },
  environment: {
    airQuality: mv(62), // severe lignite (brown coal) pollution
    renewableEnergy: mv(5),
    carbonEmissions: mv(20), // very high (lignite)
    recyclingRate: mv(20), // SERO collection system
    climateResilience: mv(45),
    protectedLand: mv(5),
  },
  social: {
    socialMobility: mv(55),
    incomeInequality: mv(20), // very low (planned)
    homelessnessRate: mv(1),
    foodInsecurity: mv(4),
    civicParticipation: mv(60), // mandatory mass organisations
    socialCohesion: mv(52),
    housingSupplyGrowth: mv(2.5), // Plattenbau program
  },
  governance: {
    governmentTransparency: mv(12),
    budgetBalance: mv(-2.0),
    debtToGdp: mv(18), // hidden hard-currency debt to the West
    corruptionIndex: mv(35),
    voterTurnout: mv(99), // single-list ritual turnout
    publicTrust: mv(40),
    coDeterminationQuality: mv(45),
  },
  population: {
    populationGrowth: mv(-0.2), // emigration pressure, low birth rate
    urbanizationRate: mv(75),
    medianAge: mv(36),
    migrationRate: mv(-0.3),
  },
  mediaInformation: {
    mediaPolarization: mv(20),
    disinformationRisk: mv(40), // state propaganda
    pressFreedom: mv(8), // Stasi-era censorship
    socialMediaSentiment: mv(0),
    newsTrust: mv(35),
  },
};

type Override = Partial<{
  medianIncome: number;
  gdpGrowth: number;
  airQuality: number;
  urbanizationRate: number;
  lifeExpectancy: number;
}>;

const OVERRIDES: Record<string, Override> = {
  BEO: {
    medianIncome: 16_500,
    gdpGrowth: 3.0,
    airQuality: 50,
    urbanizationRate: 96,
    lifeExpectancy: 73,
  }, // privileged capital
  MV: { medianIncome: 12_400, gdpGrowth: 2.0, airQuality: 50, urbanizationRate: 48 }, // most agrarian north (cleaner)
  BB: { medianIncome: 12_900, gdpGrowth: 2.2, airQuality: 52, urbanizationRate: 56 }, // agrarian north
  ST: { medianIncome: 13_400, gdpGrowth: 2.3, airQuality: 66, urbanizationRate: 64 }, // central chemical belt
  SN: { medianIncome: 14_200, gdpGrowth: 2.6, airQuality: 72, urbanizationRate: 73 }, // industrial south (worst pollution)
  TH: { medianIncome: 13_600, gdpGrowth: 2.4, airQuality: 68, urbanizationRate: 64 }, // industrial south
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "DD",
    economic: {
      ...BASELINE.economic,
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
    },
    education: { ...BASELINE.education },
    healthcare: {
      ...BASELINE.healthcare,
      ...(o.lifeExpectancy !== undefined && { lifeExpectancy: mv(o.lifeExpectancy) }),
    },
    infrastructure: { ...BASELINE.infrastructure },
    publicSafety: { ...BASELINE.publicSafety },
    environment: {
      ...BASELINE.environment,
      ...(o.airQuality !== undefined && { airQuality: mv(o.airQuality) }),
    },
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

export const ddStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
