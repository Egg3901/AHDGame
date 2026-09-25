import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Russian Federation region initial metrics — latest available pre-2027
 * fallback. These are authored gameplay estimates, not observed 2027
 * values. National gameplay anchors: Rosstat 2024 real GDP growth 4.3%,
 * 2024 average unemployment about 2.5%, and a shrinking population
 * (natural decrease only partly offset by migration). Moscow concentrates
 * services, finance and FDI; the Urals and West Siberia carry oil, gas and
 * heavy industry; the North Caucasus is younger and poorer; the Far East
 * and European North carry remoteness costs.
 * https://wabx.net/2025/04/11/russia-raises-2024-gdp-growth-figure-to-4-3/
 * `medianIncome` is annual household rubles, a rounded gameplay estimate.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(2.5), // Rosstat 2024 average
    medianIncome: mv(1_200_000), // annual household rubles, rounded estimate
    gdpGrowth: mv(4.3), // Rosstat 2024 revised real growth
    povertyRate: mv(9),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(4),
    laborParticipation: mv(63),
    matchingFriction: mv(6),
    tradeBalance: mv(8), // hydrocarbon surplus under sanctions rerouting
    productivityGrowth: mv(1.5),
    rdIntensity: mv(1.0),
    exportDependency: mv(28), // oil and gas export engine
    manufacturingCompetitiveness: mv(52),
  },
  education: {
    highSchoolGradRate: mv(90),
    testPerformance: mv(82),
    educationSpending: mv(65_000),
    literacyRate: mv(99),
    workforceSkill: mv(64),
    apprenticeshipRate: mv(6),
  },
  healthcare: {
    uninsuredRate: mv(4), // mandatory insurance with access gaps
    affordabilityIndex: mv(55),
    physicianRate: mv(4.0),
    lifeExpectancy: mv(73), // rounded estimate near the 2024 level
    preventableMortality: mv(420),
    publicHealthPreparedness: mv(55),
  },
  infrastructure: {
    roadCondition: mv(58),
    broadbandAccess: mv(88),
    publicTransit: mv(68), // strong metro systems in the capitals
    waterQuality: mv(68),
    powerGridReliability: mv(99),
    infrastructureInvestmentGap: mv(30),
  },
  publicSafety: {
    crimeRate: mv(1_800),
    violentCrimeRate: mv(120),
    policePerCapita: mv(4.5),
    incarcerationRate: mv(300),
    recidivismRate: mv(45),
    publicSafetyConfidence: mv(52),
  },
  environment: {
    airQuality: mv(45), // industrial-city pollution
    renewableEnergy: mv(17), // mostly hydro
    carbonEmissions: mv(11),
    recyclingRate: mv(12),
    climateResilience: mv(48),
    protectedLand: mv(10), // Siberian zapovednik system
  },
  social: {
    socialMobility: mv(48),
    incomeInequality: mv(48),
    homelessnessRate: mv(3),
    foodInsecurity: mv(7),
    civicParticipation: mv(42),
    socialCohesion: mv(56),
    housingSupplyGrowth: mv(2.0),
  },
  governance: {
    governmentTransparency: mv(28),
    budgetBalance: mv(-1.5),
    debtToGdp: mv(18), // low sovereign debt
    corruptionIndex: mv(62),
    voterTurnout: mv(68), // authored baseline; 2021 Duma is the political roster anchor
    publicTrust: mv(46),
    coDeterminationQuality: mv(34),
  },
  population: {
    populationGrowth: mv(-0.4), // natural decrease, partly offset by migration
    urbanizationRate: mv(74),
    medianAge: mv(40),
    migrationRate: mv(0.6),
  },
  mediaInformation: {
    mediaPolarization: mv(62),
    disinformationRisk: mv(48),
    pressFreedom: mv(30), // state-dominated broadcast landscape
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
  medianAge: number;
  populationGrowth: number;
}>;

const OVERRIDES: Record<string, Override> = {
  CEN: {
    medianIncome: 1_700_000,
    costOfLiving: 125,
    povertyRate: 6,
    lifeExpectancy: 74,
    literacyRate: 99,
    urbanizationRate: 88,
    violentCrimeRate: 150,
  }, // Moscow services, finance and FDI hub
  NWR: {
    medianIncome: 1_400_000,
    costOfLiving: 115,
    povertyRate: 7,
    lifeExpectancy: 74,
    literacyRate: 99,
    urbanizationRate: 86,
  }, // St Petersburg port and industry
  NOR: {
    medianIncome: 1_300_000,
    costOfLiving: 118,
    povertyRate: 10,
    lifeExpectancy: 71,
    literacyRate: 99,
    urbanizationRate: 76,
  }, // Arctic extraction, remoteness costs
  CBE: {
    medianIncome: 1_000_000,
    costOfLiving: 92,
    povertyRate: 10,
    lifeExpectancy: 73,
    literacyRate: 99,
    urbanizationRate: 62,
  }, // black-earth agriculture and steel
  VOL: {
    medianIncome: 1_050_000,
    costOfLiving: 94,
    povertyRate: 10,
    lifeExpectancy: 72,
    literacyRate: 99,
    urbanizationRate: 72,
  }, // Volga auto, chemical and Tatar oil industry
  NCA: {
    medianIncome: 850_000,
    costOfLiving: 90,
    povertyRate: 14,
    lifeExpectancy: 74, // Caucasus longevity belt
    literacyRate: 98,
    urbanizationRate: 55,
    medianAge: 34,
    populationGrowth: 0.3,
  }, // younger, rural, tourism and agriculture
  URA: {
    medianIncome: 1_250_000,
    costOfLiving: 100,
    povertyRate: 8,
    lifeExpectancy: 72,
    literacyRate: 99,
    urbanizationRate: 78,
  }, // Urals heavy industry and metals
  WSB: {
    medianIncome: 1_450_000,
    costOfLiving: 108,
    povertyRate: 8,
    lifeExpectancy: 72,
    literacyRate: 99,
    urbanizationRate: 74,
  }, // oil and gas basin wages
  ESB: {
    medianIncome: 1_200_000,
    costOfLiving: 110,
    povertyRate: 11,
    lifeExpectancy: 70,
    literacyRate: 99,
    urbanizationRate: 72,
  }, // hydropower and mining, harsh climate
  FEA: {
    medianIncome: 1_350_000,
    costOfLiving: 122,
    povertyRate: 11,
    lifeExpectancy: 70,
    literacyRate: 99,
    urbanizationRate: 78,
  }, // northern wage coefficients, Pacific ports and fisheries
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
      ...(o.medianAge !== undefined && { medianAge: mv(o.medianAge) }),
      ...(o.populationGrowth !== undefined && { populationGrowth: mv(o.populationGrowth) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const ruStateMetrics2027: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
export default ruStateMetrics2027;
