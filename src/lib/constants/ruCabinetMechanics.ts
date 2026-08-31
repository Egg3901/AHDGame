/**
 * Soviet Union (RU) Cabinet mechanics — Council of Ministers (spec §3, D7).
 * Drives the per-position Office page: national/regional metrics, tier
 * settings, and emergencies.
 *
 * Depth note (CN precedent): five portfolio positions — Finance, Foreign
 * Trade, Internal Trade, the Gosbank liaison, and Agriculture — carry tier
 * settings; the rest are leadership/coordination or line ministries shipping
 * national metrics only. D7 requires the Foreign vs Internal Trade seats to
 * be MECHANICALLY distinct: Foreign Trade tiers act on growth (the state
 * import-export monopoly), Internal Trade tiers act on consumer costs and
 * employment (domestic goods distribution) — pinned by
 * ruCabinetEffectPaths.test.ts.
 *
 * No ministerial orders (the orders dispatch returns [] for RU — NG/IE
 * precedent). Shared types live in cabinetMechanicsTypes.ts.
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

const GDP_METRIC = {
  category: "economic",
  metricId: "gdpGrowth",
  label: "GDP Growth",
  format: "percent",
  higherIsBetter: true,
} as const;

const UNEMPLOYMENT_METRIC = {
  category: "economic",
  metricId: "unemploymentRate",
  label: "Unemployment Rate",
  format: "percent",
  higherIsBetter: false,
} as const;

const COST_OF_LIVING_METRIC = {
  category: "economic",
  metricId: "costOfLiving",
  label: "Cost of Living",
  format: "index",
  higherIsBetter: false,
} as const;

const PUBLIC_TRUST_METRIC = {
  category: "governance",
  metricId: "publicTrust",
  label: "Public Trust",
  format: "percent",
  higherIsBetter: true,
} as const;

const TRANSPARENCY_METRIC = {
  category: "governance",
  metricId: "governmentTransparency",
  label: "Government Transparency",
  format: "index",
  higherIsBetter: true,
} as const;

export const RU_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  premier: {
    positionId: "premier",
    department: "Council of Ministers",
    sealImage: "",
    legislativeDomains: ["governance"],
    nationalMetrics: [PUBLIC_TRUST_METRIC, TRANSPARENCY_METRIC],
    regionalMetrics: [],
    tierSetting: {
      name: "Council Posture",
      description:
        "Set how the Council of Ministers presses the union republics. Centralization drives execution at the cost of trust; devolution does the reverse.",
      defaultTier: "collegial",
      options: [
        {
          id: "devolution",
          label: "Republic Latitude",
          description: "Loosen central direction. Trust rises; plan execution slips.",
          effects: { publicTrust: 0.025, industrialPolicyExecution: -0.02 },
        },
        { id: "collegial", label: "Collegial", description: "Govern to precedent.", effects: {} },
        {
          id: "centralization",
          label: "Centralization",
          description: "Direct the republics from the centre. Execution sharpens; trust erodes.",
          effects: { industrialPolicyExecution: 0.025, publicTrust: -0.02 },
        },
      ],
    },
  },

  first_deputy_premier: {
    positionId: "first_deputy_premier",
    department: "Council of Ministers",
    sealImage: "",
    legislativeDomains: ["governance", "economic"],
    nationalMetrics: [PUBLIC_TRUST_METRIC, GDP_METRIC],
    regionalMetrics: [],
    tierSetting: {
      name: "Coordination Priority",
      description:
        "Choose what the deputy chairmanship pushes across the ministries: output, or clean administration.",
      defaultTier: "balanced",
      options: [
        {
          id: "output_first",
          label: "Output First",
          description: "Push production above all. Growth rises; graft goes unchecked.",
          effects: { gdpGrowth: 0.02, corruptionIndex: 0.015 },
        },
        { id: "balanced", label: "Balanced", description: "Coordinate to plan.", effects: {} },
        {
          id: "discipline_first",
          label: "Discipline First",
          description: "Police the ministries. Graft falls; output slows.",
          effects: { corruptionIndex: -0.025, gdpGrowth: -0.012 },
        },
      ],
    },
  },

  minister_of_foreign_affairs: {
    positionId: "minister_of_foreign_affairs",
    department: "Ministry of Foreign Affairs",
    sealImage: "",
    legislativeDomains: ["foreign_policy"],
    nationalMetrics: [GDP_METRIC, TRANSPARENCY_METRIC],
    regionalMetrics: [],
    tierSetting: {
      name: "Diplomatic Line",
      description:
        "Set the union's posture abroad. Détente opens trade at the cost of prestige at home; confrontation does the reverse.",
      defaultTier: "coexistence",
      options: [
        {
          id: "detente",
          label: "Détente",
          description: "Seek accommodation. Trade widens; hard-line prestige suffers.",
          effects: { tradeGrowth: 0.025, nationalPride: -0.015 },
        },
        {
          id: "coexistence",
          label: "Peaceful Coexistence",
          description: "Hold the standing line.",
          effects: {},
        },
        {
          id: "confrontation",
          label: "Confrontation",
          description: "Press the union's claims. Pride rises; trade narrows.",
          effects: { nationalPride: 0.025, tradeGrowth: -0.02 },
        },
      ],
    },
  },

  minister_of_defence: {
    positionId: "minister_of_defence",
    department: "Ministry of Defence",
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
      PUBLIC_TRUST_METRIC,
    ],
    regionalMetrics: [],
    tierSetting: {
      name: "Force Posture",
      description:
        "Set the standing posture of the armed forces. Mobilization buys readiness with labour drawn out of the plan.",
      defaultTier: "standing",
      options: [
        {
          id: "demobilization",
          label: "Demobilization",
          description: "Return conscripts to industry. Hiring improves; readiness falls.",
          effects: { unemploymentRate: -0.02, militaryReadiness: -0.03 },
        },
        {
          id: "standing",
          label: "Standing Forces",
          description: "Hold establishment.",
          effects: {},
        },
        {
          id: "mobilization",
          label: "Mobilization",
          description: "Call up reserves. Readiness rises; industry loses labour.",
          effects: { militaryReadiness: 0.035, unemploymentRate: 0.015 },
        },
      ],
    },
    regionalTarget: {
      name: "Military District Focus",
      description: "Concentrate garrisons and civil defence in one republic.",
      effects: { publicSafetyConfidence: 0.04, militaryReadiness: 0.03 },
    },
    emergency: {
      name: "Emergency Mobilization",
      description:
        "Call up the reserves in one republic under acute threat, sharply raising readiness and confidence.",
      cost: 1,
      duration: 24,
      effects: { militaryReadiness: 0.09, publicSafetyConfidence: 0.06 },
    },
  },

  minister_of_finance: {
    positionId: "minister_of_finance",
    department: "Ministry of Finance",
    sealImage: "",
    legislativeDomains: ["tax", "economic"],
    nationalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC, COST_OF_LIVING_METRIC],
    regionalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC],
    tierSetting: {
      name: "Budget Discipline",
      description:
        "Set the Ministry's stance on plan financing. Expansion accelerates output and hiring at the cost of price pressure; retrenchment cools costs but slows the plan.",
      defaultTier: "planned",
      options: [
        {
          id: "retrenchment",
          label: "Retrenchment",
          description: "Tighten plan financing. Costs ease, but growth and hiring slow.",
          effects: { costOfLiving: -0.02, gdpGrowth: -0.015, unemploymentRate: 0.01 },
        },
        {
          id: "planned",
          label: "Planned Balance",
          description: "Hold financing to the plan targets.",
          effects: {},
        },
        {
          id: "expansion",
          label: "Plan Expansion",
          description:
            "Accelerate financing of plan targets. Output and hiring improve; prices run hotter.",
          effects: { gdpGrowth: 0.02, unemploymentRate: -0.015, costOfLiving: 0.015 },
        },
      ],
    },
    regionalTarget: {
      name: "Republic Financing Priority",
      description: "Direct plan financing to one republic, lifting growth and hiring there.",
      effects: { gdpGrowth: 0.04, unemploymentRate: -0.03 },
    },
    emergency: {
      name: "Emergency Plan Correction",
      description:
        "Deploy an emergency correction for a republic under acute economic stress, sharply lifting output and employment for one window.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.08, unemploymentRate: -0.06 },
    },
  },

  minister_of_internal_affairs: {
    positionId: "minister_of_internal_affairs",
    department: "Ministry of Internal Affairs",
    sealImage: "",
    legislativeDomains: ["law_justice", "publicSafety"],
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Safety Confidence",
        format: "index",
        higherIsBetter: true,
      },
      PUBLIC_TRUST_METRIC,
    ],
    regionalMetrics: [],
    tierSetting: {
      name: "Internal Security Posture",
      description:
        "Set how hard the security organs press. Repression buys order at the cost of civil liberties.",
      defaultTier: "routine",
      options: [
        {
          id: "thaw",
          label: "Thaw",
          description: "Relax the organs. Liberties widen; crime creeps up.",
          effects: { civilLiberties: 0.03, crimeRate: 0.015 },
        },
        {
          id: "routine",
          label: "Routine Vigilance",
          description: "Standing posture.",
          effects: {},
        },
        {
          id: "crackdown",
          label: "Crackdown",
          description: "Press the organs hard. Crime falls; liberties narrow.",
          effects: { crimeRate: -0.03, civilLiberties: -0.025 },
        },
      ],
    },
    regionalTarget: {
      name: "Militia Concentration",
      description: "Concentrate militia strength in one republic, cutting crime there.",
      effects: { crimeRate: -0.04, publicSafetyConfidence: 0.03 },
    },
    emergency: {
      name: "State of Emergency",
      description:
        "Impose emergency powers in one republic, sharply cutting crime at a cost to civil liberties.",
      cost: 1,
      duration: 24,
      effects: { crimeRate: -0.09, violentCrimeRate: -0.07 },
      sideEffects: { civilLiberties: -0.05 },
    },
  },

  chairman_of_gosplan: {
    positionId: "chairman_of_gosplan",
    department: "State Planning Committee",
    sealImage: "",
    legislativeDomains: ["economic", "governance"],
    nationalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC, TRANSPARENCY_METRIC],
    regionalMetrics: [GDP_METRIC],
    tierSetting: {
      name: "Plan Emphasis",
      description:
        "Weight the control figures between heavy industry (Group A) and consumer goods (Group B).",
      defaultTier: "balanced_plan",
      options: [
        {
          id: "group_b",
          label: "Group B Priority",
          description: "Favour consumer goods. Household costs ease; industrial output slows.",
          effects: { costOfLiving: -0.025, manufacturingCompetitiveness: -0.015 },
        },
        {
          id: "balanced_plan",
          label: "Balanced Plan",
          description: "Hold the control figures.",
          effects: {},
        },
        {
          id: "group_a",
          label: "Group A Priority",
          description: "Favour heavy industry. Competitiveness rises; household costs climb.",
          effects: { manufacturingCompetitiveness: 0.025, costOfLiving: 0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Priority Development Region",
      description: "Name one republic a priority development region in the control figures.",
      effects: { gdpGrowth: 0.04, industrialPolicyExecution: 0.03 },
    },
    emergency: {
      name: "Emergency Plan Reallocation",
      description:
        "Reallocate plan resources to one republic in crisis, sharply lifting output and execution.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.08, industrialPolicyExecution: 0.06 },
    },
  },

  gosbank_liaison: {
    positionId: "gosbank_liaison",
    department: "State Bank of the USSR",
    sealImage: "",
    legislativeDomains: ["economic"],
    nationalMetrics: [
      {
        category: "economic",
        metricId: "inflationPressure",
        label: "Inflation Pressure",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "interestRate",
        label: "Gosbank Prime Rate",
        format: "percent",
        higherIsBetter: false,
      },
      GDP_METRIC,
    ],
    regionalMetrics: [],
    tierSetting: {
      name: "Credit Plan",
      description:
        "Set Gosbank's credit issuance stance. Loose credit funds the plan faster but builds price pressure; tight credit cools prices at the cost of output.",
      defaultTier: "plan_neutral",
      options: [
        {
          id: "tight_credit",
          label: "Tight Credit",
          description: "Restrict enterprise credit. Price pressure eases; output slows.",
          effects: { inflationPressure: -0.05, gdpGrowth: -0.01 },
        },
        {
          id: "plan_neutral",
          label: "Plan Neutral",
          description: "Issue credit to plan targets.",
          effects: {},
        },
        {
          id: "loose_credit",
          label: "Loose Credit",
          description: "Expand enterprise credit beyond plan. Output rises; prices pressure up.",
          effects: { inflationPressure: 0.05, gdpGrowth: 0.012 },
        },
      ],
    },
  },

  minister_of_foreign_trade: {
    positionId: "minister_of_foreign_trade",
    department: "Ministry of Foreign Trade",
    sealImage: "",
    legislativeDomains: ["foreign_policy", "economic"],
    nationalMetrics: [GDP_METRIC, COST_OF_LIVING_METRIC],
    regionalMetrics: [GDP_METRIC],
    // D7: the state import-export monopoly — GROWTH-facing tiers, distinct
    // from Internal Trade's consumer-facing tiers below.
    tierSetting: {
      name: "Trade Monopoly Posture",
      description:
        "Direct the state foreign-trade monopoly. An export drive earns growth abroad but tightens goods at home; autarky insulates prices at the cost of growth.",
      defaultTier: "managed_exchange",
      options: [
        {
          id: "autarky",
          label: "Autarky",
          description: "Minimize foreign exchange. Prices insulate; growth slows.",
          effects: { gdpGrowth: -0.02, costOfLiving: -0.005 },
        },
        {
          id: "managed_exchange",
          label: "Managed Exchange",
          description: "Trade to plan requirements.",
          effects: {},
        },
        {
          id: "export_drive",
          label: "Export Drive",
          description:
            "Push exports for hard currency. Growth accelerates; domestic goods tighten.",
          effects: { gdpGrowth: 0.025, costOfLiving: 0.012 },
        },
      ],
    },
    regionalTarget: {
      name: "Export Zone Designation",
      description: "Designate one republic as an export production zone.",
      effects: { tradeGrowth: 0.04, gdpGrowth: 0.02 },
    },
  },

  minister_of_internal_trade: {
    positionId: "minister_of_internal_trade",
    department: "Ministry of Internal Trade",
    sealImage: "",
    legislativeDomains: ["economic", "social"],
    nationalMetrics: [COST_OF_LIVING_METRIC, UNEMPLOYMENT_METRIC],
    regionalMetrics: [COST_OF_LIVING_METRIC],
    // D7: domestic goods distribution — CONSUMER-facing tiers, distinct from
    // Foreign Trade's growth-facing tiers above.
    tierSetting: {
      name: "Goods Distribution Priority",
      description:
        "Set the priority of domestic goods distribution. Consumer priority eases household costs but diverts labour from heavy industry; producer priority does the reverse.",
      defaultTier: "plan_allocation",
      options: [
        {
          id: "producer_priority",
          label: "Producer Priority",
          description: "Divert goods to industry. Household costs rise; hiring strengthens.",
          effects: { costOfLiving: 0.015, unemploymentRate: -0.01 },
        },
        {
          id: "plan_allocation",
          label: "Plan Allocation",
          description: "Distribute goods to plan quotas.",
          effects: {},
        },
        {
          id: "consumer_priority",
          label: "Consumer Priority",
          description: "Prioritize household goods. Costs ease; industrial hiring softens.",
          effects: { costOfLiving: -0.02, unemploymentRate: 0.008 },
        },
      ],
    },
    regionalTarget: {
      name: "Supply Priority Republic",
      description: "Move one republic to the head of the goods distribution queue.",
      effects: { costOfLiving: -0.04, consumerConfidence: 0.03 },
    },
    emergency: {
      name: "Emergency Goods Airlift",
      description:
        "Airlift consumer stocks into one republic facing acute shortage, sharply cutting costs.",
      cost: 1,
      duration: 24,
      effects: { costOfLiving: -0.08, consumerConfidence: 0.06 },
    },
  },

  minister_of_agriculture: {
    positionId: "minister_of_agriculture",
    department: "Ministry of Agriculture",
    sealImage: "",
    legislativeDomains: ["agriculture", "economic"],
    nationalMetrics: [COST_OF_LIVING_METRIC, GDP_METRIC],
    regionalMetrics: [GDP_METRIC],
    tierSetting: {
      name: "Procurement Quotas",
      description:
        "Set collective-farm procurement quotas. Heavy quotas feed the cities cheaply but sap rural output; light quotas do the reverse.",
      defaultTier: "standard_quotas",
      options: [
        {
          id: "light_quotas",
          label: "Light Quotas",
          description: "Ease procurement. Rural output improves; urban costs rise.",
          effects: { gdpGrowth: 0.012, costOfLiving: 0.01 },
        },
        {
          id: "standard_quotas",
          label: "Standard Quotas",
          description: "Procure to plan.",
          effects: {},
        },
        {
          id: "heavy_quotas",
          label: "Heavy Quotas",
          description: "Raise procurement. Urban costs ease; rural output saps.",
          effects: { costOfLiving: -0.015, gdpGrowth: -0.012 },
        },
      ],
    },
    regionalTarget: {
      name: "Agricultural Priority Region",
      description: "Direct machinery and fertilizer to one republic's farms.",
      effects: { foodSecurity: 0.04, ruralRevitalization: 0.03 },
    },
    emergency: {
      name: "Emergency Grain Release",
      description:
        "Release state grain reserves to one republic facing shortage, sharply cutting food insecurity.",
      cost: 1,
      duration: 24,
      effects: { foodInsecurity: -0.09, foodSecurity: 0.06 },
    },
  },

  minister_of_machine_building: {
    positionId: "minister_of_machine_building",
    department: "Ministry of Machine Building and Heavy Industry",
    sealImage: "",
    legislativeDomains: ["economic", "infrastructure"],
    nationalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC],
    regionalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC],
    tierSetting: {
      name: "Combine Output Setting",
      description:
        "Set how hard the heavy combines are driven. Over-fulfilment buys output with dirtier air.",
      defaultTier: "quota",
      options: [
        {
          id: "modernization",
          label: "Modernization",
          description: "Retool rather than run flat out. Air cleans; output dips.",
          // airQuality is an AQI: negative = cleaner.
          effects: { airQuality: -0.02, manufacturingCompetitiveness: -0.012 },
        },
        { id: "quota", label: "Quota Output", description: "Produce to plan.", effects: {} },
        {
          id: "overfulfilment",
          label: "Over-Fulfilment",
          description: "Drive the combines past quota. Output rises; air worsens.",
          effects: { manufacturingCompetitiveness: 0.025, airQuality: 0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Industrial Concentration",
      description:
        "Site new combine capacity in one republic: hiring and competitiveness rise, air worsens.",
      effects: { manufacturingCompetitiveness: 0.04, unemploymentRate: -0.03, airQuality: 0.02 },
    },
    emergency: {
      name: "Emergency Production Order",
      description:
        "Order the combines in one republic onto emergency shifts. Output surges; the air pays for it.",
      cost: 1,
      duration: 24,
      effects: { manufacturingCompetitiveness: 0.08, unemploymentRate: -0.05 },
      sideEffects: { airQuality: 0.04 },
    },
  },

  minister_of_railways: {
    positionId: "minister_of_railways",
    department: "Ministry of Railways",
    sealImage: "",
    legislativeDomains: ["infrastructure"],
    nationalMetrics: [GDP_METRIC, UNEMPLOYMENT_METRIC],
    regionalMetrics: [],
    tierSetting: {
      name: "Network Priority",
      description:
        "Set what the network carries first. Freight priority serves the plan; passenger service serves households.",
      defaultTier: "mixed_traffic",
      options: [
        {
          id: "passenger_priority",
          label: "Passenger Priority",
          description: "Run passenger service first. Transit improves; freight slows.",
          effects: { publicTransit: 0.025, transportEfficiency: -0.015 },
        },
        {
          id: "mixed_traffic",
          label: "Mixed Traffic",
          description: "Run to timetable.",
          effects: {},
        },
        {
          id: "freight_priority",
          label: "Freight Priority",
          description: "Clear the line for plan freight. Efficiency rises; transit suffers.",
          effects: { transportEfficiency: 0.025, publicTransit: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Line Modernization Priority",
      description: "Concentrate track and rolling-stock investment in one republic.",
      effects: { transportEfficiency: 0.04, roadCondition: 0.02 },
    },
    emergency: {
      name: "Emergency Line Repair",
      description:
        "Rush repair crews to one republic's network after a failure, sharply restoring efficiency.",
      cost: 1,
      duration: 24,
      effects: { transportEfficiency: 0.09, roadCondition: 0.05 },
    },
  },

  minister_of_culture: {
    positionId: "minister_of_culture",
    department: "Ministry of Culture",
    sealImage: "",
    legislativeDomains: ["social"],
    nationalMetrics: [PUBLIC_TRUST_METRIC],
    regionalMetrics: [],
    tierSetting: {
      name: "Cultural Line",
      description:
        "Set how tightly cultural output is supervised. A liberal line builds participation; orthodoxy builds pride.",
      defaultTier: "supervised",
      options: [
        {
          id: "liberal",
          label: "Liberal Line",
          description: "Loosen supervision. Participation and cohesion rise; orthodoxy weakens.",
          effects: { civicParticipation: 0.025, nationalPride: -0.015 },
        },
        {
          id: "supervised",
          label: "Supervised",
          description: "Standing editorial line.",
          effects: {},
        },
        {
          id: "orthodox",
          label: "Orthodox Line",
          description: "Tighten supervision. Pride rises; participation narrows.",
          effects: { nationalPride: 0.025, civicParticipation: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Cultural Investment Priority",
      description: "Build houses of culture and cinemas in one republic.",
      effects: { civicParticipation: 0.04, socialCohesion: 0.03 },
    },
    emergency: {
      name: "Emergency Agitation Campaign",
      description:
        "Flood one republic with agitators and press, sharply lifting cohesion and pride.",
      cost: 1,
      duration: 24,
      effects: { socialCohesion: 0.08, nationalPride: 0.06 },
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
      PUBLIC_TRUST_METRIC,
    ],
    regionalMetrics: [],
    tierSetting: {
      name: "Health Service Emphasis",
      description: "Weight the health service between prevention and hospital capacity.",
      defaultTier: "standard_service",
      options: [
        {
          id: "prevention",
          label: "Prevention Emphasis",
          description:
            "Fund sanitation and screening. Preventable deaths fall; physician coverage thins.",
          effects: { preventableMortality: -0.03, physicianRate: -0.012 },
        },
        {
          id: "standard_service",
          label: "Standard Service",
          description: "Fund to norm.",
          effects: {},
        },
        {
          id: "hospital_buildout",
          label: "Hospital Buildout",
          description: "Fund beds and staff. Physician coverage rises; prevention slips.",
          effects: { physicianRate: 0.03, preventableMortality: 0.012 },
        },
      ],
    },
    regionalTarget: {
      name: "Health District Priority",
      description: "Concentrate physicians and clinics in one republic.",
      effects: { physicianRate: 0.04, preventableMortality: -0.03 },
    },
    emergency: {
      name: "Epidemic Response",
      description:
        "Deploy mobile medical brigades to one republic in an outbreak, sharply cutting deaths.",
      cost: 1,
      duration: 24,
      effects: { preventableMortality: -0.09, publicHealthPreparedness: 0.06 },
    },
  },

  minister_of_higher_education: {
    positionId: "minister_of_higher_education",
    department: "Ministry of Higher Education",
    sealImage: "",
    legislativeDomains: ["education"],
    nationalMetrics: [
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
      PUBLIC_TRUST_METRIC,
    ],
    regionalMetrics: [],
    tierSetting: {
      name: "Institute Intake",
      description:
        "Weight institute intake between broad enrolment and narrow technical specialization.",
      defaultTier: "standard_intake",
      options: [
        {
          id: "mass_intake",
          label: "Mass Intake",
          description: "Widen enrolment. Enrolment rises; average skill dilutes.",
          effects: { universityEnrollment: 0.03, workforceSkill: -0.012 },
        },
        {
          id: "standard_intake",
          label: "Standard Intake",
          description: "Admit to plan.",
          effects: {},
        },
        {
          id: "technical_specialization",
          label: "Technical Specialization",
          description: "Narrow intake to plan priorities. Skill rises; enrolment falls.",
          effects: { workforceSkill: 0.03, universityEnrollment: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Institute Siting Priority",
      description: "Site new technical institutes in one republic.",
      effects: { workforceSkill: 0.04, universityEnrollment: 0.03 },
    },
    emergency: {
      name: "Emergency Cadre Programme",
      description:
        "Run an accelerated technical training programme in one republic, sharply lifting skill.",
      cost: 1,
      duration: 24,
      effects: { workforceSkill: 0.08, universityEnrollment: 0.05 },
    },
  },
  director_of_intelligence: {
    positionId: "director_of_intelligence",
    department: "Committee for State Security",
    sealImage: "",
    tierSetting: {
      name: "Collection Posture",
      description:
        "Set how hard the service is run. Pressing harder buys reach and cleaner files, and costs the liberties of the people it watches.",
      defaultTier: "standing",
      options: [
        {
          id: "restrained",
          label: "Restrained",
          description: "Keep the service on a short leash. Liberties widen; less is learned.",
          effects: { civilLiberties: 0.025, publicTrust: 0.01 },
        },
        {
          id: "standing",
          label: "Standing Watch",
          description: "The service's ordinary peacetime footing.",
          effects: {},
        },
        {
          id: "aggressive",
          label: "Aggressive Collection",
          description:
            "Run the service hard at home and abroad. Corruption is rooted out; liberties narrow.",
          effects: { corruptionIndex: -0.025, civilLiberties: -0.03 },
        },
      ],
    },
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
