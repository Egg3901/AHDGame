/**
 * Nigeria Cabinet mechanics — drives each Federal Executive Council position's
 * Office page (national metrics shown, legislative domains). Kept lightweight:
 * every position ships with the national metrics most relevant to its
 * portfolio; richer tier-settings / regional targets can be layered later, as
 * they were for the CN State Council. Shared types live in
 * cabinetMechanicsTypes.ts.
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

export const NG_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  secretary_to_government: {
    positionId: "secretary_to_government",
    department: "Presidency",
    sealImage: "",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Government Transparency",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_finance: {
    positionId: "minister_of_finance",
    department: "Finance, Budget and National Planning",
    sealImage: "",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "budgetBalance",
        label: "Budget Balance",
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
    ],
    regionalMetrics: [],
  },
  minister_of_petroleum_resources: {
    positionId: "minister_of_petroleum_resources",
    department: "Petroleum Resources",
    sealImage: "",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "tradeBalance",
        label: "Trade Balance",
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
    ],
    regionalMetrics: [],
  },
  minister_of_defence: {
    positionId: "minister_of_defence",
    department: "Defence",
    sealImage: "",
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety Confidence",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "publicSafety",
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        format: "number",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_foreign_affairs: {
    positionId: "minister_of_foreign_affairs",
    department: "Foreign Affairs",
    sealImage: "",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "tradeBalance",
        label: "Trade Balance",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_interior: {
    positionId: "minister_of_interior",
    department: "Interior",
    sealImage: "",
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "number",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety Confidence",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_justice: {
    positionId: "minister_of_justice",
    department: "Justice",
    sealImage: "",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "corruptionIndex",
        label: "Corruption Index",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "recidivismRate",
        label: "Recidivism Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_health: {
    positionId: "minister_of_health",
    department: "Health",
    sealImage: "",
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
        metricId: "preventableMortality",
        label: "Preventable Mortality",
        format: "number",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_education: {
    positionId: "minister_of_education",
    department: "Education",
    sealImage: "",
    nationalMetrics: [
      {
        category: "education",
        metricId: "literacyRate",
        label: "Literacy Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "testPerformance",
        label: "Test Performance",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_works_housing: {
    positionId: "minister_of_works_housing",
    department: "Works and Housing",
    sealImage: "",
    nationalMetrics: [
      {
        category: "infrastructure",
        metricId: "roadCondition",
        label: "Road Condition",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "housingAffordability",
        label: "Housing Affordability",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_power: {
    positionId: "minister_of_power",
    department: "Power",
    sealImage: "",
    nationalMetrics: [
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_agriculture: {
    positionId: "minister_of_agriculture",
    department: "Agriculture and Rural Development",
    sealImage: "",
    nationalMetrics: [
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_trade_industry: {
    positionId: "minister_of_trade_industry",
    department: "Industry, Trade and Investment",
    sealImage: "",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "tradeBalance",
        label: "Trade Balance",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_labour: {
    positionId: "minister_of_labour",
    department: "Labour and Employment",
    sealImage: "",
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
        metricId: "laborParticipation",
        label: "Labour Participation",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_information: {
    positionId: "minister_of_information",
    department: "Information and National Orientation",
    sealImage: "",
    nationalMetrics: [
      {
        category: "mediaInformation",
        metricId: "pressFreedom",
        label: "Press Freedom",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  minister_of_environment: {
    positionId: "minister_of_environment",
    department: "Environment",
    sealImage: "",
    nationalMetrics: [
      {
        category: "environment",
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "number",
        higherIsBetter: false,
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },
  director_of_intelligence: {
    positionId: "director_of_intelligence",
    department: "Intelligence Service",
    sealImage: "",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [],
  },
};
