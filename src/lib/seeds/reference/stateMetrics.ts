import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { getStateLean } from "@/lib/utils/demographics";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";
import { states } from "./states";

// Helper to create a metric value
function mv(value: number, trend?: number): StateMetricValue {
  return { value, trend };
}

// Helper to add slight randomization within bounds
function randomize(base: number, variance: number): number {
  const variation = (Math.random() - 0.5) * 2 * variance;
  return Math.round((base + variation) * 10) / 10;
}

// State tier configurations based on economic and social indicators
interface StateConfig {
  economicTier: 1 | 2 | 3 | 4 | 5; // 1 = struggling, 5 = thriving
  educationTier: 1 | 2 | 3 | 4 | 5;
  healthcareTier: 1 | 2 | 3 | 4 | 5;
  infrastructureTier: 1 | 2 | 3 | 4 | 5;
  urbanization: number; // 0-100
  medianAge: number; // median age of population
  populationGrowth: number; // annual % growth
}

// State configurations based on real-world patterns
const stateConfigs: Record<string, StateConfig> = {
  // Northeast - Generally high education, healthcare, infrastructure
  CT: {
    economicTier: 4,
    educationTier: 5,
    healthcareTier: 5,
    infrastructureTier: 4,
    urbanization: 88,
    medianAge: 41.1,
    populationGrowth: 0.1,
  },
  DE: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 84,
    medianAge: 41.0,
    populationGrowth: 0.9,
  },
  MA: {
    economicTier: 5,
    educationTier: 5,
    healthcareTier: 5,
    infrastructureTier: 4,
    urbanization: 92,
    medianAge: 39.6,
    populationGrowth: 0.5,
  },
  MD: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 87,
    medianAge: 39.0,
    populationGrowth: 0.3,
  },
  ME: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 39,
    medianAge: 45.1,
    populationGrowth: 0.2,
  },
  NH: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 60,
    medianAge: 43.0,
    populationGrowth: 0.6,
  },
  NJ: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 95,
    medianAge: 40.0,
    populationGrowth: 0.2,
  },
  NY: {
    economicTier: 5,
    educationTier: 4,
    healthcareTier: 5,
    infrastructureTier: 5,
    urbanization: 88,
    medianAge: 39.0,
    populationGrowth: -0.2,
  },
  PA: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 79,
    medianAge: 40.9,
    populationGrowth: 0.1,
  },
  RI: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 91,
    medianAge: 40.0,
    populationGrowth: 0.3,
  },
  VT: {
    economicTier: 3,
    educationTier: 5,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 39,
    medianAge: 43.0,
    populationGrowth: 0.1,
  },

  // Southeast - More varied
  AL: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 59,
    medianAge: 39.4,
    populationGrowth: 0.3,
  },
  AR: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 56,
    medianAge: 38.3,
    populationGrowth: 0.3,
  },
  FL: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 92,
    medianAge: 42.4,
    populationGrowth: 1.6,
  },
  GA: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 76,
    medianAge: 37.0,
    populationGrowth: 1.0,
  },
  KY: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 59,
    medianAge: 39.1,
    populationGrowth: 0.3,
  },
  LA: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 73,
    medianAge: 37.2,
    populationGrowth: -0.2,
  },
  MS: {
    economicTier: 1,
    educationTier: 1,
    healthcareTier: 1,
    infrastructureTier: 2,
    urbanization: 50,
    medianAge: 37.7,
    populationGrowth: -0.3,
  },
  NC: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 66,
    medianAge: 39.0,
    populationGrowth: 1.1,
  },
  SC: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 3,
    urbanization: 66,
    medianAge: 39.8,
    populationGrowth: 1.2,
  },
  TN: {
    economicTier: 3,
    educationTier: 2,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 66,
    medianAge: 38.9,
    populationGrowth: 0.9,
  },
  VA: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 76,
    medianAge: 38.4,
    populationGrowth: 0.6,
  },
  WV: {
    economicTier: 1,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 49,
    medianAge: 42.9,
    populationGrowth: -0.5,
  },

  // Midwest
  IA: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 64,
    medianAge: 38.2,
    populationGrowth: 0.3,
  },
  IL: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 88,
    medianAge: 38.6,
    populationGrowth: -0.4,
  },
  IN: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 73,
    medianAge: 37.9,
    populationGrowth: 0.3,
  },
  KS: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 74,
    medianAge: 37.2,
    populationGrowth: 0.1,
  },
  MI: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 75,
    medianAge: 39.8,
    populationGrowth: 0.1,
  },
  MN: {
    economicTier: 4,
    educationTier: 5,
    healthcareTier: 5,
    infrastructureTier: 4,
    urbanization: 74,
    medianAge: 38.1,
    populationGrowth: 0.5,
  },
  MO: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 70,
    medianAge: 38.7,
    populationGrowth: 0.2,
  },
  ND: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 60,
    medianAge: 35.2,
    populationGrowth: 0.8,
  },
  NE: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 74,
    medianAge: 36.6,
    populationGrowth: 0.5,
  },
  OH: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 78,
    medianAge: 39.4,
    populationGrowth: 0.1,
  },
  SD: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 3,
    infrastructureTier: 2,
    urbanization: 57,
    medianAge: 37.1,
    populationGrowth: 0.8,
  },
  WI: {
    economicTier: 3,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 70,
    medianAge: 39.6,
    populationGrowth: 0.3,
  },

  // Southwest
  AZ: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 90,
    medianAge: 37.9,
    populationGrowth: 1.4,
  },
  NM: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 78,
    medianAge: 38.1,
    populationGrowth: 0.4,
  },
  NV: {
    economicTier: 3,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 3,
    urbanization: 94,
    medianAge: 38.2,
    populationGrowth: 1.5,
  },
  OK: {
    economicTier: 2,
    educationTier: 2,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 66,
    medianAge: 36.7,
    populationGrowth: 0.3,
  },
  TX: {
    economicTier: 4,
    educationTier: 3,
    healthcareTier: 2,
    infrastructureTier: 3,
    urbanization: 85,
    medianAge: 35.0,
    populationGrowth: 1.3,
  },
  UT: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 91,
    medianAge: 31.1,
    populationGrowth: 1.5,
  },

  // West
  AK: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 66,
    medianAge: 35.0,
    populationGrowth: -0.1,
  },
  CA: {
    economicTier: 5,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 95,
    medianAge: 37.0,
    populationGrowth: 0.2,
  },
  CO: {
    economicTier: 4,
    educationTier: 5,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 87,
    medianAge: 36.9,
    populationGrowth: 1.2,
  },
  HI: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 5,
    infrastructureTier: 3,
    urbanization: 92,
    medianAge: 39.6,
    populationGrowth: 0.1,
  },
  ID: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 3,
    urbanization: 71,
    medianAge: 36.6,
    populationGrowth: 2.1,
  },
  MT: {
    economicTier: 2,
    educationTier: 3,
    healthcareTier: 3,
    infrastructureTier: 2,
    urbanization: 56,
    medianAge: 40.1,
    populationGrowth: 1.0,
  },
  OR: {
    economicTier: 4,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 3,
    urbanization: 81,
    medianAge: 39.5,
    populationGrowth: 0.8,
  },
  WA: {
    economicTier: 5,
    educationTier: 4,
    healthcareTier: 4,
    infrastructureTier: 4,
    urbanization: 84,
    medianAge: 37.7,
    populationGrowth: 1.0,
  },
  WY: {
    economicTier: 3,
    educationTier: 3,
    healthcareTier: 2,
    infrastructureTier: 2,
    urbanization: 65,
    medianAge: 38.5,
    populationGrowth: 0.3,
  },
};

// Base values for each tier (tier 3 = average)
const tierBases = {
  // Economic
  unemployment: [7.2, 5.8, 4.5, 3.5, 2.8], // Lower is better
  medianIncome: [42000, 52000, 62000, 75000, 92000],
  gdpGrowth: [0.5, 1.5, 2.5, 3.2, 4.0],
  povertyRate: [18, 14, 11, 9, 7], // Lower is better
  costOfLiving: [85, 95, 100, 110, 125], // Higher = more expensive
  smallBusinessFormation: [2.5, 3.5, 4.5, 5.5, 7.0], // per 1k residents

  // Education
  hsGradRate: [78, 84, 88, 91, 94],
  universityEnrollment: [50, 58, 64, 70, 76],
  testPerformance: [85, 92, 100, 108, 116], // index, 100 = national avg
  educationSpending: [9000, 11000, 13500, 16000, 20000],
  literacyRate: [82, 87, 91, 94, 97],
  workforceSkill: [40, 50, 60, 70, 80], // 0-100 index

  // Healthcare — raised tier 4-5 life expectancy so high_life_expectancy (>=82) can trigger
  uninsuredRate: [16, 12, 8, 5, 3], // Lower is better
  affordabilityIndex: [38, 50, 62, 72, 82], // 0-100, higher = more affordable
  physicianRate: [1.8, 2.2, 2.7, 3.1, 3.6],
  lifeExpectancy: [73, 76, 78, 81, 84], // raised so tier 4-5 can trigger >=82 modifier
  preventableMortality: [480, 400, 330, 270, 210], // per 100k, lower is better
  publicHealthPreparedness: [42, 52, 63, 74, 85], // 0-100 index

  // Infrastructure
  roadCondition: [52, 63, 72, 81, 89],
  broadbandAccess: [68, 76, 84, 91, 96],
  waterQuality: [78, 85, 91, 95, 98],
  powerGridReliability: [99.0, 99.4, 99.7, 99.85, 99.95],
  infrastructureGap: [38, 30, 22, 14, 7], // Lower is better

  // Public Safety
  crimeRate: [3500, 3000, 2500, 2000, 1600], // per 100k, lower is better
  violentCrimeRate: [520, 430, 360, 280, 210], // per 100k, lower is better
  recidivismRate: [58, 50, 43, 36, 28], // %, lower is better (percent who reoffend within 3 years)
  publicSafetyConfidence: [42, 53, 63, 72, 81], // 0-100 index

  // Environment
  climateResilience: [38, 50, 60, 70, 80], // 0-100 index

  // Social — raised tier 5 so social_cohesion (>=68) is reachable
  socialCohesion: [38, 48, 57, 66, 76], // 0-100 index

  // Governance — raised tier 5 public trust so high_public_trust (>=68) and good_governance can trigger
  transparency: [48, 56, 64, 72, 81],
  voterTurnout: [50, 55, 61, 67, 76], // raised tier 5 so high_voter_turnout (>=72) triggers more
  publicTrust: [32, 40, 50, 60, 72], // raised tier 5 so high_public_trust (>=68) triggers

  // Media
  mediaPolarization: [65, 55, 46, 38, 29], // Lower is better
  disinformationRisk: [62, 52, 42, 32, 24], // Lower is better
  pressFreedom: [52, 60, 69, 78, 86], // Higher is better
  newsTrust: [33, 42, 50, 58, 66], // Higher is better
};

function generateStateMetrics(
  stateId: string,
  config: StateConfig,
  countryId?: string
): StateMetrics {
  const state = states.find((s) => s._id === stateId)!;
  const politicalLean = getStateLean(state); // -5 to +5, derived from demographics/2020

  // Get tier indices (0-4)
  const econ = config.economicTier - 1;
  const edu = config.educationTier - 1;
  const health = config.healthcareTier - 1;
  const infra = config.infrastructureTier - 1;
  const urban = config.urbanization;

  // Economic metrics
  const costOfLivingBase = tierBases.costOfLiving[econ];
  const urbanCostBonus = (urban - 70) * 0.4; // Higher urbanization = higher cost

  // Environment metrics influenced by political lean
  const renewableBase =
    politicalLean < 0 ? 25 + Math.abs(politicalLean) * 6 : 15 - politicalLean * 2;
  const carbonBase = politicalLean < 0 ? 12 - Math.abs(politicalLean) : 14 + politicalLean;

  // Public safety - varies by urbanization and region
  const crimeRateBase = tierBases.crimeRate[econ] + (urban - 70) * 8;
  const violentCrimeBase = tierBases.violentCrimeRate[econ] + (urban - 70) * 2;

  // Governance - influenced by political lean (both extremes can have issues)
  const transparencyBase = tierBases.transparency[econ] - Math.abs(politicalLean) * 2;
  const voterTurnoutBase = tierBases.voterTurnout[edu] - Math.abs(politicalLean);

  // Media - influenced by urbanization and political lean
  const polarizationBase = tierBases.mediaPolarization[edu] + Math.abs(politicalLean) * 3;
  const disinfoBase = tierBases.disinformationRisk[edu] + Math.abs(politicalLean) * 2;

  // Migration influenced by economic tier and growth
  const migrationBase = config.populationGrowth - 0.3; // Net migration relative to natural growth

  return withUniformMetricSet({
    _id: stateId,
    countryId,

    economic: {
      unemploymentRate: mv(randomize(tierBases.unemployment[econ], 0.5)),
      medianIncome: mv(randomize(tierBases.medianIncome[econ], 3000)),
      gdpGrowth: mv(randomize(tierBases.gdpGrowth[econ], 0.5)),
      povertyRate: mv(randomize(tierBases.povertyRate[econ], 1.5)),
      costOfLiving: mv(randomize(costOfLivingBase + urbanCostBonus, 5)),
      smallBusinessFormation: mv(randomize(tierBases.smallBusinessFormation[econ], 0.8)),
      laborParticipation: mv(63),
      matchingFriction: mv(5),
      tradeBalance: mv(randomize(0, 3)),
      productivityGrowth: mv(randomize(tierBases.gdpGrowth[econ] * 0.6, 0.3)),
      rdIntensity: mv(randomize(1.5 + edu * 0.4, 0.3)),
      exportDependency: mv(randomize(35, 5)),
      manufacturingCompetitiveness: mv(randomize(60 + edu * 5, 6)),
    },

    education: {
      highSchoolGradRate: mv(randomize(tierBases.hsGradRate[edu], 2)),
      universityEnrollment: mv(randomize(tierBases.universityEnrollment[edu], 3)),
      testPerformance: mv(randomize(tierBases.testPerformance[edu], 5)),
      educationSpending: mv(randomize(tierBases.educationSpending[edu], 1000)),
      literacyRate: mv(randomize(tierBases.literacyRate[edu], 1.5)),
      workforceSkill: mv(randomize(tierBases.workforceSkill[edu], 5)),
      apprenticeshipRate: mv(randomize(2.5, 0.6)),
    },

    healthcare: {
      uninsuredRate: mv(randomize(tierBases.uninsuredRate[health], 1.5)),
      affordabilityIndex: mv(randomize(tierBases.affordabilityIndex[health], 5)),
      physicianRate: mv(randomize(tierBases.physicianRate[health], 0.2)),
      lifeExpectancy: mv(randomize(tierBases.lifeExpectancy[health], 0.8)),
      preventableMortality: mv(randomize(tierBases.preventableMortality[health], 30)),
      publicHealthPreparedness: mv(randomize(tierBases.publicHealthPreparedness[health], 5)),
    },

    infrastructure: {
      roadCondition: mv(randomize(tierBases.roadCondition[infra], 5)),
      broadbandAccess: mv(randomize(tierBases.broadbandAccess[infra], 3)),
      publicTransit: mv(randomize(urban * 0.5 + infra * 5, 5)), // Higher urbanization = more transit
      waterQuality: mv(randomize(tierBases.waterQuality[infra], 3)),
      powerGridReliability: mv(randomize(tierBases.powerGridReliability[infra], 0.1)),
      infrastructureInvestmentGap: mv(randomize(tierBases.infrastructureGap[infra], 5)),
    },

    publicSafety: {
      crimeRate: mv(randomize(crimeRateBase, 150)),
      violentCrimeRate: mv(randomize(violentCrimeBase, 30)),
      policePerCapita: mv(randomize(2.2 + urban * 0.01, 0.2)),
      incarcerationRate: mv(randomize(450 - econ * 50 + Math.max(0, politicalLean) * 30, 50)),
      recidivismRate: mv(randomize(tierBases.recidivismRate[econ], 5)),
      publicSafetyConfidence: mv(randomize(tierBases.publicSafetyConfidence[econ], 6)),
    },

    environment: {
      // airQuality: better economy = cleaner air; urbanization adds modest pollution
      // Range ~18–50 so environmental_degradation (>=45) only fires for worst-econ/high-urban states
      airQuality: mv(randomize(48 - econ * 6 + urban * 0.1, 6)),
      renewableEnergy: mv(randomize(renewableBase, 5)),
      carbonEmissions: mv(randomize(carbonBase, 2)),
      recyclingRate: mv(randomize(25 + edu * 6 - Math.max(0, politicalLean) * 2, 5)),
      climateResilience: mv(randomize(tierBases.climateResilience[infra], 8)),
      protectedLand: mv(randomize(12 + (100 - urban) * 0.15 - Math.max(0, politicalLean) * 1.5, 4)),
      energyTransitionProgress: mv(randomize(renewableBase + 10, 8)),
    },

    social: {
      socialMobility: mv(randomize(45 + econ * 8 + edu * 4, 5)),
      // incomeInequality (Gini INDEX, P3a): start at 50 for worst states, improve
      // with economy/education. Range ~32-50, avoiding clustering at the
      // inequality_crisis threshold (42).
      incomeInequality: mv(randomize(50 - econ * 4 - edu * 1, 2)),
      homelessnessRate: mv(
        randomize(10 + (tierBases.costOfLiving[econ] - 100) * 0.15 + urban * 0.06, 3)
      ),
      foodInsecurity: mv(randomize(16 - econ * 2.5, 2)),
      civicParticipation: mv(randomize(38 + edu * 6 + voterTurnoutBase * 0.3, 5)),
      // Reduce urban penalty so high-urbanization tier-5 states can still hit >=68 threshold
      socialCohesion: mv(randomize(tierBases.socialCohesion[edu] - urban * 0.05, 6)),
      housingSupplyGrowth: mv(randomize(0.5 + (5 - econ) * 0.3, 0.8)),
    },

    governance: {
      governmentTransparency: mv(randomize(transparencyBase, 6)),
      budgetBalance: mv(randomize(-2 + econ * 1.5, 3)),
      debtToGdp: mv(randomize(60 + (5 - econ) * 15, 10)),
      corruptionIndex: mv(randomize(35 + Math.abs(politicalLean) * 3 + (5 - econ) * 4, 6)),
      voterTurnout: mv(randomize(voterTurnoutBase, 4)),
      publicTrust: mv(randomize(tierBases.publicTrust[econ] - Math.abs(politicalLean) * 2, 5)),
      coDeterminationQuality: mv(randomize(tierBases.publicTrust[econ] + 5, 6)),
    },

    population: {
      populationGrowth: mv(randomize(config.populationGrowth, 0.2)),
      urbanizationRate: mv(randomize(config.urbanization, 2)),
      medianAge: mv(randomize(config.medianAge, 1)),
      migrationRate: mv(randomize(migrationBase, 0.3)),
    },

    mediaInformation: {
      mediaPolarization: mv(randomize(polarizationBase, 6)),
      disinformationRisk: mv(randomize(disinfoBase, 5)),
      pressFreedom: mv(randomize(tierBases.pressFreedom[econ], 5)),
      socialMediaSentiment: mv(randomize(10 - Math.abs(politicalLean) * 3, 8)), // -100 to +100
      newsTrust: mv(randomize(tierBases.newsTrust[edu], 5)),
    },

    lastUpdated: new Date(),
  });
}

// Generate metrics for all states
export const stateMetrics: StateMetrics[] = states.map((state) => {
  const config = stateConfigs[state._id];
  if (!config) {
    // Default config for any missing states
    return generateStateMetrics(
      state._id,
      {
        economicTier: 3,
        educationTier: 3,
        healthcareTier: 3,
        infrastructureTier: 3,
        urbanization: 70,
        medianAge: 38.5,
        populationGrowth: 0.5,
      },
      state.countryId
    );
  }
  return generateStateMetrics(state._id, config, state.countryId);
});

export default stateMetrics;
