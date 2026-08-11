/**
 * Soviet Union (RU) ministerial orders — Council of Ministers.
 *
 * Two orders per seat, matching the CN State Council file's shape: time-limited
 * metric modifiers costing one ministerial action each, 24 turns (one game
 * half-year).
 *
 * Effect metrics are BARE metric ids resolved through resolveMetricPath, not
 * the dotted paths ESTATE_CATALOG uses. Pinned by ruCabinetEffectPaths.test.ts.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";

export const RU_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  premier: [
    {
      id: "council_authority_campaign",
      name: "Council Authority Campaign",
      description:
        "Reassert the Council of Ministers' standing across the union republics through the party press.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ministerial_discipline_drive",
      name: "Ministerial Discipline Drive",
      description:
        "Audit ministry reporting and tighten inter-ministry coordination across the Council.",
      duration: 24,
      effects: [
        { metric: "governmentTransparency", modifier: 0.03, scope: "national" },
        { metric: "corruptionIndex", modifier: -0.02, scope: "national" },
      ],
    },
  ],

  first_deputy_premier: [
    {
      id: "plan_coordination_push",
      name: "Plan Coordination Push",
      description:
        "Convene the industrial ministries to unblock plan bottlenecks and pull hiring forward.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
        { metric: "unemploymentRate", modifier: -0.02, scope: "national" },
      ],
    },
    {
      id: "cadre_review",
      name: "Cadre Review",
      description:
        "Review ministry appointments for competence and loyalty, cutting graft and steadying confidence.",
      duration: 24,
      effects: [
        { metric: "corruptionIndex", modifier: -0.03, scope: "national" },
        { metric: "publicTrust", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_foreign_affairs: [
    {
      id: "diplomatic_offensive",
      name: "Diplomatic Offensive",
      description:
        "Open simultaneous negotiations abroad to widen trade access and raise the union's standing.",
      duration: 24,
      effects: [
        { metric: "tradeGrowth", modifier: 0.03, scope: "national" },
        { metric: "nationalPride", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "peace_congress",
      name: "Peace Congress",
      description:
        "Host an international peace congress, lifting national pride and public confidence.",
      duration: 24,
      effects: [
        { metric: "nationalPride", modifier: 0.03, scope: "national" },
        { metric: "publicTrust", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_defence: [
    {
      id: "readiness_exercise",
      name: "Readiness Exercise",
      description:
        "Run union-wide manoeuvres, raising military readiness and public confidence in defence.",
      duration: 24,
      effects: [
        { metric: "militaryReadiness", modifier: 0.04, scope: "national" },
        { metric: "publicSafetyConfidence", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "frontier_reinforcement",
      name: "Frontier Reinforcement",
      description: "Reinforce the western frontier districts, hardening the border.",
      duration: 24,
      effects: [
        { metric: "borderSecurity", modifier: 0.04, scope: "national" },
        { metric: "militaryReadiness", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_finance: [
    {
      id: "turnover_tax_adjustment",
      name: "Turnover Tax Adjustment",
      description:
        "Reweight the turnover tax toward consumer goods, easing household costs for a period.",
      duration: 24,
      effects: [
        { metric: "costOfLiving", modifier: -0.03, scope: "national" },
        { metric: "consumerConfidence", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "plan_financing_surge",
      name: "Plan Financing Surge",
      description:
        "Release reserve financing to the industrial ministries, lifting output and hiring.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.03, scope: "national" },
        { metric: "unemploymentRate", modifier: -0.02, scope: "national" },
      ],
    },
  ],

  minister_of_internal_affairs: [
    {
      id: "public_order_sweep",
      name: "Public Order Sweep",
      description: "Deploy the militia in force, cutting crime and steadying public confidence.",
      duration: 24,
      effects: [
        { metric: "crimeRate", modifier: -0.04, scope: "national" },
        { metric: "publicSafetyConfidence", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "internal_passport_audit",
      name: "Internal Passport Audit",
      description:
        "Audit residence and workplace registration, cutting corruption and violent crime.",
      duration: 24,
      effects: [
        { metric: "corruptionIndex", modifier: -0.03, scope: "national" },
        { metric: "violentCrimeRate", modifier: -0.02, scope: "national" },
      ],
    },
  ],

  chairman_of_gosplan: [
    {
      id: "plan_revision",
      name: "Mid-Plan Revision",
      description:
        "Reopen the control figures mid-plan, sharpening execution and lifting productivity.",
      duration: 24,
      effects: [
        { metric: "industrialPolicyExecution", modifier: 0.04, scope: "national" },
        { metric: "productivityGrowth", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "shock_work_campaign",
      name: "Shock Work Campaign",
      description:
        "Launch a union-wide production drive: output and hiring surge on mobilized labour.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.03, scope: "national" },
        { metric: "unemploymentRate", modifier: -0.02, scope: "national" },
      ],
    },
  ],

  gosbank_liaison: [
    {
      id: "currency_reform_tranche",
      name: "Currency Reform Tranche",
      description: "Withdraw excess currency from circulation, cooling price pressure.",
      duration: 24,
      effects: [
        { metric: "inflationPressure", modifier: -0.05, scope: "national" },
        { metric: "consumerConfidence", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "enterprise_credit_release",
      name: "Enterprise Credit Release",
      description: "Release working-capital credit to enterprises, lifting growth and investment.",
      duration: 24,
      effects: [
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
        { metric: "investorConfidence", modifier: 0.03, scope: "national" },
      ],
    },
  ],

  minister_of_foreign_trade: [
    {
      id: "hard_currency_drive",
      name: "Hard Currency Drive",
      description:
        "Push raw-material exports for convertible currency, improving the trade balance.",
      duration: 24,
      effects: [
        { metric: "tradeBalance", modifier: 0.04, scope: "national" },
        { metric: "tradeGrowth", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "technology_import_programme",
      name: "Technology Import Programme",
      description:
        "Buy foreign industrial plant, raising manufacturing competitiveness and productivity.",
      duration: 24,
      effects: [
        { metric: "manufacturingCompetitiveness", modifier: 0.03, scope: "national" },
        { metric: "productivityGrowth", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_internal_trade: [
    {
      id: "consumer_goods_release",
      name: "Consumer Goods Release",
      description: "Release reserve stocks to the shops, cutting costs and lifting confidence.",
      duration: 24,
      effects: [
        { metric: "costOfLiving", modifier: -0.04, scope: "national" },
        { metric: "consumerConfidence", modifier: 0.03, scope: "national" },
      ],
    },
    {
      id: "retail_network_expansion",
      name: "Retail Network Expansion",
      description: "Open new state retail outlets, absorbing labour and easing shortages.",
      duration: 24,
      effects: [
        { metric: "unemploymentRate", modifier: -0.03, scope: "national" },
        { metric: "costOfLiving", modifier: -0.015, scope: "national" },
      ],
    },
  ],

  minister_of_agriculture: [
    {
      id: "land_reclamation_drive",
      name: "Land Reclamation Drive",
      description:
        "Bring marginal land under the plough, raising food security and rural standing.",
      duration: 24,
      effects: [
        { metric: "foodSecurity", modifier: 0.04, scope: "national" },
        { metric: "ruralRevitalization", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "procurement_price_rise",
      name: "Procurement Price Rise",
      description:
        "Raise what the state pays collective farms, cutting food insecurity at some cost to prices.",
      duration: 24,
      effects: [
        { metric: "foodInsecurity", modifier: -0.04, scope: "national" },
        { metric: "costOfLiving", modifier: 0.015, scope: "national" },
      ],
    },
  ],

  minister_of_machine_building: [
    {
      id: "combine_output_drive",
      name: "Combine Output Drive",
      description:
        "Drive the heavy combines to over-fulfil quota: competitiveness and hiring rise, air quality suffers.",
      duration: 24,
      effects: [
        { metric: "manufacturingCompetitiveness", modifier: 0.04, scope: "national" },
        { metric: "unemploymentRate", modifier: -0.02, scope: "national" },
        // airQuality is an AQI: positive = dirtier.
        { metric: "airQuality", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "machine_tool_retooling",
      name: "Machine Tool Retooling",
      description: "Retool the machine-tool plants, lifting productivity and plan execution.",
      duration: 24,
      effects: [
        { metric: "productivityGrowth", modifier: 0.03, scope: "national" },
        { metric: "industrialPolicyExecution", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_railways: [
    {
      id: "trunk_line_electrification",
      name: "Trunk Line Electrification",
      description: "Electrify the main trunk lines, improving transport efficiency and growth.",
      duration: 24,
      effects: [
        { metric: "transportEfficiency", modifier: 0.04, scope: "national" },
        { metric: "gdpGrowth", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "freight_priority_order",
      name: "Freight Priority Order",
      description:
        "Give plan freight absolute priority on the network, closing the infrastructure gap.",
      duration: 24,
      effects: [
        { metric: "infrastructureInvestmentGap", modifier: -0.04, scope: "national" },
        { metric: "transportEfficiency", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_culture: [
    {
      id: "mass_literacy_campaign",
      name: "Mass Literacy Campaign",
      description: "Run a union-wide literacy drive through the houses of culture.",
      duration: 24,
      effects: [
        { metric: "literacyRate", modifier: 0.04, scope: "national" },
        { metric: "civicParticipation", modifier: 0.02, scope: "national" },
      ],
    },
    {
      id: "cultural_festival",
      name: "Union Cultural Festival",
      description: "Stage a festival of the peoples, building cohesion and national pride.",
      duration: 24,
      effects: [
        { metric: "socialCohesion", modifier: 0.03, scope: "national" },
        { metric: "nationalPride", modifier: 0.03, scope: "national" },
      ],
    },
  ],

  minister_of_health: [
    {
      id: "sanitation_campaign",
      name: "Sanitation Campaign",
      description: "Run a union-wide sanitation and vaccination drive, cutting preventable deaths.",
      duration: 24,
      effects: [
        { metric: "preventableMortality", modifier: -0.04, scope: "national" },
        { metric: "publicHealthPreparedness", modifier: 0.03, scope: "national" },
      ],
    },
    {
      id: "rural_physician_posting",
      name: "Rural Physician Posting",
      description: "Post newly qualified physicians to rural districts, widening coverage.",
      duration: 24,
      effects: [
        { metric: "physicianRate", modifier: 0.04, scope: "national" },
        { metric: "lifeExpectancy", modifier: 0.02, scope: "national" },
      ],
    },
  ],

  minister_of_higher_education: [
    {
      id: "technical_cadre_intake",
      name: "Technical Cadre Intake",
      description: "Expand technical institute intake, building workforce skill for the plan.",
      duration: 24,
      effects: [
        { metric: "workforceSkill", modifier: 0.04, scope: "national" },
        { metric: "universityEnrollment", modifier: 0.03, scope: "national" },
      ],
    },
    {
      id: "research_priority_order",
      name: "Research Priority Order",
      description:
        "Direct institute research toward plan priorities, lifting productivity and test performance.",
      duration: 24,
      effects: [
        { metric: "productivityGrowth", modifier: 0.02, scope: "national" },
        { metric: "testPerformance", modifier: 0.03, scope: "national" },
      ],
    },
  ],
};
