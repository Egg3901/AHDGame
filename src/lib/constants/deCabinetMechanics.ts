import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

export const DE_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  finance_minister: {
    positionId: "finance_minister",
    department: "Federal Ministry of Finance",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Income",
        format: "currency",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
    allocation: {
      name: "Federal Grants Allocation",
      description: "Allocate the federal grants pool across all 16 Länder. Must sum to 100%.",
      poolLabel: "Federal Grants Pool",
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },
  foreign_minister: {
    positionId: "foreign_minister",
    department: "Federal Foreign Office",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Gov. Transparency",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  interior_minister: {
    positionId: "interior_minister",
    department: "Federal Ministry of the Interior",
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },
  defense_minister: {
    positionId: "defense_minister",
    department: "Federal Ministry of Defence",
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Safety Confidence",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  justice_minister: {
    positionId: "justice_minister",
    department: "Federal Ministry of Justice",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Gov. Transparency",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "index",
        higherIsBetter: false,
      },
    ],
  },
  labour_minister: {
    positionId: "labour_minister",
    department: "Federal Ministry of Labour and Social Affairs",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Income",
        format: "currency",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
  },
  health_minister: {
    positionId: "health_minister",
    department: "Federal Ministry of Health",
    nationalMetrics: [
      {
        category: "healthcare",
        metricId: "lifeExpectancy",
        label: "Life Expectancy",
        format: "number",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "elderCareQuality",
        label: "Elder Care Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "physicianRate",
        label: "Physician Rate",
        format: "number",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "healthcare",
        metricId: "elderCareQuality",
        label: "Elder Care Quality",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },
  education_minister: {
    positionId: "education_minister",
    department: "Federal Ministry of Education and Research",
    nationalMetrics: [
      {
        category: "education",
        metricId: "testPerformance",
        label: "Test Performance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "education",
        metricId: "testPerformance",
        label: "Test Performance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },
  economy_minister: {
    positionId: "economy_minister",
    department: "Federal Ministry for Economic Affairs and Climate Action",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "percent",
        higherIsBetter: true,
      },
    ],
  },
  transport_minister: {
    positionId: "transport_minister",
    department: "Federal Ministry for Digital and Transport",
    nationalMetrics: [
      {
        category: "infrastructure",
        metricId: "transportEfficiency",
        label: "Transport Efficiency",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "roadCondition",
        label: "Road Condition",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "broadbandAccess",
        label: "Broadband Access",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "infrastructure",
        metricId: "transportEfficiency",
        label: "Transport Efficiency",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },
  environment_minister: {
    positionId: "environment_minister",
    department: "Federal Ministry for the Environment",
    nationalMetrics: [
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "number",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy",
        format: "percent",
        higherIsBetter: true,
      },
    ],
  },
};
