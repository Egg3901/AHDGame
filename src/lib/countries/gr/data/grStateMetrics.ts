import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Greece region initial metrics — ~1979 (Karamanlis republic, EEC accession
 * signed, second oil shock arriving). Sustained postwar growth has ended but
 * living standards far outstrip Turkey's: low unemployment (with heavy
 * emigration as the safety valve), ~19% inflation, high emigrant remittances,
 * a dominant Athens and an underdeveloped rural interior. `medianIncome` is
 * annual household drachmae.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(3.9),
    medianIncome: mv(350_000), // annual household drachmae
    gdpGrowth: mv(3.3), // slowing after the postwar boom
    povertyRate: mv(22),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(6.5), // shopkeeper economy
    laborParticipation: mv(56),
    matchingFriction: mv(6),
    tradeBalance: mv(-6.0), // chronic deficit bridged by shipping + remittances
    productivityGrowth: mv(2.5),
    rdIntensity: mv(0.2),
    exportDependency: mv(12),
    manufacturingCompetitiveness: mv(58),
  },
  education: {
    highSchoolGradRate: mv(48),
    testPerformance: mv(84),
    educationSpending: mv(4_200),
    literacyRate: mv(88),
    workforceSkill: mv(56),
    apprenticeshipRate: mv(4),
  },
  healthcare: {
    uninsuredRate: mv(22), // IKA coverage gaps pre-ESY (1983)
    affordabilityIndex: mv(56),
    physicianRate: mv(2.2),
    lifeExpectancy: mv(73.5),
    preventableMortality: mv(320),
    publicHealthPreparedness: mv(52),
  },
  infrastructure: {
    roadCondition: mv(56),
    broadbandAccess: mv(0),
    publicTransit: mv(50),
    waterQuality: mv(68),
    powerGridReliability: mv(97.0),
    infrastructureInvestmentGap: mv(40),
  },
  publicSafety: {
    crimeRate: mv(2_200),
    violentCrimeRate: mv(90), // low violent crime; terrorism (17N) nascent
    policePerCapita: mv(3.6),
    incarcerationRate: mv(40),
    recidivismRate: mv(38),
    publicSafetyConfidence: mv(56),
  },
  environment: {
    airQuality: mv(52), // the Athens nefos
    renewableEnergy: mv(12), // hydro
    carbonEmissions: mv(4),
    recyclingRate: mv(4),
    climateResilience: mv(48),
    protectedLand: mv(4),
  },
  social: {
    socialMobility: mv(50),
    incomeInequality: mv(44),
    homelessnessRate: mv(3),
    foodInsecurity: mv(9),
    civicParticipation: mv(66), // intensely politicised post-junta society
    socialCohesion: mv(50),
    housingSupplyGrowth: mv(3.5), // antiparochi apartment boom
  },
  governance: {
    governmentTransparency: mv(42),
    budgetBalance: mv(-3.5),
    debtToGdp: mv(22),
    corruptionIndex: mv(50),
    voterTurnout: mv(81), // compulsory voting
    publicTrust: mv(52),
    coDeterminationQuality: mv(42),
  },
  population: {
    populationGrowth: mv(1.0),
    urbanizationRate: mv(58),
    medianAge: mv(31),
    migrationRate: mv(0.2), // gastarbeiter returnees now outnumber leavers
  },
  mediaInformation: {
    mediaPolarization: mv(56), // fiercely partisan press
    disinformationRisk: mv(24),
    pressFreedom: mv(62),
    socialMediaSentiment: mv(0),
    newsTrust: mv(44),
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
  GR_ATT: {
    medianIncome: 430_000,
    costOfLiving: 114,
    povertyRate: 14,
    lifeExpectancy: 74,
    literacyRate: 93,
    urbanizationRate: 88,
    violentCrimeRate: 120,
  }, // Athens–Piraeus conurbation
  GR_MAC: {
    medianIncome: 330_000,
    costOfLiving: 98,
    povertyRate: 24,
    lifeExpectancy: 73,
    literacyRate: 86,
    urbanizationRate: 52,
  }, // Thessaloniki + rural north
  GR_THE: {
    medianIncome: 290_000,
    costOfLiving: 92,
    povertyRate: 28,
    lifeExpectancy: 73,
    literacyRate: 84,
    urbanizationRate: 44,
  },
  GR_EPC: {
    medianIncome: 260_000,
    costOfLiving: 90,
    povertyRate: 32,
    lifeExpectancy: 73,
    literacyRate: 82,
    urbanizationRate: 38,
  }, // poorest mainland corner (Epirus)
  GR_PEL: {
    medianIncome: 280_000,
    costOfLiving: 90,
    povertyRate: 29,
    lifeExpectancy: 74,
    literacyRate: 84,
    urbanizationRate: 40,
  },
  GR_ISL: {
    medianIncome: 320_000,
    costOfLiving: 96,
    povertyRate: 25,
    lifeExpectancy: 74,
    literacyRate: 85,
    urbanizationRate: 44,
  }, // shipping wealth + tourism against rural depopulation
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "GR",
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

export const grStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
