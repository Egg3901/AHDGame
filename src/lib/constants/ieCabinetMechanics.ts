import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

/**
 * Ireland Cabinet position mechanics — per-minister metric panels driven by
 * the dashboards on /country/ie/executive/cabinet/[positionId]. Mirrors the
 * DE_CABINET_MECHANICS shape; the Minister for Finance additionally carries
 * the Exchequer-grants allocation and sovereign-bond maturity profile, the
 * two finance-only mechanics from cabinetMechanicsTypes.
 *
 * Department names use the IRL Irish department titles (Department of X).
 * Metric polarities follow the established convention — percent metrics
 * are usually higher-is-better except for unemployment, crime, poverty,
 * costOfLiving, hseWaitingListMonths, and carbonEmissions.
 */
export const IE_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  // ── 1. Taoiseach ────────────────────────────────────────────────────────────
  taoiseach: {
    positionId: "taoiseach",
    department: "Department of An Taoiseach",
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
        metricId: "governmentApproval",
        label: "Government Approval",
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
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Gov. Transparency",
        format: "index",
        higherIsBetter: true,
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
    ],
  },

  // ── 2. Tánaiste ─────────────────────────────────────────────────────────────
  tanaiste: {
    positionId: "tanaiste",
    department: "Office of the Tánaiste",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "governmentApproval",
        label: "Government Approval",
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

  // ── 3. Minister for Finance ─────────────────────────────────────────────────
  minister_for_finance: {
    positionId: "minister_for_finance",
    department: "Department of Finance",
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
      name: "Exchequer Grants Allocation",
      description:
        "Allocate the Exchequer grants pool across all 8 planning regions. Must sum to 100%.",
      poolLabel: "Exchequer Grants Pool",
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },

  // ── 4. Minister for Public Expenditure, NDP Delivery and Reform ─────────────
  minister_for_public_expenditure: {
    positionId: "minister_for_public_expenditure",
    department: "Department of Public Expenditure, NDP Delivery and Reform",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Gov. Transparency",
        format: "index",
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
    ],
  },

  // ── 5. Minister for Foreign Affairs ─────────────────────────────────────────
  minister_for_foreign_affairs: {
    positionId: "minister_for_foreign_affairs",
    department: "Department of Foreign Affairs",
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

  // ── 6. Minister for Enterprise, Trade and Employment ────────────────────────
  minister_for_enterprise: {
    positionId: "minister_for_enterprise",
    department: "Department of Enterprise, Trade and Employment",
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
        metricId: "smallBusinessFormation",
        label: "Business Formation",
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
    regionalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
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
  },

  // ── 7. Minister for Health ──────────────────────────────────────────────────
  minister_for_health: {
    positionId: "minister_for_health",
    department: "Department of Health",
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
        metricId: "hseWaitingListMonths",
        label: "HSE Waiting List",
        format: "number",
        higherIsBetter: false,
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
        metricId: "hseWaitingListMonths",
        label: "HSE Waiting List",
        format: "number",
        higherIsBetter: false,
      },
    ],
  },

  // ── 8. Minister for Education ───────────────────────────────────────────────
  minister_for_education: {
    positionId: "minister_for_education",
    department: "Department of Education",
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

  // ── 9. Minister for Further and Higher Education, Research, Innovation, Science ─
  minister_for_further_higher_education: {
    positionId: "minister_for_further_higher_education",
    department: "Department of Further and Higher Education, Research, Innovation and Science",
    nationalMetrics: [
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
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
    regionalMetrics: [
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },

  // ── 10. Minister for Housing, Local Government and Heritage ─────────────────
  minister_for_housing: {
    positionId: "minister_for_housing",
    department: "Department of Housing, Local Government and Heritage",
    nationalMetrics: [
      {
        category: "social",
        metricId: "housingCompletionsRate",
        label: "Housing Completions",
        format: "number",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "social",
        metricId: "housingCompletionsRate",
        label: "Housing Completions",
        format: "number",
        higherIsBetter: true,
      },
    ],
  },

  // ── 11. Minister for Social Protection ──────────────────────────────────────
  minister_for_social_protection: {
    positionId: "minister_for_social_protection",
    department: "Department of Social Protection",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
  },

  // ── 12. Minister for Justice ────────────────────────────────────────────────
  minister_for_justice: {
    positionId: "minister_for_justice",
    department: "Department of Justice",
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
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Gov. Transparency",
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

  // ── 13. Minister for Defence ────────────────────────────────────────────────
  minister_for_defence: {
    positionId: "minister_for_defence",
    department: "Department of Defence",
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
      {
        category: "governance",
        metricId: "governmentApproval",
        label: "Government Approval",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
  },

  // ── 14. Minister for the Environment, Climate and Communications ────────────
  minister_for_environment_climate: {
    positionId: "minister_for_environment_climate",
    department: "Department of the Environment, Climate and Communications",
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

  // ── 15. Minister for Agriculture, Food and the Marine ───────────────────────
  minister_for_agriculture: {
    positionId: "minister_for_agriculture",
    department: "Department of Agriculture, Food and the Marine",
    nationalMetrics: [
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
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
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

  // ── 16. Minister for Transport ──────────────────────────────────────────────
  minister_for_transport: {
    positionId: "minister_for_transport",
    department: "Department of Transport",
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
      {
        category: "infrastructure",
        metricId: "roadCondition",
        label: "Road Condition",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },

  // ── 17. Minister for Tourism, Culture, Arts, Gaeltacht, Sport and Media ─────
  minister_for_tourism_culture: {
    positionId: "minister_for_tourism_culture",
    department: "Department of Tourism, Culture, Arts, Gaeltacht, Sport and Media",
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
        category: "governance",
        metricId: "governmentApproval",
        label: "Government Approval",
        format: "index",
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

  // ── 18. Minister for Children, Equality, Disability, Integration and Youth ──
  minister_for_children: {
    positionId: "minister_for_children",
    department: "Department of Children, Equality, Disability, Integration and Youth",
    nationalMetrics: [
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "education",
        metricId: "testPerformance",
        label: "Test Performance",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
    ],
  },

  // ── 19. Minister for Rural and Community Development ────────────────────────
  minister_for_rural_community: {
    positionId: "minister_for_rural_community",
    department: "Department of Rural and Community Development",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "transportEfficiency",
        label: "Transport Efficiency",
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
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "transportEfficiency",
        label: "Transport Efficiency",
        format: "index",
        higherIsBetter: true,
      },
    ],
  },
};
