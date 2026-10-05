/**
 * Modern Turkey starts from a dated national proxy and an authored game profile.
 * The 2023-vintage observations apply to every region and are projected to
 * 2019/2027. Complete overlays keep modern metrics and decay targets aligned.
 */
import type { StateMetrics } from "@/lib/db/types";
import type { MetricPresetBundle } from "@/lib/seeds/metricPresets";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";
import { trRegionsModern } from "./trRegionsModern";

// National observations, not measured regional differences:
// Labour Force Statistics 2023 (age 15+):
// https://veriportali.tuik.gov.tr/en/press/53521
// Life Tables 2021-2023: https://veriportali.tuik.gov.tr/en/press/53678
// Income Distribution Statistics 2023 uses income reference year 2022:
// https://veriportali.tuik.gov.tr/en/press/53840
// ABPRS 2023 median age: https://veriportali.tuik.gov.tr/en/press/49684
// Urbanity is 2022 DEGURBA dense-grid share, not administrative-centre share.
// https://veriportali.tuik.gov.tr/en/press/49755
export const TR_MODERN_OBSERVED_METRICS = {
  "economic.unemploymentRate": 9.4,
  "economic.laborParticipation": 53.3,
  "healthcare.lifeExpectancy": 77.3,
  "social.incomeInequality": 42,
  "population.medianAge": 34,
  "population.urbanizationRate": 67.9,
} as const;

// Income release reports MEAN annual household disposable income of TRY181,200.
// TRY134,000 is an authored median proxy (about 74% of that mean), not an
// observed median, regional estimate, or a price-level forecast for 2019/2027.
// Every other root below is an authored modern gameplay anchor. Uniform roots
// use the existing shared model defaults computed from this modern profile.
export const TR_MODERN_MODELED_MEDIAN_INCOME = 134_000;

const mv = (value: number) => ({ value });
const profile: StateMetrics = withUniformMetricSet({
  _id: "TR_MODERN_PROFILE",
  countryId: "TR",
  economic: {
    unemploymentRate: mv(9.4),
    medianIncome: mv(TR_MODERN_MODELED_MEDIAN_INCOME),
    gdpGrowth: mv(4.5),
    povertyRate: mv(20),
    costOfLiving: mv(100),
    smallBusinessFormation: mv(6),
    laborParticipation: mv(53.3),
    matchingFriction: mv(6),
    tradeBalance: mv(-3),
    productivityGrowth: mv(2),
    rdIntensity: mv(1.4),
    exportDependency: mv(30),
    manufacturingCompetitiveness: mv(65),
  },
  education: {
    highSchoolGradRate: mv(65),
    testPerformance: mv(90),
    educationSpending: mv(8_000),
    literacyRate: mv(96),
    workforceSkill: mv(65),
    apprenticeshipRate: mv(4),
  },
  healthcare: {
    uninsuredRate: mv(5),
    affordabilityIndex: mv(65),
    physicianRate: mv(2),
    lifeExpectancy: mv(77.3),
    preventableMortality: mv(220),
    publicHealthPreparedness: mv(60),
  },
  infrastructure: {
    roadCondition: mv(68),
    broadbandAccess: mv(85),
    publicTransit: mv(60),
    waterQuality: mv(75),
    powerGridReliability: mv(99),
    infrastructureInvestmentGap: mv(25),
  },
  publicSafety: {
    crimeRate: mv(3_000),
    violentCrimeRate: mv(120),
    policePerCapita: mv(3),
    incarcerationRate: mv(350),
    recidivismRate: mv(40),
    publicSafetyConfidence: mv(55),
  },
  environment: {
    airQuality: mv(55),
    renewableEnergy: mv(40),
    carbonEmissions: mv(5),
    recyclingRate: mv(25),
    climateResilience: mv(50),
    protectedLand: mv(10),
  },
  social: {
    socialMobility: mv(45),
    incomeInequality: mv(42),
    homelessnessRate: mv(3),
    foodInsecurity: mv(10),
    civicParticipation: mv(65),
    socialCohesion: mv(45),
    housingSupplyGrowth: mv(2),
  },
  governance: {
    governmentTransparency: mv(40),
    budgetBalance: mv(-4),
    debtToGdp: mv(30),
    corruptionIndex: mv(55),
    voterTurnout: mv(85),
    publicTrust: mv(45),
    coDeterminationQuality: mv(40),
  },
  population: {
    populationGrowth: mv(0.5),
    urbanizationRate: mv(67.9),
    medianAge: mv(34),
    migrationRate: mv(0.2),
  },
  mediaInformation: {
    mediaPolarization: mv(65),
    disinformationRisk: mv(60),
    pressFreedom: mv(30),
    socialMediaSentiment: mv(45),
    newsTrust: mv(40),
  },
  // Static profile timestamp; seed writers stamp their own update time.
  lastUpdated: new Date("2023-12-31T00:00:00.000Z"),
});

const values: Record<string, number> = {};
for (const [category, metrics] of Object.entries(profile)) {
  if (!metrics || typeof metrics !== "object" || metrics instanceof Date) continue;
  for (const [key, metric] of Object.entries(metrics)) {
    if (
      typeof metric === "object" &&
      metric !== null &&
      "value" in metric &&
      typeof metric.value === "number" &&
      Number.isFinite(metric.value)
    ) {
      values[`${category}.${key}`] = metric.value;
    }
  }
}

export const trMetricPresetsModern: MetricPresetBundle = Object.fromEntries(
  trRegionsModern.map((region) => [String(region._id), { ...values }])
);
