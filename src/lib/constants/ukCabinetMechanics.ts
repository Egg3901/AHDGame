/**
 * UK Cabinet mechanics configuration.
 * Drives the per-position Office page: national/regional metrics, tier settings,
 * regional target mechanics, allocation panels, advocacy toggles, and emergencies.
 * Imported by briefing API, settings routes, turn processing, and the UI.
 *
 * Shared types live in cabinetMechanicsTypes.ts — re-exported here for
 * backwards compatibility with existing imports.
 */
export type {
  MetricFormat,
  MetricConfig,
  TierOption,
  TierSettingConfig,
  RegionalTargetConfig,
  AllocationConfig,
  AdvocacyConfig,
  EmergencyMechanicConfig,
  CabinetPositionMechanics,
} from "./cabinetMechanicsTypes";

import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

// ── Master mechanics map ─────────────────────────────────────────────────────

export const UK_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  // ── 0. Deputy Prime Minister ────────────────────────────────────────────────
  deputy_prime_minister: {
    positionId: "deputy_prime_minister",
    department: "Office of the Deputy Prime Minister",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "governmentApproval",
        label: "Government Approval",
        format: "percent",
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
    regionalMetrics: [
      {
        category: "governance",
        metricId: "governmentApproval",
        label: "Government Approval",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Government Coordination Level",
      description:
        "Set the national coordination stance. Efficiency focus streamlines decision-making; outreach focus broadens public engagement.",
      defaultTier: "balanced",
      options: [
        {
          id: "efficiency",
          label: "Efficiency",
          description:
            "Streamline government operations. Slightly boosts public trust but may reduce outreach engagement.",
          effects: { publicTrust: 0.02, governmentApproval: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced coordination. No additional metric effects.",
          effects: {},
        },
        {
          id: "outreach",
          label: "Outreach",
          description:
            "Expand public engagement programmes. Slightly boosts government approval but may slow internal decision-making.",
          effects: { governmentApproval: 0.02, publicTrust: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Governance Boost",
      description:
        "Direct enhanced governance support to one region. That region receives accelerated government approval improvement.",
      effects: { governmentApproval: 0.05 },
    },
    emergency: {
      name: "Crisis Coordination Response",
      description:
        "Deploy emergency crisis coordination to a target region, delivering a temporary boost to public trust and government approval.",
      cost: 1,
      duration: 24,
      effects: { governmentApproval: 0.06, publicTrust: 0.06 },
    },
  },

  // ── 1. First Secretary of State ──────────────────────────────────────────────
  first_secretary_of_state: {
    positionId: "first_secretary_of_state",
    department: "Cabinet Office",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill",
        format: "index",
        higherIsBetter: true,
      },
      {
        // `socialCohesion` lives under the `social` category in metricDefinitions. Declaring
        // it as `governance` here won resolveMetricPath's position-metrics preference and
        // sent every one of this seat's cohesion effects to `governance.socialCohesion`,
        // a StateMetrics path that does not exist (found auditing ticket #1140).
        category: "social",
        metricId: "socialCohesion",
        label: "Social Cohesion",
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
      {
        // `socialCohesion` lives under the `social` category in metricDefinitions. Declaring
        // it as `governance` here won resolveMetricPath's position-metrics preference and
        // sent every one of this seat's cohesion effects to `governance.socialCohesion`,
        // a StateMetrics path that does not exist (found auditing ticket #1140).
        category: "social",
        metricId: "socialCohesion",
        label: "Social Cohesion",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Domestic Policy Focus",
      description:
        "Set the national domestic policy direction. Skills focus accelerates workforce development; community focus boosts social cohesion; balanced delivers steady improvement across both.",
      defaultTier: "balanced",
      options: [
        {
          id: "skills",
          label: "Skills Focus",
          description:
            "Prioritise workforce development. Accelerates workforce skill growth but may reduce community investment.",
          effects: { workforceSkill: 0.03, socialCohesion: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced domestic investment. No additional metric effects.",
          effects: {},
        },
        {
          id: "community",
          label: "Community Focus",
          description:
            "Prioritise community cohesion. Boosts social cohesion but may slow workforce development programmes.",
          effects: { socialCohesion: 0.03, workforceSkill: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Skills and Community Investment",
      description:
        "Direct enhanced domestic investment to one region. That region receives accelerated workforce skill and social cohesion improvement.",
      effects: { workforceSkill: 0.03, socialCohesion: 0.03 },
    },
    emergency: {
      name: "Emergency Domestic Initiative",
      description:
        "Launch an emergency domestic programme in a target region, delivering a temporary boost to workforce skill and social cohesion.",
      cost: 1,
      duration: 24,
      effects: { workforceSkill: 0.05, socialCohesion: 0.05 },
    },
  },

  // ── 2. Chancellor of the Exchequer ────────────────────────────────────────
  chancellor: {
    positionId: "chancellor",
    department: "HM Treasury",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
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
        metricId: "povertyRate",
        label: "Poverty Rate",
        format: "percent",
        higherIsBetter: false,
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
        metricId: "propertyValueIndex",
        label: "Property Value",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "commercialValueIndex",
        label: "Commercial Value",
        format: "index",
        higherIsBetter: true,
      },
    ],
    allocation: {
      name: "Regional Funding Allocation",
      description:
        "Allocate the national local government funding pool across all 12 UK regions. Each region receives a percentage of the total pool. Must sum to 100%.",
      poolLabel: "Westminster Funding Pool",
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },

  // ── 2. Foreign Secretary ──────────────────────────────────────────────────
  foreign_secretary: {
    positionId: "foreign_secretary",
    department: "Foreign, Commonwealth & Development Office",
    departmentByYear: [
      { from: 1775, name: "Foreign Office" },
      { from: 1968, name: "Foreign and Commonwealth Office" },
      { from: 2020, name: "Foreign, Commonwealth & Development Office" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
    comingSoon: true,
  },

  // ── 3. Home Secretary ─────────────────────────────────────────────────────
  home_secretary: {
    positionId: "home_secretary",
    department: "Home Office",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
    tierSetting: {
      name: "Border Security Level",
      description:
        "Set the national border security policy. Stricter controls reduce crime but increase the cost of living; relaxed controls lower costs but may allow more criminal activity.",
      defaultTier: "standard",
      options: [
        {
          id: "relaxed",
          label: "Relaxed",
          description:
            "Lighter border controls. Reduces cost of living pressure but may allow increased criminal activity.",
          effects: { crimeRate: 0.02, costOfLiving: -0.03 },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Balanced border enforcement. No additional metric effects.",
          effects: {},
        },
        {
          id: "strict",
          label: "Strict",
          description:
            "Enhanced border enforcement. Reduces crime but increases cost of living due to stricter import controls.",
          effects: { crimeRate: -0.02, costOfLiving: 0.03 },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Policing Priority",
      description:
        "Focus national policing resources on one region. That region receives an enhanced crime reduction, but other regions see a slight increase as resources are redistributed.",
      effects: { crimeRate: -0.05 },
      nonTargetEffects: { crimeRate: 0.005 },
    },
    emergency: {
      name: "Emergency Powers Declaration",
      description:
        "Declare emergency powers in a region with critically high crime. Delivers a large temporary crime reduction but damages government approval in that region.",
      cost: 1,
      duration: 24,
      effects: { crimeRate: -0.15 },
      regionMetricThreshold: { metric: "publicSafety.crimeRate", above: 5500 }, // per-100k (P3b: 60 was the pre-S1 clamped scale — always true on real values)
      sideEffects: { governmentApproval: -0.1 },
    },
  },

  // ── 4. Secretary of State for Defence ────────────────────────────────────
  defence_secretary: {
    positionId: "defence_secretary",
    department: "Ministry of Defence",
    departmentByYear: [
      { from: 1775, name: "War Office" },
      { from: 1964, name: "Ministry of Defence" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/0/06/Ministry_of_Defence_%28United_Kingdom%29_badge.svg",
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
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
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
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Military Readiness Level",
      description:
        "Set the national military readiness posture. Elevated readiness boosts public confidence but increases fiscal pressure; reduced readiness saves money at the cost of approval.",
      defaultTier: "standard",
      options: [
        {
          id: "reduced",
          label: "Reduced",
          description:
            "Scaled-back military activity. Lower force readiness and defence upkeep, but demobilised garrison towns lose the work.",
          effects: {
            "economic.unemploymentRate": 0.02,
            "governance.publicTrust": -0.01,
          },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Normal operational readiness. No additional metric effects.",
          effects: {},
        },
        {
          id: "elevated",
          label: "Elevated",
          description:
            "Heightened military readiness. Raises the readiness every formation trains toward and keeps garrison towns in work, at greater upkeep that crowds out civilian growth.",
          effects: {
            "governance.publicTrust": 0.02,
            "economic.unemploymentRate": -0.02,
            "economic.gdpGrowth": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Regional Base Investment",
      description:
        "Expand military facilities in one region. That region benefits from reduced unemployment (military employment) and a small GDP boost funded from the defence budget envelope.",
      effects: { unemploymentRate: -0.03, gdpGrowth: 0.02 },
    },
  },

  // ── 5. Lord Chancellor & Secretary of State for Justice ──────────────────
  justice_secretary: {
    positionId: "justice_secretary",
    department: "Ministry of Justice",
    departmentByYear: [
      { from: 1775, name: "Lord Chancellor's Department" },
      { from: 2007, name: "Ministry of Justice" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        format: "index",
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
        format: "index",
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
      name: "Sentencing Guidelines",
      description:
        "Set national sentencing policy. Stricter guidelines deter crime but increase prison costs; lenient guidelines reduce spending but allow crime to creep up.",
      defaultTier: "standard",
      options: [
        {
          id: "lenient",
          label: "Lenient",
          description:
            "Reduced sentencing severity. Saves prison spending but crime rate increases slightly.",
          effects: { crimeRate: 0.02 },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Balanced sentencing guidelines. No additional metric effects.",
          effects: {},
        },
        {
          id: "strict",
          label: "Strict",
          description:
            "Harsher sentencing. Reduces crime but increases government spending on the prison system.",
          effects: { crimeRate: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Anti-Corruption Drive",
      description:
        "Focus anti-corruption enforcement resources on one region. That region receives an accelerated reduction in the corruption index.",
      effects: { corruptionIndex: -0.05 },
    },
  },

  // ── 6. Secretary of State for Health and Social Care ─────────────────────
  health_secretary: {
    positionId: "health_secretary",
    department: "Dept of Health and Social Care",
    departmentByYear: [
      { from: 1775, name: "Ministry of Health" },
      { from: 1968, name: "Dept of Health and Social Security" },
      { from: 1988, name: "Dept of Health" },
      { from: 2018, name: "Dept of Health and Social Care" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Healthcare Quality",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Healthcare Quality",
        format: "index",
        higherIsBetter: true,
      },
    ],
    allocation: {
      name: "NHS Resource Allocation",
      description:
        "Allocate NHS funding across all 12 UK regions. Each region receives a percentage of the total healthcare pool. Must sum to 100%.",
      poolLabel: "NHS Funding Pool",
    },
    regionalTarget: {
      name: "Public Health Campaign",
      description:
        "Launch a focused public health campaign in one region, delivering a targeted healthcare quality improvement.",
      // `healthcareQuality` is a LABEL, not a metric id. The seat's actual metric is
      // healthcare.publicHealthPreparedness, so the bare key resolved to nothing and this
      // campaign wrote to no metric at all (found auditing ticket #1140).
      effects: { "healthcare.publicHealthPreparedness": 0.05 },
    },
  },

  // ── 7. Secretary of State for Education ──────────────────────────────────
  education_secretary: {
    positionId: "education_secretary",
    department: "Dept for Education",
    departmentByYear: [
      { from: 1775, name: "Ministry of Education" },
      { from: 1964, name: "Dept of Education and Science" },
      { from: 2010, name: "Dept for Education" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        format: "percent",
        higherIsBetter: false,
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
    tierSetting: {
      name: "Curriculum Reform Focus",
      description:
        "Set the national curriculum direction. Vocational focus improves near-term employment; academic focus builds long-term skill levels; balanced delivers steady improvement across both.",
      defaultTier: "balanced",
      options: [
        {
          id: "vocational",
          label: "Vocational",
          description:
            "Prioritise trade and vocational training. Reduces unemployment faster but slows overall skill growth.",
          effects: { unemploymentRate: -0.02, workforceSkill: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced curriculum. No additional metric effects.",
          effects: {},
        },
        {
          id: "academic",
          label: "Academic",
          description:
            "Prioritise academic excellence. Accelerates workforce skill growth but does not directly help short-term employment.",
          effects: { workforceSkill: 0.03, unemploymentRate: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Education Investment Priority",
      description:
        "Direct enhanced education funding to one region. That region receives accelerated workforce skill improvement.",
      effects: { workforceSkill: 0.05 },
    },
    emergency: {
      name: "Skills Initiative",
      description:
        "Launch an emergency workforce development programme in a target region, delivering a significant temporary boost to workforce skill.",
      cost: 1,
      duration: 24,
      effects: { workforceSkill: 0.08 },
    },
  },

  // ── 8. Secretary of State for Business and Trade ──────────────────────────
  business_secretary: {
    positionId: "business_secretary",
    department: "Dept for Business, Energy and Industrial Strategy",
    departmentByYear: [
      { from: 1775, name: "Board of Trade" },
      { from: 1970, name: "Dept of Trade and Industry" },
      { from: 2016, name: "Dept for Business, Energy and Industrial Strategy" },
      { from: 2023, name: "Dept for Business and Trade" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Trade Policy Focus",
      description:
        "Set the national trade stance. Protectionist policy supports domestic industry at the cost of higher consumer prices; free trade reduces prices but increases competitive pressure on domestic firms.",
      defaultTier: "balanced",
      options: [
        {
          id: "protectionist",
          label: "Protectionist",
          description:
            "Domestic-first trade policy. Small GDP boost from sheltered industry but increases cost of living through import tariffs.",
          effects: { gdpGrowth: 0.01, costOfLiving: 0.02 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced trade policy. No additional metric effects.",
          effects: {},
        },
        {
          id: "free_trade",
          label: "Free Trade",
          description:
            "Open trade policy. Reduces cost of living through cheaper imports but slightly reduces GDP as domestic firms face competition.",
          effects: { gdpGrowth: -0.01, costOfLiving: -0.02 },
        },
      ],
    },
    regionalTarget: {
      name: "Enterprise Zone",
      description:
        "Designate one region as an enterprise zone. Corporations with sectors in that region receive investment benefits, delivering a GDP growth boost.",
      effects: { gdpGrowth: 0.04 },
    },
    emergency: {
      name: "Small Business Grant",
      description:
        "Deploy emergency small business grants in a target region, delivering a temporary GDP boost and reducing cost of living pressure.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.06, costOfLiving: -0.05 },
    },
  },

  // ── 9. Secretary of State for Levelling Up, Housing & Communities ─────────
  levelling_secretary: {
    positionId: "levelling_secretary",
    department: "Ministry of Housing, Communities and Local Government",
    departmentByYear: [
      { from: 1775, name: "Ministry of Housing and Local Government" },
      { from: 1970, name: "Dept of the Environment" },
      { from: 2001, name: "Dept for Communities and Local Government" },
      { from: 2018, name: "Ministry of Housing, Communities and Local Government" },
      { from: 2021, name: "Dept for Levelling Up, Housing and Communities" },
      { from: 2023, name: "Ministry of Housing, Communities and Local Government" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
        category: "governance",
        metricId: "devolutionSatisfaction",
        label: "Devolution Satisfaction",
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
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
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
    ],
    allocation: {
      name: "Levelling Up Fund",
      description:
        "Allocate the Levelling Up investment fund to regions below the national average. Funds boost GDP and reduce unemployment in target regions.",
      poolLabel: "Levelling Up Fund",
    },
    regionalTarget: {
      name: "Devolution Grant",
      description:
        "Award enhanced local governance funding to one region. That region receives a boost to devolution satisfaction and government approval.",
      effects: { devolutionSatisfaction: 0.05, governmentApproval: 0.03 },
    },
    emergency: {
      name: "Housing Development Order",
      description:
        "Issue an emergency housing development order in a target region, delivering a significant temporary reduction in cost of living.",
      cost: 1,
      duration: 24,
      effects: { costOfLiving: -0.08 },
    },
  },

  // ── 10. Secretary of State for Transport ──────────────────────────────────
  transport_secretary: {
    positionId: "transport_secretary",
    department: "Dept for Transport",
    departmentByYear: [
      { from: 1775, name: "Ministry of Transport" },
      { from: 1976, name: "Dept for Transport" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
        metricId: "broadbandAccess",
        label: "Broadband Access",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
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
        metricId: "broadbandAccess",
        label: "Broadband Access",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "National Infrastructure Programme",
      description:
        "Set the national infrastructure investment focus. Roads priority accelerates road condition improvement; digital priority accelerates broadband; balanced delivers steady improvement across both.",
      defaultTier: "balanced",
      options: [
        {
          id: "roads",
          label: "Roads Priority",
          description:
            "Concentrate infrastructure spending on roads. Road conditions improve faster but broadband investment stalls.",
          effects: { roadCondition: 0.03, broadbandAccess: -0.01 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Even infrastructure investment. No additional metric effects.",
          effects: {},
        },
        {
          id: "digital",
          label: "Digital Priority",
          description:
            "Concentrate infrastructure spending on digital connectivity. Broadband access improves faster but road maintenance slows.",
          effects: { broadbandAccess: 0.03, roadCondition: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Infrastructure Investment Priority",
      description:
        "Focus infrastructure spending on one region. That region receives accelerated road condition and broadband access improvement.",
      effects: { roadCondition: 0.05, broadbandAccess: 0.05 },
    },
    emergency: {
      name: "Emergency Road Repair",
      description:
        "Dispatch emergency repair crews to a region with poor road conditions, delivering a large temporary improvement to road condition.",
      cost: 1,
      duration: 24,
      effects: { roadCondition: 0.12 },
    },
  },

  // ── 11. Secretary of State for Environment, Food and Rural Affairs ─────────
  // ── Minister of Agriculture, Fisheries and Food (retired 2001 → DEFRA) ─────
  agriculture_secretary: {
    positionId: "agriculture_secretary",
    department: "Ministry of Agriculture, Fisheries and Food",
    departmentByYear: [
      { from: 1775, name: "Ministry of Agriculture and Fisheries" },
      { from: 1955, name: "Ministry of Agriculture, Fisheries and Food" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        format: "percent",
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

  environment_secretary: {
    positionId: "environment_secretary",
    department: "Dept for Environment, Food and Rural Affairs",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    nationalMetrics: [
      {
        category: "environment",
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "environment",
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Environmental Policy Stance",
      description:
        "Set the national environmental policy direction. Growth priority relaxes environmental constraints for short-term economic gain; green priority tightens constraints for faster emissions reduction at a slight economic cost.",
      defaultTier: "balanced",
      options: [
        {
          id: "growth_priority",
          label: "Growth Priority",
          description:
            "Relax environmental constraints to stimulate economic activity. Small GDP boost but carbon emissions increase.",
          effects: { gdpGrowth: 0.02, carbonEmissions: 0.03 },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced environmental policy. No additional metric effects.",
          effects: {},
        },
        {
          id: "green_priority",
          label: "Green Priority",
          description:
            "Tighten environmental constraints to accelerate decarbonisation. Carbon emissions reduce faster but GDP growth slows slightly.",
          effects: { carbonEmissions: -0.03, gdpGrowth: -0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Green Investment Zone",
      description:
        "Designate one region for enhanced environmental funding. That region receives accelerated carbon emissions reduction.",
      effects: { carbonEmissions: -0.06 },
    },
    emergency: {
      name: "Environmental Emergency Response",
      description:
        "Deploy emergency environmental response teams to a region with high carbon emissions, delivering a large temporary reduction.",
      cost: 1,
      duration: 24,
      effects: { carbonEmissions: -0.15 },
    },
  },

  // ── 12. Secretary of State for Work and Pensions ──────────────────────────
  work_secretary: {
    positionId: "work_secretary",
    department: "Dept for Work and Pensions",
    departmentByYear: [
      { from: 1775, name: "Ministry of Labour and National Service" },
      { from: 1959, name: "Ministry of Labour" },
      { from: 1968, name: "Dept of Employment" },
      { from: 2001, name: "Dept for Work and Pensions" },
    ],
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
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
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Welfare Policy Stance",
      description:
        "Set the national welfare policy. Generous support reduces unemployment faster but increases the cost of living through higher public spending; austere policy cuts costs but slows unemployment reduction.",
      defaultTier: "standard",
      options: [
        {
          id: "generous",
          label: "Generous",
          description:
            "Enhanced welfare support. Reduces unemployment faster but increases cost of living through higher benefit spending.",
          effects: { unemploymentRate: -0.02, costOfLiving: 0.02 },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Standard welfare provision. No additional metric effects.",
          effects: {},
        },
        {
          id: "austere",
          label: "Austere",
          description:
            "Reduced welfare spending. Lowers cost of living but slows unemployment reduction as support is scaled back.",
          effects: { costOfLiving: -0.02, unemploymentRate: 0.01 },
        },
      ],
    },
    regionalTarget: {
      name: "Jobs Programme Priority",
      description:
        "Focus employment support resources on one region. That region receives accelerated unemployment reduction.",
      effects: { unemploymentRate: -0.05 },
    },
    emergency: {
      name: "Emergency Employment Scheme",
      description:
        "Launch an emergency employment scheme in a region with high unemployment, delivering a significant temporary reduction in the unemployment rate.",
      cost: 1,
      duration: 24,
      effects: { unemploymentRate: -0.12 },
    },
  },

  // ── 13. Secretary of State for Northern Ireland ───────────────────────────
  northern_ireland: {
    positionId: "northern_ireland",
    department: "Northern Ireland Office",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/9/98/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28Tudor_Crown%29.svg",
    singleRegionFocus: "NIR",
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
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
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
      {
        category: "governance",
        metricId: "devolutionSatisfaction",
        label: "Devolution Satisfaction",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
    advocacy: {
      name: "Regional Advocacy",
      description:
        "Actively petition the Chancellor for increased Northern Ireland funding. While active, NIR receives a small boost to government approval and devolution satisfaction.",
      regionId: "NIR",
      effects: { governmentApproval: 0.03, devolutionSatisfaction: 0.04 },
    },
    emergency: {
      name: "Regional Investment Bid",
      description:
        "Submit a bid advocating for targeted investment in Northern Ireland, delivering a temporary GDP growth boost and unemployment reduction.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.05, unemploymentRate: -0.04 },
    },
  },

  // ── 14. Secretary of State for Scotland ───────────────────────────────────
  scotland: {
    positionId: "scotland",
    department: "Scotland Office",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/1/13/Royal_Coat_of_Arms_of_the_United_Kingdom_%28Government_in_Scotland%29.svg",
    singleRegionFocus: "SCO",
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
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
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
      {
        category: "governance",
        metricId: "devolutionSatisfaction",
        label: "Devolution Satisfaction",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
    advocacy: {
      name: "Regional Advocacy",
      description:
        "Actively petition the Chancellor for increased Scotland funding. While active, SCO receives a small boost to government approval and devolution satisfaction.",
      regionId: "SCO",
      effects: { governmentApproval: 0.03, devolutionSatisfaction: 0.04 },
    },
    emergency: {
      name: "Regional Investment Bid",
      description:
        "Submit a bid advocating for targeted investment in Scotland, delivering a temporary GDP growth boost and unemployment reduction.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.05, unemploymentRate: -0.04 },
    },
  },

  // ── 15. Secretary of State for Wales ──────────────────────────────────────
  wales: {
    positionId: "wales",
    department: "Wales Office",
    sealImage:
      "https://upload.wikimedia.org/wikipedia/commons/3/37/Royal_Badge_of_Wales_%282024_onwards%29.svg",
    singleRegionFocus: "WAL",
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
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
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
      {
        category: "governance",
        metricId: "devolutionSatisfaction",
        label: "Devolution Satisfaction",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [],
    advocacy: {
      name: "Regional Advocacy",
      description:
        "Actively petition the Chancellor for increased Wales funding. While active, WAL receives a small boost to government approval and devolution satisfaction.",
      regionId: "WAL",
      effects: { governmentApproval: 0.03, devolutionSatisfaction: 0.04 },
    },
    emergency: {
      name: "Regional Investment Bid",
      description:
        "Submit a bid advocating for targeted investment in Wales, delivering a temporary GDP growth boost and unemployment reduction.",
      cost: 1,
      duration: 24,
      effects: { gdpGrowth: 0.05, unemploymentRate: -0.04 },
    },
  },
  director_of_intelligence: {
    positionId: "director_of_intelligence",
    department: "Secret Intelligence Service",
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
