/**
 * China ministerial orders configuration.
 * Two orders per cabinet position. Orders are time-limited metric modifiers
 * that cost one ministerial action each.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";

export const CN_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  premier: [
    {
      id: "national_unity_campaign",
      name: "National Unity Campaign",
      description:
        "Launch a nationwide messaging campaign to reinforce confidence in State Council leadership.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
    {
      id: "bureaucratic_efficiency_drive",
      name: "Bureaucratic Efficiency Drive",
      description:
        "Streamline inter-ministry coordination to improve government responsiveness and transparency.",
      duration: 24,
      effects: [{ metric: "governmentTransparency", modifier: 0.03, scope: "national" }],
    },
  ],

  vice_premier: [
    {
      id: "economic_coordination_push",
      name: "Economic Coordination Push",
      description:
        "Coordinate cross-ministry economic planning to boost growth and reduce unemployment.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
        { metric: "unemploymentRate", modifier: -0.02, scope: "national" },
      ],
    },
    {
      id: "anti_corruption_sweep",
      name: "Anti-Corruption Sweep",
      description:
        "Direct central inspectors to pursue graft and restore public confidence in clean governance.",
      duration: 24,
      effects: [
        { metric: "corruptionIndex", modifier: -0.03, scope: "national" },
        { metric: "publicTrust", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  state_councillor: [
    {
      id: "policy_coordination_boost",
      name: "Policy Coordination Boost",
      description:
        "Improve inter-agency policy alignment to strengthen implementation across provinces.",
      duration: 24,
      effects: [{ metric: "governmentTransparency", modifier: 0.02, scope: "national" }],
    },
    {
      id: "provincial_outreach",
      name: "Provincial Outreach Program",
      description:
        "Send senior advisers to provinces to gather feedback and improve regional satisfaction.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.02, scope: "national" }],
    },
  ],

  minister_of_foreign_affairs: [
    {
      id: "trade_delegation",
      name: "Major Trade Delegation",
      description:
        "Lead a high-level trade delegation to secure agreements and improve foreign market access.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.02, scope: "national" }],
    },
    {
      id: "diplomatic_summit",
      name: "Diplomatic Summit Hosting",
      description:
        "Host a major regional summit to elevate China's diplomatic standing and international goodwill.",
      duration: 24,
      effects: [{ metric: "governmentTransparency", modifier: 0.03, scope: "national" }],
    },
  ],

  minister_of_finance: [
    {
      id: "fiscal_stimulus_package",
      name: "Fiscal Stimulus Package",
      description: "Deploy a targeted fiscal package to support demand and employment nationwide.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "employment_subsidy",
      name: "Employment Subsidy Program",
      description:
        "Fund an emergency employment subsidy for small and medium-sized firms to keep workers attached to the labor market.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  minister_of_defense: [
    {
      id: "civil_defense_drill",
      name: "Civil Defense Drill",
      description:
        "Coordinate a large-scale civil-defense and disaster-readiness exercise with the PLA.",
      duration: 24,
      effects: [{ metric: "publicSafetyConfidence", modifier: 0.04, scope: "national" }],
    },
    {
      id: "defense_white_paper",
      name: "Defense White Paper Rollout",
      description:
        "Publish and communicate a major readiness review to improve public confidence in national preparedness.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.03, scope: "national" }],
    },
  ],

  minister_of_education: [
    {
      id: "education_excellence",
      name: "Education Excellence Initiative",
      description:
        "Deploy additional support for classroom quality and teacher development to improve student outcomes.",
      duration: 24,
      effects: [{ metric: "testPerformance", modifier: 0.03, scope: "national" }],
    },
    {
      id: "skills_training",
      name: "National Skills Training Program",
      description:
        "Partner with industry and schools on an intensive upskilling and technical training push.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
  ],

  minister_of_health: [
    {
      id: "rural_health_expansion",
      name: "Rural Health Expansion",
      description:
        "Fund a temporary expansion of rural healthcare capacity and staffing across underserved provinces.",
      duration: 24,
      effects: [
        { metric: "physicianRate", modifier: 0.03, scope: "national" },
        { metric: "publicHealthPreparedness", modifier: 0.03, scope: "national" },
      ],
    },
    {
      id: "public_health_campaign",
      name: "Public Health Campaign",
      description: "Run a nationwide public-health education and preventive-care campaign.",
      duration: 24,
      effects: [
        { metric: "lifeExpectancy", modifier: 0.02, scope: "national" },
        { metric: "mentalHealthAccess", modifier: 0.03, scope: "national" },
      ],
    },
  ],

  pboc_governor: [
    {
      id: "credit_easing",
      name: "Targeted Credit Easing",
      description:
        "Direct banks to expand lending to priority sectors, boosting short-term growth.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
        { metric: "inflationPressure", modifier: 0.25, scope: "national" },
      ],
    },
    {
      id: "financial_stability_program",
      name: "Financial Stability Program",
      description:
        "Tighten macro-prudential rules to cool speculative excess and stabilize the financial system.",
      duration: 24,
      effects: [
        { metric: "inflationPressure", modifier: -0.25, scope: "national" },
        { metric: "gdpGrowth", modifier: -0.01, scope: "national" },
      ],
    },
  ],

  minister_of_public_security: [
    {
      id: "anti_corruption_inspection",
      name: "Anti-Corruption Inspection",
      description: "Dispatch central inspectors to root out graft and restore public confidence.",
      duration: 24,
      effects: [
        { metric: "corruptionIndex", modifier: -0.03, scope: "national" },
        { metric: "publicTrust", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "social_credit_rollout",
      name: "Social Credit Rollout",
      description: "Expand the social credit system to deter offenses and improve public order.",
      duration: 24,
      effects: [
        { metric: "socialCreditCoverage", modifier: 0.04, scope: "national" },
        { metric: "crimeRate", modifier: -0.02, scope: "national" },
      ],
    },
  ],

  minister_of_commerce: [
    {
      id: "belt_and_road_push",
      name: "Belt and Road Investment Push",
      description: "Sign new Belt and Road partnerships to open markets and lift growth.",
      duration: 24,
      effects: [
        { metric: "beltAndRoadEngagement", modifier: 0.04, scope: "national" },
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "foreign_investment_liberalization",
      name: "Foreign Investment Liberalization",
      description: "Ease the foreign-investment negative list to spur new enterprise.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
  ],

  minister_of_human_resources_social_security: [
    {
      id: "social_security_expansion",
      name: "Social Security Expansion",
      description: "Broaden pension and benefit coverage to narrow inequality.",
      duration: 24,
      effects: [
        { metric: "commonProsperityIndex", modifier: 0.04, scope: "national" },
        { metric: "incomeInequality", modifier: -0.02, scope: "national" },
      ],
    },
    {
      id: "emergency_hiring_subsidy",
      name: "Emergency Hiring Subsidy",
      description: "Fund a temporary hiring subsidy for firms to keep workers employed.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  minister_of_ecology_environment: [
    {
      id: "national_carbon_market_push",
      name: "National Carbon Market Push",
      description: "Tighten the national carbon market to cut emissions and spur renewables.",
      duration: 24,
      effects: [
        { metric: "carbonEmissions", modifier: -0.03, scope: "national" },
        { metric: "renewableEnergy", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "river_chief_cleanup",
      name: "River-Chief Cleanup",
      description:
        "Mobilize the river-chief system (河长制) for a nationwide water and resilience drive.",
      duration: 24,
      effects: [
        { metric: "climateResilience", modifier: 0.03, scope: "national" },
        { metric: "airQuality", modifier: -0.02, scope: "national" }, // AQI: lower = cleaner (P3c sign fix)
      ],
    },
  ],

  minister_of_transport: [
    {
      id: "national_rail_expansion",
      name: "National Rail Expansion",
      description: "Accelerate high-speed rail buildout to raise transit quality nationwide.",
      duration: 24,
      effects: [{ metric: "publicTransit", modifier: 0.04, scope: "national" }],
    },
    {
      id: "rural_road_initiative",
      name: "Rural Road Initiative",
      description: "Fund a rural road program to improve roads and rural vitality.",
      duration: 24,
      effects: [
        { metric: "roadCondition", modifier: 0.03, scope: "national" },
        { metric: "ruralRevitalization", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_agriculture_rural_affairs: [
    {
      id: "targeted_poverty_alleviation",
      name: "Targeted Poverty Alleviation",
      description: "Run a targeted poverty-alleviation campaign (精准扶贫) in rural areas.",
      duration: 24,
      effects: [
        { metric: "povertyRate", modifier: -0.03, scope: "national" },
        { metric: "ruralRevitalization", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "high_standard_farmland",
      name: "High-Standard Farmland Drive",
      description: "Upgrade farmland to high-standard plots to secure grain output.",
      duration: 24,
      effects: [{ metric: "foodSecurity", modifier: 0.04, scope: "national" }],
    },
  ],

  minister_of_housing_urban_rural: [
    {
      id: "shantytown_redevelopment",
      name: "Shantytown Redevelopment",
      description: "Fund a shantytown redevelopment push (棚改) to expand housing supply.",
      duration: 24,
      effects: [
        { metric: "homelessnessRate", modifier: -0.03, scope: "national" },
        { metric: "housingSupplyGrowth", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "property_market_stabilization",
      name: "Property Market Stabilization",
      description: "Steady the property market to ease housing-driven cost pressure.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.03, scope: "national" }],
    },
  ],
};
