/**
 * Japan Cabinet mechanics configuration.
 * Drives the per-position Office page: national/regional metrics, tier settings,
 * regional target mechanics, allocation panels, and emergencies.
 *
 * Shared types live in cabinetMechanicsTypes.ts.
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

export const JP_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  chief_cabinet_secretary: {
    positionId: "chief_cabinet_secretary",
    department: "Cabinet Secretariat",
    sealImage: "",
    legislativeDomains: ["governance", "mediaInformation"],
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
      {
        category: "mediaInformation",
        metricId: "pressFreedom",
        label: "Press Freedom",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "percent",
        higherIsBetter: true,
      },
    ],
  },

  finance_minister: {
    positionId: "finance_minister",
    department: "Ministry of Finance",
    sealImage: "",
    legislativeDomains: ["tax", "economic"],
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
    tierSetting: {
      name: "Fiscal Stance",
      description:
        "Set the cabinet's fiscal stance. Stimulus boosts growth and hiring but adds cost pressure; consolidation cools inflation pressure at the expense of growth.",
      defaultTier: "balanced",
      options: [
        {
          id: "consolidation",
          label: "Consolidation",
          description:
            "Prioritize fiscal restraint. Eases cost pressure but slows growth and hiring momentum.",
          effects: { costOfLiving: -0.02, gdpGrowth: -0.015, unemploymentRate: 0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a neutral fiscal stance.",
          effects: {},
        },
        {
          id: "stimulus",
          label: "Stimulus",
          description:
            "Accelerate spending and support demand. Growth and jobs improve faster, but prices run a bit hotter.",
          effects: { gdpGrowth: 0.02, unemploymentRate: -0.015, costOfLiving: 0.015 },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Industrial Relief",
      description:
        "Direct fiscal support to one region facing weaker growth. The target region gets faster growth and labor-market support.",
      effects: { gdpGrowth: 0.04, unemploymentRate: -0.03 },
    },
    emergency: {
      name: "Emergency Stabilization Package",
      description:
        "Deploy a temporary stabilization package for a region under acute economic stress, sharply lifting growth and employment for one turn window.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.08, unemploymentRate: -0.06 },
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },

  foreign_affairs_minister: {
    positionId: "foreign_affairs_minister",
    department: "Ministry of Foreign Affairs",
    sealImage: "",
    legislativeDomains: ["foreign_policy"],
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
        label: "Government Transparency",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
    comingSoon: true,
  },

  justice_minister: {
    positionId: "justice_minister",
    department: "Ministry of Justice",
    sealImage: "",
    legislativeDomains: ["law_justice", "publicSafety", "immigration"],
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "corruptionIndex",
        label: "Corruption Index",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "corruptionIndex",
        label: "Corruption Index",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Sentencing Guidance",
      description:
        "Set the national sentencing stance. Stricter sentencing deters crime more quickly but raises justice-system intensity; leniency reduces that pressure at the cost of weaker deterrence.",
      defaultTier: "standard",
      options: [
        {
          id: "lenient",
          label: "Lenient",
          description: "Reduce sentencing severity and emphasize rehabilitation.",
          effects: { crimeRate: 0.02, publicTrust: -0.01 },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Maintain current sentencing guidance.",
          effects: {},
        },
        {
          id: "strict",
          label: "Strict",
          description: "Tighten sentencing guidance to deter crime more aggressively.",
          effects: { crimeRate: -0.02, publicTrust: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Anti-Corruption Taskforce",
      description:
        "Concentrate justice ministry investigators in one region to root out corruption and organized crime.",
      effects: { corruptionIndex: -0.05, crimeRate: -0.03 },
    },
    emergency: {
      name: "Emergency Prosecutorial Surge",
      description:
        "Deploy prosecutors and court support into a high-crime region for a temporary enforcement surge.",
      cost: 1,
      duration: 24,
      effects: { crimeRate: -0.1, corruptionIndex: -0.05 },
      regionMetricThreshold: { metric: "publicSafety.crimeRate", above: 5500 }, // per-100k (P3b: 60 was the pre-S1 clamped scale — always true on real values)
    },
  },

  defense_minister: {
    positionId: "defense_minister",
    department: "Ministry of Defense",
    sealImage: "",
    legislativeDomains: ["defense"],
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
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "naturalDisasterPreparedness",
        label: "Disaster Preparedness",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Safety Confidence",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "naturalDisasterPreparedness",
        label: "Disaster Preparedness",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Civil Defense Readiness",
      description:
        "Choose the national defense readiness level. Higher readiness improves confidence and disaster coordination but raises public tension slightly.",
      defaultTier: "standard",
      options: [
        {
          id: "reduced",
          label: "Reduced",
          description: "Lower readiness across the force, reducing upkeep.",
          effects: {},
        },
        {
          id: "standard",
          label: "Standard",
          description: "Maintain normal readiness.",
          effects: {},
        },
        {
          id: "elevated",
          label: "Elevated",
          description:
            "Raise readiness across the force to strengthen resilience, at higher upkeep.",
          effects: {},
        },
      ],
    },
    regionalTarget: {
      name: "Regional Readiness Focus",
      description:
        "Concentrate training and civil-defense logistics in one region to improve preparedness and public confidence.",
      effects: { publicSafetyConfidence: 0.04, naturalDisasterPreparedness: 0.05 },
    },
  },

  economy_minister: {
    positionId: "economy_minister",
    department: "Ministry of Economy, Trade and Industry",
    sealImage: "",
    legislativeDomains: ["economic", "technology"],
    nationalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "rate",
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
        metricId: "roboticsAdoption",
        label: "Robotics Adoption",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "rate",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "roboticsAdoption",
        label: "Robotics Adoption",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Industrial Strategy",
      description:
        "Choose whether METI prioritizes incumbents, balanced modernization, or startup-led disruption.",
      defaultTier: "balanced",
      options: [
        {
          id: "incumbent_support",
          label: "Incumbent Support",
          description: "Back large exporters and industrial champions.",
          effects: { gdpGrowth: 0.015, smallBusinessFormation: -0.015 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a mixed industrial strategy.",
          effects: {},
        },
        {
          id: "startup_push",
          label: "Startup Push",
          description: "Favor entrepreneurship and commercialization.",
          effects: { smallBusinessFormation: 0.03, roboticsAdoption: 0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Industrial Cluster Priority",
      description: "Designate one region as an innovation and advanced manufacturing cluster.",
      effects: { gdpGrowth: 0.04, smallBusinessFormation: 0.05, roboticsAdoption: 0.04 },
    },
    emergency: {
      name: "SME Liquidity Facility",
      description: "Deploy emergency financing to a region's small businesses during a downturn.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.06, smallBusinessFormation: 0.08 },
    },
  },

  health_minister: {
    positionId: "health_minister",
    department: "Ministry of Health, Labour and Welfare",
    sealImage: "",
    legislativeDomains: ["healthcare", "social"],
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
        category: "social",
        metricId: "workLifeBalance",
        label: "Work-Life Balance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "physicianRate",
        label: "Physician Access",
        format: "rate",
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
      {
        category: "social",
        metricId: "workLifeBalance",
        label: "Work-Life Balance",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Care Delivery Focus",
      description:
        "Set whether the ministry emphasizes hospital throughput, elder care, or labor reform balance.",
      defaultTier: "balanced",
      options: [
        {
          id: "hospital_focus",
          label: "Hospital Focus",
          description:
            "Improve treatment capacity and physician availability, but labor conditions improve more slowly.",
          effects: { physicianRate: 0.02, workLifeBalance: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced health and welfare strategy.",
          effects: {},
        },
        {
          id: "care_and_labor",
          label: "Care and Labor",
          description:
            "Expand elder care and labor protections, improving family resilience and workplace balance.",
          effects: { elderCareQuality: 0.03, workLifeBalance: 0.03 },
        },
      ],
    },
    regionalTarget: {
      name: "Rural Clinic Support",
      description: "Direct physicians, clinics, and care support into one underserved region.",
      effects: { physicianRate: 0.05, elderCareQuality: 0.05 },
    },
    emergency: {
      name: "Emergency Care Surge",
      description: "Launch a rapid health workforce deployment to a strained region.",
      cost: 1,
      duration: 24,
      effects: { elderCareQuality: 0.08, physicianRate: 0.08 },
    },
  },

  education_minister: {
    positionId: "education_minister",
    department: "Ministry of Education, Culture, Sports, Science and Technology",
    sealImage: "",
    legislativeDomains: ["education"],
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
        metricId: "educationSpending",
        label: "Education Spending",
        format: "currency",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "academicPressure",
        label: "Academic Pressure",
        format: "index",
        higherIsBetter: false,
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
      {
        category: "education",
        metricId: "academicPressure",
        label: "Academic Pressure",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Curriculum Focus",
      description:
        "Choose whether to emphasize exam performance, balanced learning, or creativity and student wellbeing.",
      defaultTier: "balanced",
      options: [
        {
          id: "exam_focus",
          label: "Exam Focus",
          description: "Push exam preparation harder for stronger test outcomes.",
          effects: { testPerformance: 0.03, academicPressure: 0.03 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain the current balance between rigor and wellbeing.",
          effects: {},
        },
        {
          id: "wellbeing_focus",
          label: "Wellbeing Focus",
          description:
            "Reduce pressure and widen broader skills development, with more gradual exam gains.",
          effects: { academicPressure: -0.03, workforceSkill: 0.02, testPerformance: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "School Modernization Priority",
      description: "Target one region for school modernization and teacher support.",
      effects: { testPerformance: 0.05, workforceSkill: 0.05 },
    },
    emergency: {
      name: "Teacher Retention Surge",
      description:
        "Deploy emergency staffing support and retention grants to one region's school system.",
      cost: 1,
      duration: 24,
      effects: { testPerformance: 0.08, academicPressure: -0.04 },
    },
  },

  land_minister: {
    positionId: "land_minister",
    department: "Ministry of Land, Infrastructure, Transport and Tourism",
    sealImage: "",
    legislativeDomains: ["infrastructure"],
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
        metricId: "publicTransit",
        label: "Public Transit",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "naturalDisasterPreparedness",
        label: "Disaster Preparedness",
        format: "index",
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
        metricId: "publicTransit",
        label: "Public Transit",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "naturalDisasterPreparedness",
        label: "Disaster Preparedness",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Infrastructure Priority",
      description: "Choose whether MLIT prioritizes mobility, resilience, or a balanced rollout.",
      defaultTier: "balanced",
      options: [
        {
          id: "mobility",
          label: "Mobility",
          description: "Push rail, roads, and logistics throughput first.",
          effects: {
            transportEfficiency: 0.03,
            publicTransit: 0.03,
            naturalDisasterPreparedness: -0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced infrastructure program.",
          effects: {},
        },
        {
          id: "resilience",
          label: "Resilience",
          description: "Prioritize flood, quake, and evacuation resilience projects.",
          effects: { naturalDisasterPreparedness: 0.04, roadCondition: 0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Infrastructure Investment Priority",
      description: "Concentrate major transport and resilience investment into one region.",
      effects: {
        transportEfficiency: 0.05,
        publicTransit: 0.05,
        naturalDisasterPreparedness: 0.05,
      },
    },
    emergency: {
      name: "Emergency Infrastructure Mobilization",
      description: "Deploy urgent repair and logistics crews to one region after a disruption.",
      cost: 1,
      duration: 24,
      effects: { roadCondition: 0.1, naturalDisasterPreparedness: 0.08 },
    },
  },

  environment_minister: {
    positionId: "environment_minister",
    department: "Ministry of the Environment",
    sealImage: "",
    legislativeDomains: ["environment"],
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
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "environment",
        metricId: "nuclearSafety",
        label: "Nuclear Safety",
        format: "index",
        higherIsBetter: true,
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
      {
        category: "environment",
        metricId: "nuclearSafety",
        label: "Nuclear Safety",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Energy Transition Stance",
      description:
        "Choose whether the ministry leans harder into renewables, a balanced transition, or reliability-first regulation.",
      defaultTier: "balanced",
      options: [
        {
          id: "reliability_first",
          label: "Reliability First",
          description:
            "Focus on system stability and tighter nuclear oversight before accelerating green rollout.",
          effects: { nuclearSafety: 0.03, renewableEnergy: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced transition path.",
          effects: {},
        },
        {
          id: "green_push",
          label: "Green Push",
          description: "Accelerate clean-energy deployment and emissions reduction.",
          effects: { renewableEnergy: 0.03, carbonEmissions: -0.03, nuclearSafety: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Clean Industry Zone",
      description:
        "Designate one region for concentrated decarbonization and environmental remediation.",
      effects: { renewableEnergy: 0.05, airQuality: -0.04, carbonEmissions: -0.05 }, // AQI: lower = cleaner (P3c sign fix)
    },
    emergency: {
      name: "Air Quality Intervention",
      description:
        "Deploy emergency emissions restrictions and monitoring in one region with severe air-quality problems.",
      cost: 1,
      duration: 24,
      effects: { airQuality: -0.08, carbonEmissions: -0.08 }, // AQI: lower = cleaner (P3c sign fix)
    },
  },

  internal_affairs_minister: {
    positionId: "internal_affairs_minister",
    department: "Ministry of Internal Affairs and Communications",
    sealImage: "",
    legislativeDomains: ["governance"],
    nationalMetrics: [
      {
        category: "infrastructure",
        metricId: "broadbandAccess",
        label: "Broadband Access",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "population",
        metricId: "demographicDecline",
        label: "Demographic Decline",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "voterTurnout",
        label: "Voter Turnout",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "ruralRevitalization",
        label: "Rural Revitalization",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "infrastructure",
        metricId: "broadbandAccess",
        label: "Broadband Access",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "population",
        metricId: "demographicDecline",
        label: "Demographic Decline",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "ruralRevitalization",
        label: "Rural Revitalization",
        format: "index",
        higherIsBetter: true,
      },
    ],
    allocation: {
      name: "Regional Funding Allocation",
      description:
        "Allocate the national transfer pool across all eight Japanese regions. The total allocation must sum to 100%.",
      poolLabel: "National Transfers Pool",
    },
    tierSetting: {
      name: "Local Governance Focus",
      description:
        "Choose whether the ministry emphasizes digital services, turnout and civic administration, or regional population stabilization.",
      defaultTier: "balanced",
      options: [
        {
          id: "digital_first",
          label: "Digital First",
          description: "Prioritize digital services and municipal connectivity.",
          effects: { broadbandAccess: 0.03, voterTurnout: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced local-governance strategy.",
          effects: {},
        },
        {
          id: "regional_revitalization",
          label: "Regional Revitalization",
          description: "Prioritize shrinking-region support and local civic participation.",
          effects: {
            demographicDecline: -0.03,
            ruralRevitalization: 0.03,
            voterTurnout: 0.02,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Revitalization Priority",
      description:
        "Concentrate local-government support, communications funding, and revitalization effort in one region.",
      effects: { broadbandAccess: 0.05, demographicDecline: -0.05, ruralRevitalization: 0.06 },
    },
    emergency: {
      name: "Municipal Resilience Support",
      description:
        "Deploy an emergency package of communications and local-administration support to one region.",
      cost: 1,
      duration: 24,
      effects: { broadbandAccess: 0.08, voterTurnout: 0.04, ruralRevitalization: 0.06 },
    },
  },
};
