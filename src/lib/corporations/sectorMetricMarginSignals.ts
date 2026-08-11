/**
 * State-metric margin signal table for sector margins.
 *
 * Extracted from sectorMetricMarginProfiles.ts (pure code motion, no value
 * changes) to keep that module under the architecture-audit size cap.
 * METRIC_MARGIN_SIGNALS is re-exported from sectorMetricMarginProfiles.ts,
 * so existing import paths keep working.
 */
import {
  getBroadbandMarginModifier,
  getCarbonEmissionsMarginModifier,
  getCorruptionMarginModifier,
  getCostOfLivingMarginModifier,
  getCrimeRateMarginModifier,
  getGridReliabilityMarginModifier,
  getRoadConditionMarginModifier,
  getUnemploymentMarginModifier,
  getWorkforceSkillMarginModifier,
} from "@/lib/constants/corporations";
import type { MetricCategoryId } from "@/lib/db/types";
import type { SectorMetricMarginChannel } from "./stateMetricMarginTypes";

export type ChannelWeights = Partial<Record<SectorMetricMarginChannel, number>>;

export interface MetricMarginSignal {
  category: MetricCategoryId;
  metricId: string;
  channels: ChannelWeights;
  rationale: string;
  neutralRationale?: string;
  legacyFormula?: (value: number | null | undefined) => number;
}

export const METRIC_MARGIN_SIGNALS: readonly MetricMarginSignal[] = [
  {
    category: "economic",
    metricId: "unemploymentRate",
    channels: { laborCost: 1 },
    rationale: "Labor-market slack changes wage pressure and hiring costs.",
    legacyFormula: getUnemploymentMarginModifier,
  },
  {
    category: "economic",
    metricId: "medianIncome",
    channels: { consumerDemand: 0.8, laborCost: -0.35 },
    rationale: "Higher household income supports local demand but can raise wage expectations.",
  },
  {
    category: "economic",
    metricId: "gdpGrowth",
    channels: { consumerDemand: 0.75, innovation: 0.25 },
    rationale:
      "Local growth supports demand and expansion confidence without replacing macro debt or inflation logic.",
  },
  {
    category: "economic",
    metricId: "povertyRate",
    channels: { consumerDemand: 0.65, publicSafety: 0.25, laborCost: -0.25 },
    rationale:
      "Lower poverty supports stable demand and safer operations; higher poverty weakens local purchasing power.",
  },
  {
    category: "economic",
    metricId: "costOfLiving",
    channels: { laborCost: 1, housingLandUse: 0.4 },
    rationale: "Local living costs flow into wages, rents, and retention costs.",
    legacyFormula: getCostOfLivingMarginModifier,
  },
  {
    category: "economic",
    metricId: "smallBusinessFormation",
    channels: { consumerDemand: 0.45, innovation: 0.45, regulatoryTrust: 0.25 },
    rationale:
      "A high formation rate signals a healthier supplier, customer, and startup ecosystem.",
  },
  {
    category: "economic",
    metricId: "consumerConfidence",
    channels: { consumerDemand: 0.9, mediaTrust: 0.2 },
    rationale:
      "Consumer confidence drives household spending — high confidence lifts demand and pricing power, low confidence compresses margins.",
  },
  {
    category: "economic",
    metricId: "laborParticipation",
    channels: { laborCost: 0.55, laborQuality: 0.25 },
    rationale: "Broader labor participation expands the hiring pool and reduces staffing friction.",
  },
  {
    category: "economic",
    metricId: "matchingFriction",
    channels: { laborCost: 0.35, laborQuality: 0.55 },
    rationale: "Skills mismatch raises recruiting and training costs.",
  },
  {
    category: "economic",
    metricId: "tradeBalance",
    channels: { consumerDemand: 0.25, physicalLogistics: 0.25, regulatoryTrust: 0.15 },
    rationale: "A healthier trade position supports supply-chain confidence and export demand.",
  },
  {
    category: "economic",
    metricId: "productivityGrowth",
    channels: { laborQuality: 0.45, innovation: 0.45, consumerDemand: 0.2 },
    rationale: "Productivity growth improves throughput and long-run expansion confidence.",
  },
  {
    category: "economic",
    metricId: "rdIntensity",
    channels: { innovation: 0.75, laborQuality: 0.25 },
    rationale: "R&D intensity strengthens local innovation capacity and specialist talent.",
  },
  {
    category: "economic",
    metricId: "propertyValueIndex",
    channels: { consumerDemand: 0.55, housingLandUse: -0.45 },
    rationale: "Property values signal demand strength but can raise land and rent costs.",
  },
  {
    category: "economic",
    metricId: "commercialValueIndex",
    channels: { consumerDemand: 0.6, housingLandUse: -0.35 },
    rationale: "Commercial values signal business demand while increasing occupancy costs.",
  },
  {
    category: "economic",
    metricId: "ruralRevitalization",
    channels: { physicalLogistics: 0.4, demographics: 0.45, consumerDemand: 0.3 },
    rationale:
      "Healthier rural regions improve labor availability, demand, and supply-chain reach.",
  },
  {
    category: "economic",
    metricId: "foodSecurity",
    channels: { physicalLogistics: 0.45, environmentalCompliance: 0.35, consumerDemand: 0.25 },
    rationale: "Food resilience lowers local supply risk and supports stable demand.",
  },
  {
    category: "economic",
    metricId: "exportDependency",
    channels: { consumerDemand: 0.25, physicalLogistics: 0.25, regulatoryTrust: 0.2 },
    rationale: "Lower export dependency reduces exposure to external trade shocks.",
  },
  {
    category: "economic",
    metricId: "manufacturingCompetitiveness",
    channels: { laborQuality: 0.45, physicalLogistics: 0.45, innovation: 0.35 },
    rationale: "Manufacturing competitiveness supports industrial execution and supplier quality.",
  },
  {
    category: "education",
    metricId: "highSchoolGradRate",
    channels: { laborQuality: 0.5, demographics: 0.25 },
    rationale: "Graduation improves baseline workforce quality and social stability.",
  },
  {
    category: "education",
    metricId: "testPerformance",
    channels: { laborQuality: 0.55, innovation: 0.25 },
    rationale: "School performance improves future labor quality and complex operations.",
  },
  {
    category: "education",
    metricId: "educationSpending",
    channels: { laborQuality: 0.45, publicProcurement: 0.2 },
    rationale: "Education investment improves talent pipelines and can support public contracts.",
  },
  {
    category: "education",
    metricId: "literacyRate",
    channels: { laborQuality: 0.55, consumerDemand: 0.2 },
    rationale: "Literacy improves trainability, service quality, and customer reach.",
  },
  {
    category: "education",
    metricId: "workforceSkill",
    channels: { laborQuality: 1 },
    rationale: "Workforce skill directly affects productivity, defect rates, and training costs.",
    legacyFormula: getWorkforceSkillMarginModifier,
  },
  {
    category: "education",
    metricId: "gcseAttainment",
    channels: { laborQuality: 0.55, demographics: 0.2 },
    rationale: "Higher attainment improves regional workforce readiness.",
  },
  {
    category: "education",
    metricId: "universityEnrollment",
    channels: { laborQuality: 0.7, innovation: 0.35 },
    rationale: "University enrollment deepens professional labor and research capacity.",
  },
  {
    category: "education",
    metricId: "apprenticeshipRate",
    channels: { laborQuality: 0.65, physicalLogistics: 0.25 },
    rationale: "Apprenticeships strengthen skilled trades and industrial execution.",
  },
  {
    category: "education",
    metricId: "academicPressure",
    channels: { laborQuality: 0.25, demographics: 0.3 },
    rationale: "Lower academic pressure supports long-run human capital and worker well-being.",
  },
  {
    category: "healthcare",
    metricId: "uninsuredRate",
    channels: { healthCapacity: 0.55, consumerDemand: 0.25, laborCost: 0.2 },
    rationale:
      "Insurance coverage affects workforce health, consumer stability, and healthcare demand.",
  },
  {
    category: "healthcare",
    metricId: "affordabilityIndex",
    channels: { healthCapacity: 0.65, laborCost: 0.2 },
    rationale:
      "Affordable healthcare reduces absenteeism and supports healthcare-sector throughput.",
  },
  {
    category: "healthcare",
    metricId: "physicianRate",
    channels: { healthCapacity: 0.75, laborQuality: 0.2 },
    rationale:
      "Physician availability strengthens local health capacity and specialist labor pools.",
  },
  {
    category: "healthcare",
    metricId: "lifeExpectancy",
    channels: { healthCapacity: 0.55, demographics: 0.35, consumerDemand: 0.2 },
    rationale: "Healthier populations are more productive and support steadier demand.",
  },
  {
    category: "healthcare",
    metricId: "preventableMortality",
    channels: { healthCapacity: 0.65, laborQuality: 0.2 },
    rationale:
      "Lower preventable mortality signals stronger health infrastructure and fewer workforce disruptions.",
  },
  {
    category: "healthcare",
    metricId: "publicHealthPreparedness",
    channels: { healthCapacity: 0.65, regulatoryTrust: 0.25, physicalLogistics: 0.2 },
    rationale: "Prepared health systems reduce disruption risk and improve crisis reliability.",
  },
  {
    category: "healthcare",
    metricId: "nhsWaitingTime",
    channels: { healthCapacity: 0.75, laborCost: 0.15 },
    rationale:
      "Shorter waiting times signal stronger care capacity and fewer workforce health bottlenecks.",
  },
  {
    category: "healthcare",
    metricId: "mentalHealthAccess",
    channels: { healthCapacity: 0.55, laborQuality: 0.25 },
    rationale: "Mental health access supports retention, productivity, and healthcare capacity.",
  },
  {
    category: "healthcare",
    metricId: "socialCareQuality",
    channels: { healthCapacity: 0.6, demographics: 0.35 },
    rationale:
      "Care quality supports older workforces, caregivers, and healthcare-adjacent operations.",
  },
  {
    category: "healthcare",
    metricId: "elderCareQuality",
    channels: { healthCapacity: 0.6, demographics: 0.5 },
    rationale: "Elder-care capacity matters where aging populations shape labor and demand.",
  },
  {
    category: "infrastructure",
    metricId: "roadCondition",
    channels: { physicalLogistics: 1 },
    rationale: "Road quality directly affects shipping, commutes, and on-site operations.",
    legacyFormula: getRoadConditionMarginModifier,
  },
  {
    category: "infrastructure",
    metricId: "broadbandAccess",
    channels: { digitalInfrastructure: 1 },
    rationale:
      "Connectivity supports digital operations, automation, finance, media, and software-heavy work.",
    legacyFormula: getBroadbandMarginModifier,
  },
  {
    category: "infrastructure",
    metricId: "publicTransit",
    channels: { physicalLogistics: 0.45, laborCost: 0.35, consumerDemand: 0.25 },
    rationale: "Transit quality improves labor access, foot traffic, and urban logistics.",
  },
  {
    category: "infrastructure",
    metricId: "waterQuality",
    channels: { environmentalCompliance: 0.45, healthCapacity: 0.35 },
    rationale: "Water quality reduces compliance, health, and input-risk costs.",
  },
  {
    category: "infrastructure",
    metricId: "powerGridReliability",
    channels: { gridReliability: 1 },
    rationale:
      "Reliable electricity is a broad operating prerequisite, with extra weight for energy and digital work.",
    legacyFormula: getGridReliabilityMarginModifier,
  },
  {
    category: "infrastructure",
    metricId: "infrastructureInvestmentGap",
    channels: { physicalLogistics: 0.55, gridReliability: 0.3, publicProcurement: 0.25 },
    rationale: "Lower infrastructure gaps reduce operating friction and project risk.",
  },
  {
    category: "infrastructure",
    metricId: "transportEfficiency",
    channels: { physicalLogistics: 0.75, laborCost: 0.25 },
    rationale: "Efficient transport lowers logistics and commuting costs.",
  },
  {
    category: "publicSafety",
    metricId: "crimeRate",
    channels: { publicSafety: 1 },
    rationale: "Crime increases theft, security expense, vandalism, and lost foot traffic.",
    legacyFormula: getCrimeRateMarginModifier,
  },
  {
    category: "publicSafety",
    metricId: "violentCrimeRate",
    channels: { publicSafety: 0.9, consumerDemand: 0.2 },
    rationale: "Violent crime hurts foot traffic, retention, and location attractiveness.",
  },
  {
    category: "publicSafety",
    metricId: "policePerCapita",
    channels: { publicSafety: 0.55, regulatoryTrust: 0.15 },
    rationale: "Adequate policing can reduce security losses and stabilize public order.",
  },
  {
    category: "publicSafety",
    metricId: "incarcerationRate",
    channels: { publicSafety: 0.25, demographics: 0.35, laborCost: 0.15 },
    rationale:
      "Lower incarceration pressure can improve labor availability and community stability.",
  },
  {
    category: "publicSafety",
    metricId: "recidivismRate",
    channels: { publicSafety: 0.45, demographics: 0.25 },
    rationale: "Lower recidivism signals safer and more stable local conditions.",
  },
  {
    category: "publicSafety",
    metricId: "publicSafetyConfidence",
    channels: { publicSafety: 0.75, consumerDemand: 0.35 },
    rationale: "Safety confidence supports customer activity and lowers security friction.",
  },
  {
    category: "publicSafety",
    metricId: "antiSocialBehaviourRate",
    channels: { publicSafety: 0.6, consumerDemand: 0.25 },
    rationale: "Lower antisocial behavior supports high-street operations and venue traffic.",
  },
  {
    category: "publicSafety",
    metricId: "knifeCrimeRate",
    channels: { publicSafety: 0.8, consumerDemand: 0.2 },
    rationale: "Lower knife crime improves location safety and customer confidence.",
  },
  {
    category: "environment",
    metricId: "airQuality",
    channels: { environmentalCompliance: 0.55, healthCapacity: 0.25 },
    rationale: "Better air quality lowers health and compliance frictions.",
  },
  {
    category: "environment",
    metricId: "renewableEnergy",
    channels: { environmentalCompliance: 0.55, gridReliability: 0.35, innovation: 0.25 },
    rationale: "Renewable energy supports cleaner operations and lowers transition risk.",
  },
  {
    category: "environment",
    metricId: "energyTransitionProgress",
    channels: { environmentalCompliance: 0.5, gridReliability: 0.35, innovation: 0.35 },
    rationale:
      "Energy-transition progress lowers carbon exposure and supports clean-grid investment.",
  },
  {
    category: "environment",
    metricId: "carbonEmissions",
    channels: { environmentalCompliance: 1 },
    rationale: "High emissions imply greater compliance, tax, and reputational pressure.",
    legacyFormula: getCarbonEmissionsMarginModifier,
  },
  {
    category: "environment",
    metricId: "recyclingRate",
    channels: { environmentalCompliance: 0.45, consumerDemand: 0.15 },
    rationale:
      "Waste-diversion capacity reduces compliance pressure and improves circular supply chains.",
  },
  {
    category: "environment",
    metricId: "climateResilience",
    channels: { environmentalCompliance: 0.55, physicalLogistics: 0.35, gridReliability: 0.25 },
    rationale: "Climate resilience reduces outage, supply-chain, and disaster risks.",
  },
  {
    category: "environment",
    metricId: "protectedLand",
    channels: { environmentalCompliance: 0.45, housingLandUse: -0.35, physicalLogistics: -0.2 },
    rationale:
      "Protected land improves ecological compliance but can constrain land-intensive operations.",
  },
  {
    category: "environment",
    metricId: "floodRisk",
    channels: { environmentalCompliance: 0.5, physicalLogistics: 0.4, housingLandUse: 0.35 },
    rationale: "Lower flood risk protects assets, logistics, and property-dependent strategies.",
  },
  {
    category: "environment",
    metricId: "naturalDisasterPreparedness",
    channels: { physicalLogistics: 0.45, gridReliability: 0.35, environmentalCompliance: 0.35 },
    rationale:
      "Disaster readiness lowers continuity risk for physical and utility-heavy operations.",
  },
  {
    category: "environment",
    metricId: "nuclearSafety",
    channels: { gridReliability: 0.35, regulatoryTrust: 0.55, publicSafety: 0.25 },
    rationale:
      "Nuclear safety especially affects nuclear energy confidence and high-reliability grid operations.",
  },
  {
    category: "social",
    metricId: "socialMobility",
    channels: { laborQuality: 0.35, consumerDemand: 0.35, demographics: 0.35 },
    rationale: "Social mobility improves workforce opportunity and long-run demand quality.",
  },
  {
    category: "social",
    metricId: "incomeInequality",
    channels: { consumerDemand: 0.35, publicSafety: 0.2, demographics: 0.25 },
    rationale: "Lower inequality supports broader demand and social stability.",
  },
  {
    category: "social",
    metricId: "homelessnessRate",
    channels: { publicSafety: 0.25, housingLandUse: 0.45, consumerDemand: 0.2 },
    rationale:
      "Lower homelessness reduces visible distress, public-space pressure, and housing friction.",
  },
  {
    category: "social",
    metricId: "foodInsecurity",
    channels: { consumerDemand: 0.3, healthCapacity: 0.25, publicSafety: 0.2 },
    rationale: "Lower food insecurity supports health, stability, and local spending.",
  },
  {
    category: "social",
    metricId: "civicParticipation",
    channels: { regulatoryTrust: 0.35, mediaTrust: 0.25, demographics: 0.2 },
    rationale: "Civic participation signals institutional stability and community trust.",
  },
  {
    category: "social",
    metricId: "socialCohesion",
    channels: { publicSafety: 0.35, mediaTrust: 0.3, demographics: 0.35 },
    rationale: "Social cohesion lowers disorder risk and improves local trust.",
  },
  {
    category: "social",
    metricId: "housingSupplyGrowth",
    channels: { housingLandUse: 0.55, laborCost: 0.3, consumerDemand: 0.2 },
    rationale: "Housing supply growth reduces rent pressure and improves workforce retention.",
  },
  {
    category: "social",
    metricId: "childPoverty",
    channels: { consumerDemand: 0.35, demographics: 0.35, laborQuality: 0.2 },
    rationale: "Lower child poverty improves household stability and future labor quality.",
  },
  {
    category: "social",
    metricId: "housingAffordability",
    channels: { laborCost: 0.35, housingLandUse: 0.55, consumerDemand: 0.2 },
    rationale: "Affordable housing improves retention and keeps location costs manageable.",
  },
  {
    category: "social",
    metricId: "roughSleeping",
    channels: { publicSafety: 0.25, housingLandUse: 0.45, consumerDemand: 0.2 },
    rationale:
      "Lower rough sleeping reduces public-space stress and improves local commerce conditions.",
  },
  {
    category: "social",
    metricId: "workLifeBalance",
    channels: { laborQuality: 0.4, healthCapacity: 0.3, demographics: 0.25 },
    rationale: "Better work-life balance supports retention and sustainable productivity.",
  },
  {
    category: "social",
    metricId: "foreignWorkerIntegration",
    channels: { laborCost: 0.3, laborQuality: 0.3, demographics: 0.35 },
    rationale: "Integration expands usable labor pools and stabilizes diverse communities.",
  },
  {
    category: "social",
    metricId: "genderEquality",
    channels: { laborQuality: 0.35, laborCost: 0.25, demographics: 0.3 },
    rationale: "Gender equality broadens labor participation and improves talent utilization.",
  },
  {
    category: "governance",
    metricId: "governmentTransparency",
    channels: { regulatoryTrust: 0.75, publicProcurement: 0.25 },
    rationale: "Transparency lowers contract uncertainty and compliance risk.",
  },
  {
    category: "governance",
    metricId: "budgetBalance",
    channels: {},
    rationale: "Budget balance is intentionally neutral here.",
    neutralRationale:
      "Fiscal balance remains in the existing national macro systems, so it is not double-counted in sector metric margins.",
  },
  {
    category: "governance",
    metricId: "debtToGdp",
    channels: {},
    rationale: "Debt-to-GDP is intentionally neutral here.",
    neutralRationale:
      "Debt-to-GDP already affects margins through the national macro debt modifier, so it is not double-counted as a state metric effect.",
  },
  {
    category: "governance",
    metricId: "corruptionIndex",
    channels: { regulatoryTrust: 1 },
    rationale: "Corruption raises bribe, enforcement, contract, and permitting risk.",
    legacyFormula: getCorruptionMarginModifier,
  },
  {
    category: "governance",
    metricId: "voterTurnout",
    channels: { regulatoryTrust: 0.25, mediaTrust: 0.2 },
    rationale: "Turnout is a light proxy for institutional legitimacy and civic confidence.",
  },
  {
    category: "governance",
    metricId: "publicTrust",
    channels: { regulatoryTrust: 0.65, mediaTrust: 0.25, publicProcurement: 0.25 },
    rationale: "Public trust stabilizes regulation, permitting, and public-facing investments.",
  },
  {
    category: "governance",
    metricId: "coDeterminationQuality",
    channels: { laborQuality: 0.35, regulatoryTrust: 0.3, demographics: 0.2 },
    rationale: "Co-determination quality improves labor relations and regulatory predictability.",
  },
  {
    category: "governance",
    metricId: "devolutionSatisfaction",
    channels: { regulatoryTrust: 0.45, publicProcurement: 0.25 },
    rationale: "Clear regional governance improves planning and procurement reliability.",
  },
  {
    category: "governance",
    metricId: "roboticsAdoption",
    channels: { innovation: 0.7, laborQuality: 0.3, physicalLogistics: 0.25 },
    rationale:
      "Robotics adoption supports automation, advanced manufacturing, and service efficiency.",
  },
  {
    category: "population",
    metricId: "populationGrowth",
    channels: { consumerDemand: 0.55, laborCost: 0.25, demographics: 0.45 },
    rationale: "Population growth expands markets and labor pools.",
  },
  {
    category: "population",
    metricId: "urbanizationRate",
    channels: { consumerDemand: 0.45, physicalLogistics: 0.25, housingLandUse: 0.35 },
    rationale: "Urbanization helps dense demand and logistics while increasing land-use pressure.",
  },
  {
    category: "population",
    metricId: "medianAge",
    channels: { demographics: 0.55, healthCapacity: 0.25, consumerDemand: 0.2 },
    rationale: "Age structure changes labor availability and sector demand patterns.",
  },
  {
    category: "population",
    metricId: "migrationRate",
    channels: { laborCost: 0.35, laborQuality: 0.25, consumerDemand: 0.25, demographics: 0.35 },
    rationale: "Migration expands labor supply and demand when integration capacity holds.",
  },
  {
    category: "population",
    metricId: "demographicDecline",
    channels: { laborCost: 0.35, consumerDemand: 0.4, demographics: 0.65 },
    rationale: "Lower demographic decline protects labor availability and demand depth.",
  },
  {
    category: "population",
    metricId: "birthRate",
    channels: { demographics: 0.55, consumerDemand: 0.25, laborCost: 0.2 },
    rationale: "Healthier birth rates improve long-run demographics and household demand.",
  },
  {
    category: "mediaInformation",
    metricId: "mediaPolarization",
    channels: { mediaTrust: 0.6, regulatoryTrust: 0.2, consumerDemand: 0.15 },
    rationale: "Lower polarization reduces reputation volatility and public-trust shocks.",
  },
  {
    category: "mediaInformation",
    metricId: "disinformationRisk",
    channels: { mediaTrust: 0.7, regulatoryTrust: 0.2, digitalInfrastructure: 0.2 },
    rationale:
      "Lower disinformation risk helps brand trust, digital adoption, and social stability.",
  },
  {
    category: "mediaInformation",
    metricId: "pressFreedom",
    channels: { mediaTrust: 0.65, regulatoryTrust: 0.25 },
    rationale: "Press freedom supports information quality and reduces arbitrary regulatory risk.",
  },
  {
    category: "mediaInformation",
    metricId: "socialMediaSentiment",
    channels: { mediaTrust: 0.65, consumerDemand: 0.3 },
    rationale: "Positive sentiment improves demand, reputation, and launch conditions.",
  },
  {
    category: "mediaInformation",
    metricId: "newsTrust",
    channels: { mediaTrust: 0.75, regulatoryTrust: 0.2 },
    rationale: "News trust stabilizes the information environment for public-facing sectors.",
  },
  {
    category: "mediaInformation",
    metricId: "bbcTrust",
    channels: { mediaTrust: 0.75, regulatoryTrust: 0.15 },
    rationale: "Public broadcaster trust is a proxy for trusted public-service media conditions.",
  },
] as const;
