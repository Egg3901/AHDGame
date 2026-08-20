/**
 * China Cabinet mechanics configuration.
 * Drives the per-position Office page: national/regional metrics, tier settings,
 * regional target mechanics, allocation panels, and emergencies.
 *
 * Depth note: 5 portfolio positions (finance, defense, education, health,
 * pboc_governor) have full tier-settings, regional targets, and emergency
 * actions. The 4 leadership/coordination positions (premier, vice_premier,
 * state_councillor, minister_of_foreign_affairs) ship with national metrics
 * only — they coordinate other ministries rather than running a portfolio,
 * and tier-settings would not be meaningful for them.
 *
 * Shared types live in cabinetMechanicsTypes.ts.
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

export const CN_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  premier: {
    positionId: "premier",
    department: "State Council",
    sealImage: "",
    legislativeDomains: ["governance"],
    nationalMetrics: [
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
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
  },

  vice_premier: {
    positionId: "vice_premier",
    department: "State Council",
    sealImage: "",
    legislativeDomains: ["governance", "economic"],
    nationalMetrics: [
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
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

  state_councillor: {
    positionId: "state_councillor",
    department: "State Council",
    sealImage: "",
    legislativeDomains: ["governance"],
    nationalMetrics: [
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

  minister_of_foreign_affairs: {
    positionId: "minister_of_foreign_affairs",
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
  },

  minister_of_finance: {
    positionId: "minister_of_finance",
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
        "Set the State Council's fiscal stance. Stimulus boosts growth and hiring but adds cost pressure; consolidation cools inflation pressure at the expense of growth.",
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
        "Direct fiscal support to one province facing weaker growth. The target province gets faster growth and labor-market support.",
      effects: { gdpGrowth: 0.04, unemploymentRate: -0.03 },
    },
    emergency: {
      name: "Emergency Stabilization Package",
      description:
        "Deploy a temporary stabilization package for a province under acute economic stress, sharply lifting growth and employment for one turn window.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.08, unemploymentRate: -0.06 },
    },
    allocation: {
      name: "Central Government Transfers",
      description:
        "Allocate the central government transfer pool (中央转移支付) across all 7 macro-regions. Must sum to 100%.",
      poolLabel: "Central Transfer Pool",
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },

  minister_of_defense: {
    positionId: "minister_of_defense",
    department: "Central Military Commission",
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
          description:
            "Lower readiness across the force, reducing upkeep. Civil-defence coverage thins with it.",
          effects: {
            "publicSafety.publicSafetyConfidence": -0.02,
            "environment.naturalDisasterPreparedness": -0.02,
          },
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
            "Raise the readiness every formation trains toward, strengthening civil-defence resilience at higher upkeep and some public tension.",
          effects: {
            "publicSafety.publicSafetyConfidence": 0.02,
            "environment.naturalDisasterPreparedness": 0.03,
            "governance.publicTrust": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Readiness Focus",
      description:
        "Concentrate training and civil-defense logistics in one province to improve preparedness and public confidence.",
      effects: { publicSafetyConfidence: 0.04, naturalDisasterPreparedness: 0.05 },
    },
  },

  minister_of_education: {
    positionId: "minister_of_education",
    department: "Ministry of Education",
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
      description: "Target one province for school modernization and teacher support.",
      effects: { testPerformance: 0.05, workforceSkill: 0.05 },
    },
    emergency: {
      name: "Teacher Retention Surge",
      description:
        "Deploy emergency staffing support and retention grants to one province's school system.",
      cost: 1,
      duration: 24,
      effects: { testPerformance: 0.08, academicPressure: -0.04 },
    },
  },

  minister_of_health: {
    positionId: "minister_of_health",
    department: "Ministry of Health",
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
        metricId: "physicianRate",
        label: "Physician Access",
        format: "rate",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Public Health Preparedness",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "mentalHealthAccess",
        label: "Mental Health Access",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Public Health Preparedness",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "mentalHealthAccess",
        label: "Mental Health Access",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Care Delivery Focus",
      description:
        "Set whether the ministry emphasizes hospital throughput, preventive care, or balanced provision.",
      defaultTier: "balanced",
      options: [
        {
          id: "hospital_focus",
          label: "Hospital Focus",
          description:
            "Improve treatment capacity and physician availability, but preventive care improves more slowly.",
          effects: { physicianRate: 0.02, lifeExpectancy: 0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced health strategy.",
          effects: {},
        },
        {
          id: "prevention_focus",
          label: "Prevention Focus",
          description:
            "Expand preventive care and public health outreach, improving population health over time.",
          effects: { lifeExpectancy: 0.03, mentalHealthAccess: 0.03 },
        },
      ],
    },
    regionalTarget: {
      name: "Rural Clinic Support",
      description: "Direct physicians, clinics, and care support into one underserved province.",
      effects: { physicianRate: 0.05, publicHealthPreparedness: 0.05 },
    },
    emergency: {
      name: "Emergency Care Surge",
      description: "Launch a rapid health workforce deployment to a strained province.",
      cost: 1,
      duration: 24,
      effects: { publicHealthPreparedness: 0.08, physicianRate: 0.08 },
    },
  },

  pboc_governor: {
    positionId: "pboc_governor",
    department: "People's Bank of China",
    sealImage: "",
    legislativeDomains: ["economic", "tax"],
    nationalMetrics: [
      {
        category: "economic",
        metricId: "inflationRate",
        label: "Inflation Rate",
        format: "percent",
        higherIsBetter: false,
        // Inflation is maintained on federalBudget.economicFactors, not stateMetrics.
        source: "budget",
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
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "interestRate",
        label: "Interest Rate",
        format: "percent",
        higherIsBetter: false,
        // The prime/interest rate lives on the central bank document.
        source: "centralBank",
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
      name: "Monetary Stance",
      description:
        "Set the PBoC's monetary policy stance. Easing stimulates growth but risks inflation; tightening cools prices but slows activity.",
      defaultTier: "neutral",
      options: [
        {
          id: "tight",
          label: "Tight",
          description: "Raise rates and tighten liquidity to fight inflation.",
          effects: { inflationPressure: -0.4, gdpGrowth: -0.02, unemploymentRate: 0.015 },
        },
        {
          id: "neutral",
          label: "Neutral",
          description: "Maintain a balanced monetary stance.",
          effects: {},
        },
        {
          id: "loose",
          label: "Loose",
          description: "Cut rates and expand liquidity to stimulate growth and employment.",
          effects: { gdpGrowth: 0.02, unemploymentRate: -0.015, inflationPressure: 0.4 },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Liquidity Support",
      description:
        "Direct credit and liquidity support to one province facing tighter financial conditions.",
      effects: { gdpGrowth: 0.04, unemploymentRate: -0.03 },
    },
    emergency: {
      name: "Emergency Liquidity Injection",
      description:
        "Deploy emergency liquidity to stabilize credit conditions in a province under acute financial stress.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.06, unemploymentRate: -0.05, inflationPressure: 0.3 },
    },
  },

  minister_of_public_security: {
    positionId: "minister_of_public_security",
    department: "Ministry of Public Security",
    sealImage: "",
    legislativeDomains: ["law_justice", "publicSafety"],
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Safety Confidence",
        format: "index",
        higherIsBetter: true,
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
        metricId: "socialCreditCoverage",
        label: "Social Credit Coverage",
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
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Safety Confidence",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Policing Posture",
      description:
        "Set the national policing posture. Community policing builds trust at the cost of slightly higher crime; strike-hard campaigns cut crime and lift confidence but strain public trust.",
      defaultTier: "balanced",
      options: [
        {
          id: "community_policing",
          label: "Community Policing",
          description:
            "Emphasize local engagement and restraint. Builds public trust but crime creeps up.",
          effects: { publicTrust: 0.015, crimeRate: 0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain standard enforcement.",
          effects: {},
        },
        {
          id: "strike_hard",
          label: "Strike Hard",
          description:
            "Aggressive crackdown (严打). Cuts crime and raises confidence but erodes public trust.",
          effects: { crimeRate: -0.02, publicSafetyConfidence: 0.02, publicTrust: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Provincial Security Sweep",
      description:
        "Concentrate policing resources in one province to cut crime and raise safety confidence.",
      effects: { crimeRate: -0.04, publicSafetyConfidence: 0.04 },
    },
    emergency: {
      name: "Stability Maintenance Operation",
      description:
        "Deploy a temporary security surge to a province under acute public-order stress, sharply cutting crime for one turn window.",
      cost: 1,
      duration: 24,
      effects: { crimeRate: -0.1, publicSafetyConfidence: 0.06 },
      sideEffects: { publicTrust: -0.04 },
    },
  },

  minister_of_commerce: {
    positionId: "minister_of_commerce",
    department: "Ministry of Commerce",
    sealImage: "",
    legislativeDomains: ["economic"],
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
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "tradeBalance",
        label: "Trade Balance",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "governance",
        metricId: "beltAndRoadEngagement",
        label: "Belt and Road Engagement",
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
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Business Formation",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Trade Stance",
      description:
        "Set the national trade posture. Protectionism shields domestic firms but raises prices; open markets lower prices and lift growth at the expense of some domestic formation.",
      defaultTier: "balanced",
      options: [
        {
          id: "protectionist",
          label: "Protectionist",
          description:
            "Shield domestic industry. Lifts business formation and the trade balance but raises cost of living.",
          effects: { smallBusinessFormation: 0.02, tradeBalance: 0.02, costOfLiving: 0.015 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a neutral trade stance.",
          effects: {},
        },
        {
          id: "open_markets",
          label: "Open Markets",
          description:
            "Liberalize trade and investment. Boosts growth and lowers prices but pressures domestic formation and the trade balance.",
          effects: {
            gdpGrowth: 0.015,
            costOfLiving: -0.02,
            smallBusinessFormation: -0.01,
            tradeBalance: -0.015,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Special Economic Zone",
      description:
        "Designate one province as a special economic zone, boosting growth and business formation there.",
      effects: { gdpGrowth: 0.04, smallBusinessFormation: 0.03 },
    },
    emergency: {
      name: "Export Stabilization Drive",
      description:
        "Deploy emergency export support to a province facing a trade shock, lifting growth and the trade balance for one turn window.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.06, tradeBalance: 0.04 },
    },
  },

  minister_of_human_resources_social_security: {
    positionId: "minister_of_human_resources_social_security",
    department: "Ministry of Human Resources and Social Security",
    sealImage: "",
    legislativeDomains: ["social", "economic"],
    nationalMetrics: [
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "commonProsperityIndex",
        label: "Common Prosperity",
        format: "index",
        higherIsBetter: true,
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
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Labor Market Stance",
      description:
        "Set the labor-market posture. Flexibility cuts unemployment but widens inequality; worker protection narrows inequality and lifts wages but nudges unemployment up.",
      defaultTier: "balanced",
      options: [
        {
          id: "flexibility",
          label: "Flexibility",
          description: "Loosen labor rules. Cuts unemployment but widens income inequality.",
          effects: { unemploymentRate: -0.02, incomeInequality: 0.015 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a neutral labor stance.",
          effects: {},
        },
        {
          id: "worker_protection",
          label: "Worker Protection",
          description:
            "Strengthen protections and wages. Narrows inequality and lifts incomes but nudges unemployment up.",
          effects: { incomeInequality: -0.02, medianIncome: 0.01, unemploymentRate: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Migrant Worker Support",
      description:
        "Direct employment and re-skilling support to one province, cutting unemployment and lifting social mobility there.",
      effects: { unemploymentRate: -0.04, socialMobility: 0.03 },
    },
    emergency: {
      name: "Mass Re-employment Program",
      description:
        "Launch an emergency hiring and retraining push in a province facing high unemployment.",
      cost: 1,
      duration: 24,
      effects: { unemploymentRate: -0.1, socialMobility: 0.04 },
    },
  },

  minister_of_ecology_environment: {
    positionId: "minister_of_ecology_environment",
    department: "Ministry of Ecology and Environment",
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
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "index",
        higherIsBetter: false,
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
        metricId: "climateResilience",
        label: "Climate Resilience",
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
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Environmental Enforcement",
      description:
        "Set the enforcement posture. Growth-first relaxes limits for output at an environmental cost; a green mandate cleans air and cuts emissions but trims growth.",
      defaultTier: "balanced",
      options: [
        {
          id: "growth_first",
          label: "Growth First",
          description:
            "Relax environmental limits for output. Lifts growth but worsens air quality and emissions.",
          effects: { airQuality: 0.02, carbonEmissions: 0.02, gdpGrowth: 0.01 }, // AQI: lower = cleaner (P3c sign fix)
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain current environmental enforcement.",
          effects: {},
        },
        {
          id: "green_mandate",
          label: "Green Mandate",
          description: "Tighten enforcement. Cleans air and cuts emissions but trims growth.",
          effects: { airQuality: -0.02, carbonEmissions: -0.02, gdpGrowth: -0.01 }, // AQI: lower = cleaner (P3c sign fix)
        },
      ],
    },
    regionalTarget: {
      name: "Blue Sky Defense",
      description:
        "Concentrate the Blue Sky Defense campaign (蓝天保卫战) in one province to lift air quality and cut emissions there.",
      effects: { airQuality: -0.05, carbonEmissions: -0.03 }, // AQI: lower = cleaner (P3c sign fix)
    },
    emergency: {
      name: "Pollution Crackdown",
      description:
        "Order an emergency pollution crackdown in a province under acute air-quality stress.",
      cost: 1,
      duration: 24,
      effects: { airQuality: -0.1, carbonEmissions: -0.06 }, // AQI: lower = cleaner (P3c sign fix)
    },
  },

  minister_of_transport: {
    positionId: "minister_of_transport",
    department: "Ministry of Transport",
    sealImage: "",
    legislativeDomains: ["infrastructure"],
    nationalMetrics: [
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
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Investment Gap",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "infrastructure",
        metricId: "transportEfficiency",
        label: "Transport Efficiency",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
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
    ],
    tierSetting: {
      name: "Investment Priority",
      description:
        "Set the transport investment priority. High-speed rail lifts transit but diverts road funding; a highway-and-logistics focus improves roads at the expense of transit.",
      defaultTier: "balanced",
      options: [
        {
          id: "high_speed_rail",
          label: "High-Speed Rail",
          description:
            "Prioritize rail and transit. Lifts public transit but road maintenance slips.",
          effects: { publicTransit: 0.03, roadCondition: -0.02 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced investment mix.",
          effects: {},
        },
        {
          id: "highway_logistics",
          label: "Highway & Logistics",
          description: "Prioritize roads and freight. Improves roads but transit slips.",
          effects: { roadCondition: 0.03, publicTransit: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Provincial Connectivity Project",
      description:
        "Direct an infrastructure package to one province, closing its investment gap and improving transit.",
      effects: { infrastructureInvestmentGap: -0.05, publicTransit: 0.03 },
    },
    emergency: {
      name: "Disaster Infrastructure Repair",
      description:
        "Deploy emergency repair crews to a province after infrastructure failure or disaster.",
      cost: 1,
      duration: 24,
      effects: { roadCondition: 0.1, powerGridReliability: 0.06 },
    },
  },

  minister_of_agriculture_rural_affairs: {
    positionId: "minister_of_agriculture_rural_affairs",
    department: "Ministry of Agriculture and Rural Affairs",
    sealImage: "",
    legislativeDomains: ["agriculture", "economic", "social"],
    nationalMetrics: [
      {
        category: "economic",
        metricId: "foodSecurity",
        label: "Food Security",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "ruralRevitalization",
        label: "Rural Revitalization",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity",
        format: "percent",
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
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity",
        format: "percent",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Farm Policy",
      description:
        "Set the agricultural policy direction. Market liberalization lifts agri-business but raises food insecurity; grain self-sufficiency secures supply at slightly higher cost.",
      defaultTier: "balanced",
      options: [
        {
          id: "market_liberalization",
          label: "Market Liberalization",
          description: "Loosen farm controls. Lifts business formation but food insecurity rises.",
          effects: { smallBusinessFormation: 0.02, foodInsecurity: 0.02 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced farm policy.",
          effects: {},
        },
        {
          id: "grain_self_sufficiency",
          label: "Grain Self-Sufficiency",
          description:
            "Prioritize domestic grain supply. Secures food but raises cost of living slightly.",
          effects: { foodSecurity: 0.03, foodInsecurity: -0.02, costOfLiving: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Rural Revitalization Zone",
      description:
        "Target one province for rural revitalization investment, lifting rural vitality and cutting poverty.",
      effects: { ruralRevitalization: 0.05, povertyRate: -0.03 },
    },
    emergency: {
      name: "Grain Reserve Release",
      description: "Release central grain reserves to a province facing acute food insecurity.",
      cost: 1,
      duration: 24,
      effects: { foodInsecurity: -0.1, costOfLiving: -0.04 },
    },
  },

  minister_of_housing_urban_rural: {
    positionId: "minister_of_housing_urban_rural",
    department: "Ministry of Housing and Urban-Rural Development",
    sealImage: "",
    legislativeDomains: ["infrastructure", "social"],
    nationalMetrics: [
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        format: "rate",
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
        metricId: "housingSupplyGrowth",
        label: "Housing Supply Growth",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "population",
        metricId: "urbanizationRate",
        label: "Urbanization Rate",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Housing Stance",
      description:
        "Set the housing posture. Market development lowers prices via supply but does little for homelessness directly; an affordable mandate (房住不炒) cuts homelessness at a small cost-of-living cost.",
      defaultTier: "balanced",
      options: [
        {
          id: "market_development",
          label: "Market Development",
          description:
            "Spur private development. Lifts supply and lowers cost of living but homelessness creeps up.",
          effects: { costOfLiving: -0.02, housingSupplyGrowth: 0.02, homelessnessRate: 0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Maintain a balanced housing policy.",
          effects: {},
        },
        {
          id: "affordable_mandate",
          label: "Affordable Mandate",
          description:
            "Houses for living, not speculation (房住不炒). Cuts homelessness but cost of living ticks up.",
          effects: { homelessnessRate: -0.02, housingSupplyGrowth: 0.01, costOfLiving: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Urban Renewal Project",
      description:
        "Direct an urban renewal package to one province, cutting homelessness and supporting urbanization.",
      effects: { homelessnessRate: -0.04, urbanizationRate: 0.02 },
    },
    emergency: {
      name: "Affordable Housing Surge",
      description:
        "Deploy emergency affordable-housing support to a province facing a housing crisis.",
      cost: 1,
      duration: 24,
      effects: { homelessnessRate: -0.1, housingSupplyGrowth: 0.04 },
    },
  },
};
