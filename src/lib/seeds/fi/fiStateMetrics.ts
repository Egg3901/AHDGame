import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Finland region initial metrics — ~1979 (late Kekkonen era). A Nordic welfare
 * state built on the forest industries and bilateral Soviet trade: comprehensive
 * schooling (peruskoulu) freshly rolled out, universal health insurance, but a
 * devaluation-cycle economy with higher unemployment than its Nordic peers and
 * emigration to Sweden as the safety valve. `medianIncome` is annual household
 * markka.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(6.0), // post-1975 recession peak just passed
    medianIncome: mv(52_000), // annual household markka
    gdpGrowth: mv(6.5), // sharp 1979 recovery on the devalued markka
    povertyRate: mv(12),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(5.5),
    laborParticipation: mv(66), // high female participation
    matchingFriction: mv(5), // regional mismatch: jobs south, people east/north
    tradeBalance: mv(-1.0), // devaluation + Soviet bilateral trade near balance
    productivityGrowth: mv(3.5),
    rdIntensity: mv(1.0),
    exportDependency: mv(28), // forest products + the Soviet clearing account
    manufacturingCompetitiveness: mv(66),
  },
  education: {
    highSchoolGradRate: mv(74),
    testPerformance: mv(96), // peruskoulu comprehensive reform completing
    educationSpending: mv(5_600),
    literacyRate: mv(100),
    workforceSkill: mv(70),
    apprenticeshipRate: mv(18),
  },
  healthcare: {
    uninsuredRate: mv(0), // universal sickness insurance (1964) + health centres (1972)
    affordabilityIndex: mv(78),
    physicianRate: mv(1.9),
    lifeExpectancy: mv(72.9), // dragged by middle-aged male heart disease
    preventableMortality: mv(300), // North Karelia Project attacking the world's worst CHD
    publicHealthPreparedness: mv(70),
  },
  infrastructure: {
    roadCondition: mv(66),
    broadbandAccess: mv(0),
    publicTransit: mv(62),
    waterQuality: mv(90),
    powerGridReliability: mv(98.8),
    infrastructureInvestmentGap: mv(28),
  },
  publicSafety: {
    crimeRate: mv(3_000),
    violentCrimeRate: mv(110), // Nordic-high homicide (rural knife/alcohol pattern)
    policePerCapita: mv(2.6),
    incarcerationRate: mv(105), // high by Nordic standards, being reformed down
    recidivismRate: mv(44),
    publicSafetyConfidence: mv(70),
  },
  environment: {
    airQuality: mv(70),
    renewableEnergy: mv(32), // hydro + forest-industry wood residues
    carbonEmissions: mv(9),
    recyclingRate: mv(8),
    climateResilience: mv(62),
    protectedLand: mv(6),
  },
  social: {
    socialMobility: mv(62), // peruskoulu + free universities opening the ladder
    incomeInequality: mv(28),
    homelessnessRate: mv(3),
    foodInsecurity: mv(4),
    civicParticipation: mv(58),
    socialCohesion: mv(64),
    housingSupplyGrowth: mv(3.0), // lähiö suburb construction wave
  },
  governance: {
    governmentTransparency: mv(62),
    budgetBalance: mv(-1.5),
    debtToGdp: mv(12), // very low state debt
    corruptionIndex: mv(24),
    voterTurnout: mv(82),
    publicTrust: mv(62), // high institutions-trust, weary of cabinet churn
    coDeterminationQuality: mv(70), // comprehensive incomes-policy settlements
  },
  population: {
    populationGrowth: mv(0.3),
    urbanizationRate: mv(60),
    medianAge: mv(31),
    migrationRate: mv(-0.1), // Sweden emigration slowing, some returning
  },
  mediaInformation: {
    mediaPolarization: mv(42), // party press declining; strong regional dailies
    disinformationRisk: mv(20),
    pressFreedom: mv(70), // free but self-censoring on Soviet topics
    socialMediaSentiment: mv(0),
    newsTrust: mv(64),
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
  FI_UUS: {
    unemploymentRate: 3.5,
    medianIncome: 62_000,
    costOfLiving: 110,
    povertyRate: 8,
    lifeExpectancy: 73.5,
    urbanizationRate: 82,
    violentCrimeRate: 120,
  }, // Helsinki capital region
  FI_SW: {
    unemploymentRate: 5.0,
    medianIncome: 53_000,
    costOfLiving: 100,
    povertyRate: 11,
    lifeExpectancy: 73.5,
    urbanizationRate: 54,
  }, // Turku + shipyards
  FI_HAM: {
    unemploymentRate: 5.5,
    medianIncome: 51_000,
    costOfLiving: 98,
    povertyRate: 12,
    lifeExpectancy: 73,
    urbanizationRate: 52,
  }, // Tampere industry + lake district
  FI_EAS: {
    unemploymentRate: 8.5,
    medianIncome: 43_000,
    costOfLiving: 94,
    povertyRate: 18,
    lifeExpectancy: 71.5,
    urbanizationRate: 36,
  }, // smallholder east; the CHD belt; depopulating
  FI_OST: {
    unemploymentRate: 6.5,
    medianIncome: 47_000,
    costOfLiving: 95,
    povertyRate: 14,
    lifeExpectancy: 73.5,
    urbanizationRate: 38,
  }, // coastal farms + Oulu
  FI_LAP: {
    unemploymentRate: 10.0,
    medianIncome: 42_000,
    costOfLiving: 102,
    povertyRate: 18,
    lifeExpectancy: 72,
    urbanizationRate: 34,
  }, // Arctic periphery; highest unemployment in the country
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "FI",
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

export const fiStateMetrics: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
