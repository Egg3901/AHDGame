import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Romania region initial metrics — latest available pre-2027 fallback. These
 * are authored gameplay estimates, not observed 2027 values. Bucharest-Ilfov
 * concentrates services and FDI; the west (Timis, Cluj) carries industry and
 * IT; the northeast and the southern plains trail on income and health.
 * `medianIncome` is annual household lei.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(5.8), // INSSE 2024 annual average
    medianIncome: mv(96_000), // annual household lei
    gdpGrowth: mv(0.9), // INSSE 2024 real GDP growth
    povertyRate: mv(22),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5),
    laborParticipation: mv(63),
    matchingFriction: mv(6),
    tradeBalance: mv(-7), // persistent goods deficit
    productivityGrowth: mv(1.5),
    rdIntensity: mv(0.5), // among the EU's lowest R&D intensities
    exportDependency: mv(38), // auto (Dacia/Ford) + grain export engine
    manufacturingCompetitiveness: mv(58),
  },
  education: {
    highSchoolGradRate: mv(78), // baccalaureate pass drags the headline rate
    testPerformance: mv(74),
    educationSpending: mv(1_100),
    literacyRate: mv(99),
    workforceSkill: mv(58),
    apprenticeshipRate: mv(5),
  },
  healthcare: {
    uninsuredRate: mv(11), // contribution-linked coverage gaps
    affordabilityIndex: mv(52),
    physicianRate: mv(3.5),
    lifeExpectancy: mv(76.5),
    preventableMortality: mv(420),
    publicHealthPreparedness: mv(55),
  },
  infrastructure: {
    roadCondition: mv(58), // motorway network still catching up
    broadbandAccess: mv(90),
    publicTransit: mv(58),
    waterQuality: mv(70),
    powerGridReliability: mv(99),
    infrastructureInvestmentGap: mv(32),
  },
  publicSafety: {
    crimeRate: mv(3_100),
    violentCrimeRate: mv(100),
    policePerCapita: mv(3),
    incarcerationRate: mv(110),
    recidivismRate: mv(40),
    publicSafetyConfidence: mv(50),
  },
  environment: {
    airQuality: mv(60),
    renewableEnergy: mv(24), // hydro + Dobruja wind
    carbonEmissions: mv(3.6),
    recyclingRate: mv(30),
    climateResilience: mv(50),
    protectedLand: mv(8), // Carpathian parks and Danube Delta
  },
  social: {
    socialMobility: mv(48),
    incomeInequality: mv(48),
    homelessnessRate: mv(3),
    foodInsecurity: mv(9),
    civicParticipation: mv(46),
    socialCohesion: mv(54),
    housingSupplyGrowth: mv(1.5),
  },
  governance: {
    governmentTransparency: mv(42),
    budgetBalance: mv(-9.3), // 2024 general-government deficit, IMF Art. IV
    debtToGdp: mv(52),
    corruptionIndex: mv(56),
    voterTurnout: mv(52), // authored baseline; 2024 legislative is the political roster anchor
    publicTrust: mv(42),
    coDeterminationQuality: mv(38),
  },
  population: {
    populationGrowth: mv(-0.5), // natural decrease plus emigration
    urbanizationRate: mv(54),
    medianAge: mv(43),
    migrationRate: mv(-0.8),
  },
  mediaInformation: {
    mediaPolarization: mv(60),
    disinformationRisk: mv(44),
    pressFreedom: mv(48),
    socialMediaSentiment: mv(0),
    newsTrust: mv(38),
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
  RO_BUC: {
    medianIncome: 132_000,
    costOfLiving: 120,
    povertyRate: 12,
    lifeExpectancy: 77.5,
    literacyRate: 99,
    urbanizationRate: 92,
    violentCrimeRate: 140,
  }, // Bucharest-Ilfov services and FDI hub
  RO_MUN: {
    medianIncome: 100_000,
    costOfLiving: 102,
    povertyRate: 20,
    lifeExpectancy: 76.5,
    literacyRate: 99,
    urbanizationRate: 58,
  }, // Ploiesti oil basin + commuter belt
  RO_OLT: {
    medianIncome: 84_000,
    costOfLiving: 94,
    povertyRate: 26,
    lifeExpectancy: 76,
    literacyRate: 98,
    urbanizationRate: 46,
  }, // coal-transition Gorj/Valcea counties
  RO_TRA: {
    medianIncome: 104_000,
    costOfLiving: 100,
    povertyRate: 18,
    lifeExpectancy: 77,
    literacyRate: 99,
    urbanizationRate: 60,
  }, // Cluj/Sibiu/Brasov industry and IT
  RO_VST: {
    medianIncome: 102_000,
    costOfLiving: 98,
    povertyRate: 18,
    lifeExpectancy: 77,
    literacyRate: 99,
    urbanizationRate: 62,
  }, // Timisoara/Arad western industry, EU-border wages
  RO_MOL: {
    medianIncome: 78_000,
    costOfLiving: 90,
    povertyRate: 30,
    lifeExpectancy: 75,
    literacyRate: 97,
    urbanizationRate: 44,
  }, // Vaslui/Botosani deprivation belt
  RO_DOB: {
    medianIncome: 92_000,
    costOfLiving: 96,
    povertyRate: 22,
    lifeExpectancy: 76,
    literacyRate: 98,
    urbanizationRate: 68,
  }, // Constanta port + tourism, Cernavoda nuclear
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "RO",
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

export const roStateMetrics2027: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
export default roStateMetrics2027;
