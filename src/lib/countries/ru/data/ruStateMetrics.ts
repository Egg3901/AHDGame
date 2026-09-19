import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * USSR region initial metrics — ~1979 Soviet command-economy values, tuned for
 * gameplay. The USSR exists in the 1953 and 1979 presets; the 1953 preset
 * overlays era-authored values on top of this bundle (see
 * `ruMetricPresets1953.ts`) so 1953 worlds don't seed Brezhnev-era numbers.
 *
 * Era anchors (1979 USSR): official "full employment" (~0% unemployment),
 * centrally-set incomes in rubles (compressed), Brezhnev-era stagnation growth
 * (~2.5%), near-universal literacy, life expectancy ~68 (below the West and
 * declining), minimal press freedom, near-universal formal voter turnout,
 * low external debt, hydro-heavy renewables, high per-capita carbon.
 *
 * `medianIncome` is annual household income in rubles. All values use the
 * `{ value, trend? }` wrappers; `withUniformMetricSet` fills any unset metric.
 */

function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(0.5), // official "full employment"
    medianIncome: mv(4_000), // annual household rubles (compressed)
    gdpGrowth: mv(2.5), // Brezhnev-era stagnation
    povertyRate: mv(6),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(0.2), // private enterprise effectively banned
    laborParticipation: mv(87), // very high (women fully in workforce)
    matchingFriction: mv(2),
    tradeBalance: mv(1.0),
    productivityGrowth: mv(1.5),
    rdIntensity: mv(3.5), // large military-industrial R&D
    exportDependency: mv(10),
    manufacturingCompetitiveness: mv(60),
  },
  education: {
    highSchoolGradRate: mv(92),
    testPerformance: mv(95),
    educationSpending: mv(3_500),
    literacyRate: mv(99),
    workforceSkill: mv(70),
    apprenticeshipRate: mv(6),
  },
  healthcare: {
    uninsuredRate: mv(0), // universal state healthcare
    affordabilityIndex: mv(70),
    physicianRate: mv(3.5), // high physician density
    lifeExpectancy: mv(68), // below the West; declining in the late-70s
    preventableMortality: mv(380),
    publicHealthPreparedness: mv(60),
  },
  infrastructure: {
    roadCondition: mv(55),
    broadbandAccess: mv(0),
    publicTransit: mv(80), // strong urban metro/tram systems
    waterQuality: mv(70),
    powerGridReliability: mv(99.0),
    infrastructureInvestmentGap: mv(35),
  },
  publicSafety: {
    crimeRate: mv(1_200), // low reported crime (under-reported)
    violentCrimeRate: mv(90),
    policePerCapita: mv(4.0),
    incarcerationRate: mv(660), // high (Gulag legacy / labor camps)
    recidivismRate: mv(45),
    publicSafetyConfidence: mv(60),
  },
  environment: {
    airQuality: mv(20), // heavy-industry pollution
    renewableEnergy: mv(13), // mostly hydro
    carbonEmissions: mv(14),
    recyclingRate: mv(8),
    climateResilience: mv(45),
    protectedLand: mv(8),
  },
  social: {
    socialMobility: mv(55),
    incomeInequality: mv(28), // compressed wages
    homelessnessRate: mv(2),
    foodInsecurity: mv(8),
    civicParticipation: mv(70),
    socialCohesion: mv(60),
    housingSupplyGrowth: mv(2.0),
  },
  governance: {
    governmentTransparency: mv(20),
    budgetBalance: mv(0.0), // balanced central plan (official)
    debtToGdp: mv(15), // minimal external debt
    corruptionIndex: mv(55),
    voterTurnout: mv(99), // single-list near-universal turnout
    publicTrust: mv(55),
    coDeterminationQuality: mv(50),
  },
  population: {
    populationGrowth: mv(0.8),
    urbanizationRate: mv(62),
    medianAge: mv(30),
    migrationRate: mv(0.0),
  },
  mediaInformation: {
    mediaPolarization: mv(15),
    disinformationRisk: mv(30),
    pressFreedom: mv(10), // state-controlled press
    socialMediaSentiment: mv(0),
    newsTrust: mv(45),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  gdpGrowth: number;
  povertyRate: number;
  costOfLiving: number;
  lifeExpectancy: number;
  crimeRate: number;
  renewableEnergy: number;
  urbanizationRate: number;
  medianAge: number;
  populationGrowth: number;
}>;

const OVERRIDES: Record<string, Override> = {
  CEN: {
    medianIncome: 5_200,
    costOfLiving: 115,
    lifeExpectancy: 70,
    urbanizationRate: 78,
    medianAge: 32,
  }, // Moscow core
  NWR: {
    medianIncome: 5_000,
    costOfLiving: 112,
    lifeExpectancy: 70,
    urbanizationRate: 80,
    medianAge: 32,
  }, // Leningrad
  NOR: { medianIncome: 4_400, costOfLiving: 108, lifeExpectancy: 67, urbanizationRate: 70 },
  CBE: {
    medianIncome: 3_400,
    costOfLiving: 92,
    lifeExpectancy: 68,
    urbanizationRate: 58,
    medianAge: 33,
  },
  VOL: { medianIncome: 3_900, lifeExpectancy: 68, urbanizationRate: 68 },
  NCA: {
    medianIncome: 3_300,
    costOfLiving: 90,
    lifeExpectancy: 70,
    urbanizationRate: 55,
    medianAge: 31,
  },
  URA: { medianIncome: 4_300, lifeExpectancy: 67, urbanizationRate: 74 }, // heavy industry
  WSB: {
    medianIncome: 4_800,
    costOfLiving: 108,
    lifeExpectancy: 67,
    urbanizationRate: 70,
    renewableEnergy: 16,
  }, // oil & gas
  ESB: {
    medianIncome: 4_300,
    costOfLiving: 110,
    lifeExpectancy: 66,
    urbanizationRate: 68,
    renewableEnergy: 35,
  }, // hydropower
  FEA: { medianIncome: 4_400, costOfLiving: 115, lifeExpectancy: 66, urbanizationRate: 74 },
  KAZ: {
    medianIncome: 3_600,
    costOfLiving: 90,
    lifeExpectancy: 67,
    urbanizationRate: 54,
    medianAge: 26,
  },
  TRA: {
    medianIncome: 3_500,
    costOfLiving: 95,
    lifeExpectancy: 72,
    urbanizationRate: 52,
    medianAge: 28,
  }, // Caucasus longevity, grey market
  CAS: {
    medianIncome: 2_800,
    costOfLiving: 85,
    povertyRate: 14,
    lifeExpectancy: 65,
    urbanizationRate: 38,
    medianAge: 22,
    populationGrowth: 2.6,
  }, // poor, rural, young
  MOL: {
    medianIncome: 3_200,
    costOfLiving: 88,
    lifeExpectancy: 68,
    urbanizationRate: 40,
    medianAge: 30,
  },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "RU",
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
    publicSafety: {
      ...BASELINE.publicSafety,
      ...(o.crimeRate !== undefined && { crimeRate: mv(o.crimeRate) }),
    },
    environment: {
      ...BASELINE.environment,
      ...(o.renewableEnergy !== undefined && { renewableEnergy: mv(o.renewableEnergy) }),
    },
    social: { ...BASELINE.social },
    governance: { ...BASELINE.governance },
    population: {
      ...BASELINE.population,
      ...(o.urbanizationRate !== undefined && { urbanizationRate: mv(o.urbanizationRate) }),
      ...(o.medianAge !== undefined && { medianAge: mv(o.medianAge) }),
      ...(o.populationGrowth !== undefined && { populationGrowth: mv(o.populationGrowth) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const ruStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
