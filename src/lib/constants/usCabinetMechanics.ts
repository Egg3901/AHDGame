/**
 * US Cabinet mechanics configuration.
 * Drives the per-position Office page: national/regional metrics, tier settings,
 * regional target mechanics, allocation panels, and emergencies.
 * Imported by briefing API, settings routes, turn processing, and the UI.
 *
 * Shared types live in cabinetMechanicsTypes.ts.
 */

import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";

// ── Master mechanics map ─────────────────────────────────────────────────────

export const US_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = {
  // ── 1. Secretary of State ────────────────────────────────────────────────
  secretary_of_state: {
    positionId: "secretary_of_state",
    department: "U.S. Department of State",
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
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "mediaInformation",
        metricId: "pressFreedom",
        label: "Press Freedom",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "civicParticipation",
        label: "Civic Participation",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "mediaInformation",
        metricId: "mediaPolarization",
        label: "Media Polarization",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "civicParticipation",
        label: "Civic Participation",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Diplomatic Stance",
      description:
        "Set the national diplomatic posture. Multilateral engagement boosts transparency and civic participation but slightly increases media polarization; isolationist focus reduces polarization but lowers public trust.",
      defaultTier: "balanced",
      options: [
        {
          id: "isolationist",
          label: "Isolationist",
          description:
            "Reduce foreign commitments. Lowers media polarization but erodes public trust in government.",
          effects: {
            "mediaInformation.mediaPolarization": -0.02,
            "governance.publicTrust": -0.02,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Pragmatic engagement. No additional metric effects.",
          effects: {},
        },
        {
          id: "multilateral",
          label: "Multilateral",
          description:
            "Pursue broad international cooperation. Boosts government transparency but increases media polarization from foreign policy debate.",
          effects: {
            "governance.governmentTransparency": 0.02,
            "mediaInformation.mediaPolarization": 0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Civic Engagement Initiative",
      description:
        "Launch a civic engagement program in one state, boosting civic participation and public trust in that region.",
      effects: { "social.civicParticipation": 0.04, "governance.publicTrust": 0.02 },
    },
    emergency: {
      name: "Diplomatic Crisis Response",
      description:
        "Activate emergency diplomatic resources to address a crisis, temporarily boosting public trust and government transparency.",
      cost: 1,
      duration: 24,
      effects: { "governance.publicTrust": 0.08, "governance.governmentTransparency": 0.05 },
    },
  },

  // ── 2. Secretary of the Treasury ─────────────────────────────────────────
  secretary_of_treasury: {
    positionId: "secretary_of_treasury",
    department: "U.S. Department of the Treasury",
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
        metricId: "medianIncome",
        label: "Median Household Income",
        format: "number",
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
        category: "governance",
        metricId: "budgetBalance",
        label: "Budget Balance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
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
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Fiscal Policy",
      description:
        "Set the federal fiscal stance. Expansionary spending boosts GDP and reduces poverty but worsens the budget balance; austerity improves fiscal health but slows growth.",
      defaultTier: "moderate",
      options: [
        {
          id: "austerity",
          label: "Austerity",
          description:
            "Tight fiscal discipline. Improves budget balance but slows GDP growth and increases poverty pressure.",
          effects: {
            "governance.budgetBalance": 0.03,
            "economic.gdpGrowth": -0.02,
            "economic.povertyRate": 0.01,
          },
        },
        {
          id: "moderate",
          label: "Moderate",
          description: "Balanced fiscal approach. No additional metric effects.",
          effects: {},
        },
        {
          id: "expansionary",
          label: "Expansionary",
          description:
            "Increased federal spending. Boosts GDP growth and reduces poverty but worsens the deficit.",
          effects: {
            "economic.gdpGrowth": 0.02,
            "economic.povertyRate": -0.01,
            "governance.budgetBalance": -0.03,
          },
        },
      ],
    },
    allocation: {
      name: "Federal Grants Allocation",
      description:
        "Allocate the federal grants pool across all 50 states. Each state receives a percentage of the total pool. Must sum to 100%.",
      poolLabel: "Federal Grants Pool",
    },
    regionalTarget: {
      name: "Economic Development Zone",
      description:
        "Designate one state for targeted economic development grants, boosting GDP growth and reducing poverty in that region.",
      effects: { "economic.gdpGrowth": 0.04, "economic.povertyRate": -0.03 },
    },
    emergency: {
      name: "Emergency Economic Stimulus",
      description:
        "Deploy emergency stimulus funding to a state experiencing economic distress, delivering a large temporary GDP boost.",
      cost: 1,
      duration: 24,
      effects: { "economic.gdpGrowth": 0.08, "economic.costOfLiving": -0.04 },
    },
    bondProfile: {
      name: "Sovereign Bond Maturity Profile",
      description:
        "Set the split of quarterly sovereign debt issuance across 1-year, 2-year, and 5-year maturities.",
    },
  },

  // ── 3. Secretary of Defense ──────────────────────────────────────────────
  secretary_of_defense: {
    positionId: "secretary_of_defense",
    department: "U.S. Department of Defense",
    nationalMetrics: [
      {
        category: "governance",
        metricId: "budgetBalance",
        label: "Budget Balance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety Confidence",
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
        category: "social",
        metricId: "socialCohesion",
        label: "Social Cohesion",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety Confidence",
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
    tierSetting: {
      name: "Military Readiness",
      description:
        "Set the national military readiness posture. Elevated readiness boosts public safety confidence but increases fiscal pressure; reduced readiness saves budget at the cost of public confidence.",
      defaultTier: "standard",
      options: [
        {
          id: "reduced",
          label: "Reduced",
          description:
            "Scaled-back military operations — lower force upkeep and readiness across the order of battle.",
          effects: {},
        },
        {
          id: "standard",
          label: "Standard",
          description: "Normal operational readiness across the force.",
          effects: {},
        },
        {
          id: "elevated",
          label: "Elevated",
          description: "Heightened military readiness — higher force readiness, at greater upkeep.",
          effects: {},
        },
      ],
    },
    regionalTarget: {
      name: "Military Base Investment",
      description:
        "Expand military facilities in one state. That state benefits from improved public trust and social cohesion through military employment and community presence.",
      effects: { "governance.publicTrust": 0.03, "social.socialCohesion": 0.03 },
    },
    emergency: {
      name: "National Guard Deployment",
      description:
        "Deploy National Guard units to a state facing a crisis, delivering a large temporary boost to public safety confidence.",
      cost: 1,
      duration: 24,
      effects: { "publicSafety.publicSafetyConfidence": 0.12 },
      sideEffects: { "social.socialCohesion": -0.04 },
    },
  },

  // ── 4. Attorney General ──────────────────────────────────────────────────
  attorney_general: {
    positionId: "attorney_general",
    department: "U.S. Department of Justice",
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
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "incarcerationRate",
        label: "Incarceration Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "publicSafety",
        metricId: "recidivismRate",
        label: "Recidivism Rate",
        format: "percent",
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
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
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
      name: "Enforcement Priority",
      description:
        "Set the federal enforcement priority. Tough-on-crime reduces crime rates but increases incarceration; rehabilitation focus lowers incarceration and recidivism but allows crime to creep up.",
      defaultTier: "balanced",
      options: [
        {
          id: "rehabilitation",
          label: "Rehabilitation",
          description:
            "Focus on reform and reentry programs. Reduces incarceration and recidivism but crime rate increases slightly.",
          effects: {
            "publicSafety.incarcerationRate": -0.02,
            "publicSafety.recidivismRate": -0.02,
            "publicSafety.crimeRate": 0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced enforcement approach. No additional metric effects.",
          effects: {},
        },
        {
          id: "tough_on_crime",
          label: "Tough on Crime",
          description:
            "Aggressive prosecution and sentencing. Reduces crime rate but increases incarceration.",
          effects: {
            "publicSafety.crimeRate": -0.02,
            "publicSafety.violentCrimeRate": -0.01,
            "publicSafety.incarcerationRate": 0.02,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Anti-Corruption Task Force",
      description:
        "Deploy a federal anti-corruption task force to one state, accelerating improvement in the corruption index.",
      effects: { "governance.corruptionIndex": -0.05 },
    },
    emergency: {
      name: "Federal Law Enforcement Surge",
      description:
        "Surge federal law enforcement resources into a state with critically high crime, delivering a large temporary crime reduction.",
      cost: 1,
      duration: 24,
      effects: { "publicSafety.crimeRate": -0.12, "publicSafety.violentCrimeRate": -0.08 },
      regionMetricThreshold: { metric: "publicSafety.crimeRate", above: 5500 }, // per-100k (P3b: 60 was the pre-S1 clamped scale — always true on real values)
      sideEffects: { "publicSafety.incarcerationRate": 0.04 },
    },
  },

  // ── 5. Secretary of the Interior ─────────────────────────────────────────
  secretary_of_interior: {
    positionId: "secretary_of_interior",
    department: "U.S. Department of the Interior",
    nationalMetrics: [
      {
        category: "environment",
        metricId: "protectedLand",
        label: "Protected Land",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "climateResilience",
        label: "Climate Resilience",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "recyclingRate",
        label: "Recycling Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy Share",
        format: "percent",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "environment",
        metricId: "protectedLand",
        label: "Protected Land",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        format: "index",
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
    tierSetting: {
      name: "Conservation Stance",
      description:
        "Set the federal land management priority. Preservation expands protected areas and improves climate resilience but restricts economic activity; extraction opens land for development but degrades environmental metrics.",
      defaultTier: "balanced",
      options: [
        {
          id: "extraction",
          label: "Extraction",
          description:
            "Open federal lands for resource development. Reduces protected land and air quality but boosts regional economic activity.",
          // airQuality is an AQI — LOWER is better; extraction RAISES it (P3c sign fix).
          effects: {
            "environment.protectedLand": -0.02,
            "environment.airQuality": 0.02,
            "economic.gdpGrowth": 0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Mixed-use land management. No additional metric effects.",
          effects: {},
        },
        {
          id: "preservation",
          label: "Preservation",
          description:
            "Expand conservation areas and tighten environmental regulations. Increases protected land and air quality but slows economic growth.",
          // airQuality is an AQI — LOWER is better; preservation LOWERS it (P3c sign fix).
          effects: {
            "environment.protectedLand": 0.02,
            "environment.airQuality": -0.02,
            "economic.gdpGrowth": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Conservation Investment",
      description:
        "Direct federal conservation funding to one state, boosting protected land and climate resilience in that region.",
      effects: { "environment.protectedLand": 0.04, "environment.climateResilience": 0.03 },
    },
    emergency: {
      name: "Environmental Disaster Response",
      description:
        "Deploy emergency environmental cleanup resources to a state facing an ecological crisis, delivering a large temporary boost to air quality and climate resilience.",
      cost: 1,
      duration: 24,
      effects: { "environment.airQuality": 0.1, "environment.climateResilience": 0.06 },
    },
  },

  // ── 6. Secretary of Agriculture ──────────────────────────────────────────
  secretary_of_agriculture: {
    positionId: "secretary_of_agriculture",
    department: "U.S. Department of Agriculture",
    nationalMetrics: [
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity Rate",
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
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "protectedLand",
        label: "Protected Land",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity Rate",
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
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Farm Policy",
      description:
        "Set the federal agricultural policy direction. Subsidized farming reduces food insecurity and poverty but increases spending; market-driven policy boosts small business formation but allows food insecurity to rise.",
      defaultTier: "balanced",
      options: [
        {
          id: "market_driven",
          label: "Market-Driven",
          description:
            "Reduce farm subsidies and let markets set prices. Boosts small business formation but food insecurity rises.",
          effects: {
            "economic.smallBusinessFormation": 0.02,
            "social.foodInsecurity": 0.02,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced agricultural support. No additional metric effects.",
          effects: {},
        },
        {
          id: "subsidized",
          label: "Subsidized",
          description:
            "Expand farm subsidies and nutrition programs. Reduces food insecurity but slightly reduces small business formation.",
          effects: {
            "social.foodInsecurity": -0.02,
            "economic.povertyRate": -0.01,
            "economic.smallBusinessFormation": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Rural Development Grant",
      description:
        "Direct rural development funding to one state, reducing food insecurity and poverty in that region.",
      effects: { "social.foodInsecurity": -0.04, "economic.povertyRate": -0.03 },
    },
    emergency: {
      name: "Emergency Food Assistance",
      description:
        "Deploy emergency food distribution and nutrition assistance to a state facing acute food insecurity.",
      cost: 1,
      duration: 24,
      effects: { "social.foodInsecurity": -0.1, "economic.povertyRate": -0.04 },
    },
  },

  // ── 7. Secretary of Commerce ─────────────────────────────────────────────
  secretary_of_commerce: {
    positionId: "secretary_of_commerce",
    department: "U.S. Department of Commerce",
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
        label: "Small Business Formation",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Income",
        format: "number",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "population",
        metricId: "populationGrowth",
        label: "Population Growth",
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
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Trade Policy",
      description:
        "Set the national trade stance. Protectionist policy supports domestic industry at the cost of higher consumer prices; free trade reduces prices but increases competitive pressure on domestic firms.",
      defaultTier: "balanced",
      options: [
        {
          id: "protectionist",
          label: "Protectionist",
          description:
            "Domestic-first trade policy. Boosts small business formation but increases cost of living through tariffs.",
          effects: {
            "economic.smallBusinessFormation": 0.02,
            "economic.costOfLiving": 0.02,
            "economic.gdpGrowth": 0.01,
          },
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
            "Open trade policy. Reduces cost of living through cheaper imports but slightly reduces domestic business formation.",
          effects: {
            "economic.costOfLiving": -0.02,
            "economic.smallBusinessFormation": -0.01,
            "economic.gdpGrowth": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Enterprise Zone",
      description:
        "Designate one state as a federal enterprise zone. Businesses in that state receive investment benefits, delivering a GDP growth boost.",
      effects: { "economic.gdpGrowth": 0.04, "economic.smallBusinessFormation": 0.03 },
    },
    emergency: {
      name: "Emergency Business Relief",
      description:
        "Deploy emergency small business grants and trade relief in a state experiencing economic hardship, delivering a temporary GDP boost.",
      cost: 1,
      duration: 24,
      effects: { "economic.gdpGrowth": 0.06, "economic.costOfLiving": -0.04 },
    },
  },

  // ── 8. Secretary of Labor ────────────────────────────────────────────────
  secretary_of_labor: {
    positionId: "secretary_of_labor",
    department: "U.S. Department of Labor",
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
        label: "Median Household Income",
        format: "number",
        higherIsBetter: true,
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
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Workplace Safety Confidence",
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
        category: "economic",
        metricId: "medianIncome",
        label: "Median Household Income",
        format: "number",
        higherIsBetter: true,
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
      name: "Labor Policy",
      description:
        "Set the federal labor regulatory stance. Pro-worker regulations increase wages and reduce inequality but raise unemployment; deregulation boosts employment but widens income inequality.",
      defaultTier: "balanced",
      options: [
        {
          id: "deregulated",
          label: "Deregulated",
          description:
            "Ease labor regulations. Reduces unemployment but widens income inequality and lowers workplace safety.",
          effects: {
            "economic.unemploymentRate": -0.02,
            "social.incomeInequality": 0.02,
            "publicSafety.publicSafetyConfidence": -0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced labor regulation. No additional metric effects.",
          effects: {},
        },
        {
          id: "pro_worker",
          label: "Pro-Worker",
          description:
            "Strengthen worker protections and minimum wage. Reduces inequality and boosts wages but slightly increases unemployment.",
          effects: {
            "social.incomeInequality": -0.02,
            "economic.medianIncome": 0.01,
            "economic.unemploymentRate": 0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Workforce Development Program",
      description:
        "Direct federal job training and workforce development funding to one state, reducing unemployment and boosting social mobility.",
      effects: { "economic.unemploymentRate": -0.04, "social.socialMobility": 0.03 },
    },
    emergency: {
      name: "Emergency Jobs Program",
      description:
        "Deploy emergency federal employment and retraining programs to a state facing high unemployment.",
      cost: 1,
      duration: 24,
      effects: { "economic.unemploymentRate": -0.1, "social.socialMobility": 0.04 },
    },
  },

  // ── 9. Secretary of Health and Human Services ────────────────────────────
  secretary_of_health: {
    positionId: "secretary_of_health",
    department: "U.S. Department of Health and Human Services",
    departmentByYear: [
      { from: 1953, name: "U.S. Department of Health, Education, and Welfare" },
      { from: 1980, name: "U.S. Department of Health and Human Services" },
    ],
    nationalMetrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "healthcare",
        metricId: "lifeExpectancy",
        label: "Life Expectancy",
        format: "number",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "affordabilityIndex",
        label: "Healthcare Affordability",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "preventableMortality",
        label: "Preventable Mortality",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Public Health Preparedness",
        format: "index",
        higherIsBetter: true,
      },
      // HEW-era education + welfare readouts (split off by the Department of Education Act).
      {
        category: "education",
        metricId: "highSchoolGradRate",
        label: "High School Graduation Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill Level",
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
        metricId: "incomeInequality",
        label: "Income Inequality",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "healthcare",
        metricId: "affordabilityIndex",
        label: "Healthcare Affordability",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Public Health Preparedness",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Healthcare Model",
      description:
        "Set the federal healthcare policy direction. Public expansion reduces uninsured rates and improves affordability but increases government spending; market-based approach reduces costs but leaves more people uninsured.",
      defaultTier: "balanced",
      options: [
        {
          id: "market_based",
          label: "Market-Based",
          description:
            "Reduce government health programs and promote private insurance. Improves affordability index through competition but uninsured rate rises.",
          effects: {
            "healthcare.affordabilityIndex": 0.01,
            "healthcare.uninsuredRate": 0.02,
            "governance.budgetBalance": 0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced public-private healthcare model. No additional metric effects.",
          effects: {},
        },
        {
          id: "public_expansion",
          label: "Public Expansion",
          description:
            "Expand public health coverage. Reduces uninsured rate and improves preparedness but increases fiscal pressure.",
          effects: {
            "healthcare.uninsuredRate": -0.02,
            "healthcare.publicHealthPreparedness": 0.01,
            "governance.budgetBalance": -0.01,
          },
        },
      ],
    },
    // HEW-era portfolios: while this seat is the unified Department of Health,
    // Education, and Welfare it carries education and welfare policy levers on
    // top of its healthcare tier. A "Department of Education Act" bill later
    // splits these off (see legislationEffects create_department + rosterEra).
    tierSettings: [
      {
        key: "education",
        name: "Education Focus",
        description:
          "Set the federal education policy direction. Vocational focus improves near-term workforce skills; academic focus builds long-term test performance and college enrollment; balanced delivers steady improvement across both.",
        defaultTier: "balanced",
        options: [
          {
            id: "vocational",
            label: "Vocational",
            description:
              "Prioritize trade and vocational training. Boosts workforce skill faster but reduces academic test performance emphasis.",
            effects: {
              "education.workforceSkill": 0.03,
              "education.testPerformance": -0.01,
              "education.universityEnrollment": -0.01,
            },
          },
          {
            id: "balanced",
            label: "Balanced",
            description: "Balanced curriculum approach. No additional metric effects.",
            effects: {},
          },
          {
            id: "academic",
            label: "Academic",
            description:
              "Prioritize academic excellence and college preparation. Accelerates test performance and college enrollment but does not directly help workforce skills.",
            effects: {
              "education.testPerformance": 0.02,
              "education.universityEnrollment": 0.02,
              "education.workforceSkill": -0.01,
            },
          },
        ],
      },
      {
        key: "welfare",
        name: "Welfare Model",
        description:
          "Set federal welfare and transfer generosity. Broad transfers cut poverty and inequality and lift mobility but weigh on the budget; lean transfers ease fiscal pressure at the cost of higher poverty and inequality.",
        defaultTier: "standard",
        options: [
          {
            id: "lean",
            label: "Lean",
            description:
              "Trim transfer programs. Eases the budget but poverty and income inequality drift up.",
            effects: {
              "economic.povertyRate": 0.02,
              "social.incomeInequality": 0.01,
              "governance.budgetBalance": 0.01,
            },
          },
          {
            id: "standard",
            label: "Standard",
            description: "Maintain existing transfer programs. No additional metric effects.",
            effects: {},
          },
          {
            id: "broad",
            label: "Broad",
            description:
              "Expand transfers and the social safety net. Cuts poverty and inequality and lifts social mobility, but increases fiscal pressure.",
            effects: {
              "economic.povertyRate": -0.02,
              "social.incomeInequality": -0.02,
              "social.socialMobility": 0.02,
              "governance.budgetBalance": -0.02,
            },
          },
        ],
      },
    ],
    regionalTarget: {
      name: "Public Health Campaign",
      description:
        "Launch a focused public health campaign in one state, delivering a targeted improvement in healthcare affordability and preparedness.",
      effects: {
        "healthcare.affordabilityIndex": 0.04,
        "healthcare.publicHealthPreparedness": 0.03,
      },
    },
    emergency: {
      name: "Public Health Emergency",
      description:
        "Declare a public health emergency in a state, deploying federal medical resources to dramatically reduce preventable mortality and boost preparedness.",
      cost: 1,
      duration: 24,
      effects: {
        "healthcare.preventableMortality": -0.1,
        "healthcare.publicHealthPreparedness": 0.08,
      },
    },
  },

  // ── 10. Secretary of Housing and Urban Development ───────────────────────
  secretary_of_hud: {
    positionId: "secretary_of_hud",
    department: "U.S. Department of Housing and Urban Development",
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
        label: "Cost of Living Index",
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
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
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
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
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
    ],
    tierSetting: {
      name: "Housing Stance",
      description:
        "Set the federal housing policy direction. Affordable housing investment reduces homelessness and cost of living but increases spending; deregulation promotes development but may widen inequality.",
      defaultTier: "balanced",
      options: [
        {
          id: "deregulated",
          label: "Deregulated",
          description:
            "Reduce housing regulations to spur development. Lowers cost of living but does less to address homelessness directly.",
          effects: {
            "economic.costOfLiving": -0.02,
            "social.homelessnessRate": 0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced housing policy. No additional metric effects.",
          effects: {},
        },
        {
          id: "affordable_focus",
          label: "Affordable Focus",
          description:
            "Invest heavily in affordable housing and homelessness programs. Reduces homelessness but increases cost pressure on housing markets.",
          effects: {
            "social.homelessnessRate": -0.02,
            "economic.povertyRate": -0.01,
            "economic.costOfLiving": 0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Urban Renewal Project",
      description:
        "Direct federal urban renewal funding to one state, reducing homelessness and boosting social mobility in that region.",
      effects: { "social.homelessnessRate": -0.04, "social.socialMobility": 0.03 },
    },
    emergency: {
      name: "Emergency Housing Assistance",
      description:
        "Deploy emergency housing vouchers and temporary shelters to a state facing a homelessness crisis.",
      cost: 1,
      duration: 24,
      effects: { "social.homelessnessRate": -0.1, "economic.povertyRate": -0.04 },
    },
  },

  // ── 11. Secretary of Transportation ──────────────────────────────────────
  secretary_of_transportation: {
    positionId: "secretary_of_transportation",
    department: "U.S. Department of Transportation",
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
        label: "Public Transit Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Infrastructure Investment Gap",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
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
        metricId: "roadCondition",
        label: "Road Condition",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "publicTransit",
        label: "Public Transit Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Infrastructure Investment Gap",
        format: "index",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Infrastructure Focus",
      description:
        "Set the national infrastructure investment priority. Highway focus improves road conditions but neglects transit; transit focus improves public transit but diverts highway funding.",
      defaultTier: "balanced",
      options: [
        {
          id: "highway_focus",
          label: "Highway Focus",
          description:
            "Prioritize highway and road investment. Improves road conditions but public transit quality declines.",
          effects: {
            "infrastructure.roadCondition": 0.03,
            "infrastructure.publicTransit": -0.02,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced infrastructure spending. No additional metric effects.",
          effects: {},
        },
        {
          id: "transit_focus",
          label: "Transit Focus",
          description:
            "Prioritize public transit and rail. Improves transit quality but road maintenance receives less funding.",
          effects: {
            "infrastructure.publicTransit": 0.03,
            "infrastructure.roadCondition": -0.02,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Infrastructure Investment Package",
      description:
        "Direct federal infrastructure funding to one state, closing the investment gap and improving road conditions in that region.",
      effects: {
        "infrastructure.infrastructureInvestmentGap": -0.05,
        "infrastructure.roadCondition": 0.03,
      },
    },
    emergency: {
      name: "Emergency Infrastructure Repair",
      description:
        "Deploy emergency repair and reconstruction resources to a state following infrastructure failure or natural disaster.",
      cost: 1,
      duration: 24,
      effects: {
        "infrastructure.roadCondition": 0.1,
        "infrastructure.powerGridReliability": 0.06,
      },
    },
  },

  // ── 12. Secretary of Energy ──────────────────────────────────────────────
  secretary_of_energy: {
    positionId: "secretary_of_energy",
    department: "U.S. Department of Energy",
    nationalMetrics: [
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy Share",
        format: "percent",
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
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Infrastructure Investment Gap",
        format: "index",
        higherIsBetter: false,
      },
    ],
    regionalMetrics: [
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy Share",
        format: "percent",
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
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Energy Policy",
      description:
        "Set the national energy strategy. Green transition accelerates renewable adoption and reduces emissions but strains grid reliability during transition; fossil focus maintains grid stability but increases emissions.",
      defaultTier: "balanced",
      options: [
        {
          id: "fossil_focus",
          label: "Fossil Focus",
          description:
            "Maintain fossil fuel infrastructure. Keeps grid reliability high but renewable energy stalls and emissions increase.",
          effects: {
            "infrastructure.powerGridReliability": 0.02,
            "environment.renewableEnergy": -0.02,
            "environment.carbonEmissions": 0.02,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "All-of-the-above energy strategy. No additional metric effects.",
          effects: {},
        },
        {
          id: "green_transition",
          label: "Green Transition",
          description:
            "Accelerate renewable energy development. Boosts renewable share and reduces emissions but grid reliability faces transition pressure.",
          effects: {
            "environment.renewableEnergy": 0.03,
            "environment.carbonEmissions": -0.02,
            "infrastructure.powerGridReliability": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Clean Energy Investment",
      description:
        "Direct federal clean energy funding to one state, boosting renewable energy share and reducing carbon emissions in that region.",
      effects: { "environment.renewableEnergy": 0.05, "environment.carbonEmissions": -0.03 },
    },
    emergency: {
      name: "Emergency Grid Stabilization",
      description:
        "Deploy emergency resources to stabilize power grid infrastructure in a state facing reliability failures.",
      cost: 1,
      duration: 24,
      effects: {
        "infrastructure.powerGridReliability": 0.1,
        "infrastructure.infrastructureInvestmentGap": -0.05,
      },
    },
  },

  // ── 13. Secretary of Education ───────────────────────────────────────────
  secretary_of_education: {
    positionId: "secretary_of_education",
    department: "U.S. Department of Education",
    nationalMetrics: [
      {
        category: "education",
        metricId: "highSchoolGradRate",
        label: "High School Graduation Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "universityEnrollment",
        label: "College Enrollment Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "testPerformance",
        label: "Academic Test Performance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "educationSpending",
        label: "Education Spending",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill Level",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "education",
        metricId: "highSchoolGradRate",
        label: "High School Graduation Rate",
        format: "percent",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "testPerformance",
        label: "Academic Test Performance",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill Level",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Education Focus",
      description:
        "Set the federal education policy direction. Vocational focus improves near-term workforce skills; academic focus builds long-term test performance and college enrollment; balanced delivers steady improvement across both.",
      defaultTier: "balanced",
      options: [
        {
          id: "vocational",
          label: "Vocational",
          description:
            "Prioritize trade and vocational training. Boosts workforce skill faster but reduces academic test performance emphasis.",
          effects: {
            "education.workforceSkill": 0.03,
            "education.testPerformance": -0.01,
            "education.universityEnrollment": -0.01,
          },
        },
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced curriculum approach. No additional metric effects.",
          effects: {},
        },
        {
          id: "academic",
          label: "Academic",
          description:
            "Prioritize academic excellence and college preparation. Accelerates test performance and college enrollment but does not directly help workforce skills.",
          effects: {
            "education.testPerformance": 0.02,
            "education.universityEnrollment": 0.02,
            "education.workforceSkill": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Education Investment Priority",
      description:
        "Direct enhanced education funding to one state. That state receives accelerated improvement in graduation rates and test performance.",
      effects: {
        "education.highSchoolGradRate": 0.04,
        "education.testPerformance": 0.03,
      },
    },
    emergency: {
      name: "Emergency Education Initiative",
      description:
        "Launch an emergency education program in a state, delivering a significant temporary boost to graduation rates and workforce skill development.",
      cost: 1,
      duration: 24,
      effects: { "education.highSchoolGradRate": 0.06, "education.workforceSkill": 0.08 },
    },
  },

  // ── 14. Secretary of Veterans Affairs ────────────────────────────────────
  secretary_of_veterans: {
    positionId: "secretary_of_veterans",
    department: "U.S. Department of Veterans Affairs",
    nationalMetrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "healthcare",
        metricId: "affordabilityIndex",
        label: "Healthcare Affordability",
        format: "index",
        higherIsBetter: true,
      },
      {
        category: "healthcare",
        metricId: "physicianRate",
        label: "Physician Access Rate",
        format: "rate",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "index",
        higherIsBetter: true,
      },
    ],
    regionalMetrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        format: "percent",
        higherIsBetter: false,
      },
      {
        category: "healthcare",
        metricId: "physicianRate",
        label: "Physician Access Rate",
        format: "rate",
        higherIsBetter: true,
      },
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        format: "rate",
        higherIsBetter: false,
      },
    ],
    tierSetting: {
      name: "Veterans Funding",
      description:
        "Set the federal veterans services funding level. Expanded funding improves healthcare access and reduces veteran homelessness but increases spending; streamlined approach saves budget but reduces service quality.",
      defaultTier: "standard",
      options: [
        {
          id: "streamlined",
          label: "Streamlined",
          description:
            "Reduce VA overhead and consolidate services. Saves budget but physician access and coverage decline.",
          effects: {
            "governance.budgetBalance": 0.01,
            "healthcare.physicianRate": -0.02,
            "healthcare.uninsuredRate": 0.01,
          },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Maintain current veterans services level. No additional metric effects.",
          effects: {},
        },
        {
          id: "expanded",
          label: "Expanded",
          description:
            "Expand VA healthcare and benefits programs. Improves physician access and reduces homelessness but adds fiscal pressure.",
          effects: {
            "healthcare.physicianRate": 0.02,
            "social.homelessnessRate": -0.01,
            "governance.budgetBalance": -0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Veterans Services Hub",
      description:
        "Establish an enhanced veterans services hub in one state, improving physician access and reducing veteran homelessness in that region.",
      effects: { "healthcare.physicianRate": 0.04, "social.homelessnessRate": -0.03 },
    },
    emergency: {
      name: "Emergency Veterans Outreach",
      description:
        "Deploy emergency veterans healthcare and housing outreach to a state facing acute service gaps.",
      cost: 1,
      duration: 24,
      effects: {
        "healthcare.physicianRate": 0.08,
        "social.homelessnessRate": -0.06,
        "governance.publicTrust": 0.04,
      },
    },
  },

  // ── 15. Secretary of Homeland Security ───────────────────────────────────
  secretary_of_homeland: {
    positionId: "secretary_of_homeland",
    department: "U.S. Department of Homeland Security",
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
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        format: "rate",
        higherIsBetter: false,
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
        metricId: "corruptionIndex",
        label: "Corruption Index",
        format: "index",
        higherIsBetter: false,
      },
      {
        category: "population",
        metricId: "migrationRate",
        label: "Migration Rate",
        format: "rate",
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
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        format: "rate",
        higherIsBetter: false,
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        format: "index",
        higherIsBetter: true,
      },
    ],
    tierSetting: {
      name: "Security Level",
      description:
        "Set the national security posture. Heightened security reduces crime and violence but restricts migration and increases cost of living; relaxed stance promotes openness but may allow crime to increase.",
      defaultTier: "standard",
      options: [
        {
          id: "relaxed",
          label: "Relaxed",
          description:
            "Lighter security enforcement. Boosts migration rate and reduces cost of living pressure but crime rate increases slightly.",
          effects: {
            "population.migrationRate": 0.02,
            "publicSafety.crimeRate": 0.02,
            "economic.costOfLiving": -0.01,
          },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Balanced security enforcement. No additional metric effects.",
          effects: {},
        },
        {
          id: "heightened",
          label: "Heightened",
          description:
            "Enhanced security measures. Reduces crime rate but restricts migration and increases cost of living.",
          effects: {
            "publicSafety.crimeRate": -0.02,
            "population.migrationRate": -0.02,
            "economic.costOfLiving": 0.01,
          },
        },
      ],
    },
    regionalTarget: {
      name: "Border Security Initiative",
      description:
        "Focus federal security resources on one state, reducing crime and boosting public trust in that region.",
      effects: { "publicSafety.crimeRate": -0.04, "governance.publicTrust": 0.03 },
    },
    emergency: {
      name: "Emergency Security Declaration",
      description:
        "Declare a security emergency in a state with critically high crime, deploying federal agents for a large temporary crime reduction.",
      cost: 1,
      duration: 24,
      effects: {
        "publicSafety.crimeRate": -0.12,
        "publicSafety.violentCrimeRate": -0.08,
      },
      regionMetricThreshold: { metric: "publicSafety.crimeRate", above: 5500 }, // per-100k (P3b: 60 was the pre-S1 clamped scale — always true on real values)
      sideEffects: { "governance.publicTrust": -0.05 },
    },
  },
};
