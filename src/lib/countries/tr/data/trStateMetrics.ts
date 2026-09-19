import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Turkey region initial metrics — ~1979 (pre-coup economic and political crisis).
 * Turkey is 1979-preset-only. Severe stagflation (FX crisis, ~60% inflation),
 * high unemployment, political violence, a sharp West–East development gap, and a
 * developing-economy demographic profile. `medianIncome` is annual household lira.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(12.0),
    medianIncome: mv(120_000), // annual household lira
    gdpGrowth: mv(-0.5), // 1979–80 crisis recession
    povertyRate: mv(32),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(4.5),
    laborParticipation: mv(58),
    matchingFriction: mv(8),
    tradeBalance: mv(-4.0), // FX/balance-of-payments crisis
    productivityGrowth: mv(1.5),
    rdIntensity: mv(0.3),
    exportDependency: mv(8),
    manufacturingCompetitiveness: mv(54),
  },
  education: {
    highSchoolGradRate: mv(30),
    testPerformance: mv(78),
    educationSpending: mv(2_500),
    literacyRate: mv(65),
    workforceSkill: mv(48),
    apprenticeshipRate: mv(3),
  },
  healthcare: {
    uninsuredRate: mv(45),
    affordabilityIndex: mv(48),
    physicianRate: mv(0.6),
    lifeExpectancy: mv(58.0),
    preventableMortality: mv(520),
    publicHealthPreparedness: mv(40),
  },
  infrastructure: {
    roadCondition: mv(48),
    broadbandAccess: mv(0),
    publicTransit: mv(44),
    waterQuality: mv(58),
    powerGridReliability: mv(94.0), // frequent shortages in the crisis
    infrastructureInvestmentGap: mv(48),
  },
  publicSafety: {
    crimeRate: mv(3_800),
    violentCrimeRate: mv(250), // late-1970s left–right street violence
    policePerCapita: mv(3.0),
    incarcerationRate: mv(90),
    recidivismRate: mv(45),
    publicSafetyConfidence: mv(34),
  },
  environment: {
    airQuality: mv(48),
    renewableEnergy: mv(30), // hydro
    carbonEmissions: mv(2),
    recyclingRate: mv(3),
    climateResilience: mv(40),
    protectedLand: mv(3),
  },
  social: {
    socialMobility: mv(40),
    incomeInequality: mv(52), // high
    homelessnessRate: mv(6),
    foodInsecurity: mv(16),
    civicParticipation: mv(54),
    socialCohesion: mv(38), // deep polarisation
    housingSupplyGrowth: mv(3.0), // gecekondu growth
  },
  governance: {
    governmentTransparency: mv(35),
    budgetBalance: mv(-6.0),
    debtToGdp: mv(25),
    corruptionIndex: mv(58),
    voterTurnout: mv(72),
    publicTrust: mv(34), // collapsing coalitions, martial law
    coDeterminationQuality: mv(40),
  },
  population: {
    populationGrowth: mv(2.3), // high developing-country growth
    urbanizationRate: mv(45),
    medianAge: mv(20),
    migrationRate: mv(-0.4), // guest-worker emigration to Germany
  },
  mediaInformation: {
    mediaPolarization: mv(60),
    disinformationRisk: mv(30),
    pressFreedom: mv(40), // martial-law censorship in many provinces
    socialMediaSentiment: mv(0),
    newsTrust: mv(40),
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
  TR_IST: {
    medianIncome: 200_000,
    costOfLiving: 120,
    povertyRate: 20,
    lifeExpectancy: 62,
    literacyRate: 78,
    urbanizationRate: 80,
    violentCrimeRate: 320,
  }, // industrial heart; worst street violence
  TR_ANK: {
    medianIncome: 175_000,
    costOfLiving: 112,
    povertyRate: 22,
    lifeExpectancy: 61,
    literacyRate: 76,
    urbanizationRate: 70,
    violentCrimeRate: 300,
  }, // capital
  TR_IZM: {
    medianIncome: 165_000,
    costOfLiving: 108,
    povertyRate: 22,
    lifeExpectancy: 62,
    literacyRate: 74,
    urbanizationRate: 64,
  },
  TR_MED: {
    medianIncome: 110_000,
    costOfLiving: 96,
    povertyRate: 32,
    lifeExpectancy: 58,
    literacyRate: 64,
    urbanizationRate: 52,
  },
  TR_BLA: {
    medianIncome: 95_000,
    costOfLiving: 92,
    povertyRate: 36,
    lifeExpectancy: 57,
    literacyRate: 62,
    urbanizationRate: 40,
  },
  TR_ESA: {
    medianIncome: 55_000,
    costOfLiving: 84,
    povertyRate: 52,
    lifeExpectancy: 52,
    literacyRate: 45,
    urbanizationRate: 36,
  }, // poorest east
  TR_SEA: {
    medianIncome: 50_000,
    costOfLiving: 82,
    povertyRate: 56,
    lifeExpectancy: 52,
    literacyRate: 42,
    urbanizationRate: 38,
  }, // poorest southeast (Kurdish)
  TR_CEN: {
    medianIncome: 90_000,
    costOfLiving: 90,
    povertyRate: 36,
    lifeExpectancy: 57,
    literacyRate: 62,
    urbanizationRate: 48,
  },
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "TR",
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

export const trStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
