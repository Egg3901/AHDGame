import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Finland (FI) legislation — 1979, a Nordic mixed economy with heavy state
 * industry and comprehensive incomes-policy settlements. The defining levers
 * are the state companies (Valmet, Neste, Enso-Gutzeit, Kemira) and the
 * tulopolitiikka wage machinery. countryScope "fi".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 progressive … +5
 * traditional. effectTargetsWeighted signed relative to LEFT (+1) so right
 * options carry the natural-metric upside (passes policySymmetry).
 */
function fiPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "eduskunta_chair",
      name: `Chair, Eduskunta Committee on ${domainLabel}`,
      chamber: "eduskunta",
    },
    {
      positionId: "eduskunta_vice",
      name: `Vice-Chair, Eduskunta Committee on ${domainLabel}`,
      chamber: "eduskunta",
    },
  ];
}

export const fiLegislationTypes: LegislationType[] = [
  {
    _id: "fi_income_tax",
    countryScope: "fi",
    name: "Income Tax Act",
    description: "Sets the top marginal personal income tax rate",
    explanation:
      "Finland's steeply progressive state income tax (tulovero), stacked on flat municipal taxes.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: fiPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("fi_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 22,
        name: "Flat Tax Reform",
        description: "A low flat rate",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 40,
        name: "Tax Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 65,
        name: "Income Tax Act",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 75,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for the budget",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 85,
        name: "Wealth Redistribution Act",
        description: "Steeply progressive top rates",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fi_corporate_tax",
    countryScope: "fi",
    name: "Corporation Tax Act",
    description: "Sets the corporate income tax rate",
    explanation:
      "Tax on company profits; generous depreciation and investment reserves shelter the forest industries.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: fiPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("fi_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 22,
        name: "Competitive Rate Act",
        description: "Low rate for investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 33,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 43,
        name: "Corporation Tax Act",
        description: "The standard corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 55,
        name: "Excess Profits Act",
        description: "Higher rate on profits",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fi_sales_tax",
    countryScope: "fi",
    name: "Turnover Tax Act",
    description: "Sets the turnover/consumption tax rate",
    explanation:
      "Finland's liikevaihtovero turnover tax (since 1941); VAT replaced it only in 1994 with EU membership approaching.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: fiPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("fi_sales_tax", [
      {
        rate: 0,
        name: "Abolish Turnover Tax Act",
        description: "Eliminate the turnover tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 8,
        name: "Reduced Rate Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 14,
        name: "Turnover Tax Act",
        description: "The standard turnover tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 22,
        name: "Revenue Consumption Act",
        description: "Raise consumption tax to fund the budget",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fi_social_charges",
    countryScope: "fi",
    name: "Social Insurance Contribution Act",
    description: "Sets employer social-insurance contributions",
    explanation:
      "Sickness insurance (1964), national and earnings-related pensions (KELA + TEL) funded through payroll contributions.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: fiPositions("Social Affairs"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("fi_social_charges", [
      {
        rate: 12,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 22,
        name: "Social Insurance Contribution Act",
        description: "The standard social-insurance charges",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 34,
        name: "Expanded Welfare Act",
        description: "Raise charges to expand benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fi_customs_tariff",
    countryScope: "fi",
    name: "Customs Tariff Act",
    description: "Sets the external tariff (free trade west, bilateral clearing east)",
    explanation:
      "FINEFTA and the 1973 EEC free-trade agreement opened the west while the Soviet bilateral clearing account guarantees eastern demand — the lever spans protection vs the two-way opening.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: fiPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("fi_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Integration Act",
        description: "Zero industrial tariffs on the EFTA/EEC track",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 9,
        name: "Customs Tariff Act",
        description: "Moderate protection",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 25,
        name: "National Industry Protection Act",
        description: "Heavy protection for domestic industry",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── State companies: Valmet, Neste, Enso-Gutzeit, Kemira ────────────────────
  {
    _id: "fi_state_enterprises",
    countryScope: "fi",
    name: "State Companies Act",
    description: "Sets the scope of the state-company sector",
    explanation:
      "The state built much of heavy industry itself — Valmet engineering, Neste oil, Enso-Gutzeit forest, Kemira chemicals, Rautaruukki steel. The lever spans divestment vs further state-led industrialisation.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: fiPositions("Industry"),
    policyOptions: policyOptions(
      "fi_state_enterprises",
      [
        {
          name: "Mass Privatisation Act",
          explanation: "Sell the state companies; minimal state sector",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Partial Divestment Program",
          explanation: "Float minority stakes and shed loss-makers",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "State Companies Act",
          explanation: "Maintain the state-industrial core",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "State Industrialisation Expansion Act",
          explanation: "Extend state ownership across industry",
          stance: "left",
          economic: -4,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Labor ───────────────────────────────────────────────────────────────────
  {
    _id: "fi_labor_law",
    countryScope: "fi",
    name: "Incomes Policy Act",
    description: "Sets labor protection and the incomes-policy machinery",
    explanation:
      "The comprehensive tulopolitiikka settlements — SAK unions, employers and the state bargain wages, taxes and social policy in one package. From flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: fiPositions("Labour"),
    policyOptions: policyOptions(
      "fi_labor_law",
      [
        {
          name: "Labor Liberalization Act",
          explanation: "Flexible contracts, easier dismissal, decentralised wages",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Moderate Flexibility Act",
          explanation: "Ease some rules, keep the settlement system",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Incomes Policy Act",
          explanation: "Comprehensive tripartite wage settlements",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Union Power Expansion Act",
          explanation: "Extend protections and union power",
          stance: "left",
          economic: -4,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Welfare ─────────────────────────────────────────────────────────────────
  // socialSecurity budget line: war pensions and the 1948 universal child
  // allowance. Default idx2 reconciles to 3.54% of GDP (mk28B / mk790B).
  {
    _id: "fi_welfare_state",
    countryScope: "fi",
    name: "Social Security Act",
    description: "Sets welfare and social-provision generosity",
    explanation:
      "The Nordic welfare state under construction — KELA benefits, universal health centres, child allowances and the pension pillars — can be retrenched or expanded.",
    policyDomain: "economic",
    subCategory: "Welfare",
    budgetCategory: "socialSecurity",
    nationalOnly: true,
    // §4.7 (P3a): socialMobility is a spend-driven cluster readout — a
    // socialSecurity-budget FUNDING law's booked spend already drives it via
    // the social-spending channel, so a direct target here double-counts.
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
    ],
    positions: fiPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_welfare_state",
        [
          {
            name: "Welfare Retrenchment Act",
            explanation: "Cut benefits and subsidies",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim benefit growth",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Social Security Act",
            explanation: "Maintain the universal benefit system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Universal Welfare Expansion Act",
            explanation: "Expand pensions, health and social benefits",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01737, 0.02481, 0.03544, 0.04962]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: KELA health services ─────────────────────────────────────────────
  // healthcare budget line. Default idx2 reconciles to 1.27% of GDP
  // (mk10B / mk790B) — pre-national-health-insurance (1964).
  {
    _id: "fi_health_insurance",
    countryScope: "fi",
    name: "Kansaneläkelaitos Terveys Act",
    description: "Sets funding for KELA-administered health services",
    explanation:
      "Kansaneläkelaitos (KELA, est. 1937) funds municipal health centres and rudimentary sickness benefits — the comprehensive national health insurance is still eleven years away (1964). The lever spans austerity to expanded coverage.",
    policyDomain: "healthcare",
    subCategory: "Health insurance",
    budgetCategory: "healthcare",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "healthcare", metricId: "uninsuredRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "uninsuredRate", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: fiPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_health_insurance",
        [
          {
            name: "Terveys Retrenchment Act",
            explanation: "Cut municipal health-centre funding",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim funding growth to balance KELA's budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Kansaneläkelaitos Terveys Act",
            explanation: "Maintain KELA-administered health services",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Terveys Expansion Act",
            explanation: "Expand health-centre capacity ahead of national health insurance",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.00633, 0.00949, 0.01266, 0.01772]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Kansakoulu ────────────────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 2.28% of GDP
  // (mk18B / mk790B).
  {
    _id: "fi_education_funding",
    countryScope: "fi",
    name: "Kansakoulu Act",
    description: "Sets funding for the state school system",
    explanation:
      "Finland's kansakoulu (folk school) network and the expanding oppikoulu tier, straining under Karelian-resettlement enrollment growth. The lever spans austerity to expanded state investment.",
    policyDomain: "education",
    subCategory: "National education funding",
    budgetCategory: "education",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "educationSpending", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: fiPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_education_funding",
        [
          {
            name: "Kansakoulu Retrenchment Act",
            explanation: "Cut school funding",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim funding growth to balance the budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Kansakoulu Act",
            explanation: "Maintain the folk-school system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Kansakoulu Expansion Act",
            explanation: "Expand schools to absorb Karelian-resettlement enrollment growth",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01139, 0.01709, 0.02278, 0.0319]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: war-reparations reconstruction ──────────────────────────
  // infrastructure budget line. Default idx2 reconciles to 4.05% of GDP
  // (mk32B / mk790B) — the largest 1953 category, reflecting the metal-
  // industry and hydropower capacity the reparations deliveries built.
  {
    _id: "fi_infrastructure_investment",
    countryScope: "fi",
    name: "Jälleenrakennus Act",
    description: "Sets funding for the reparations-driven reconstruction and industrial programme",
    explanation:
      "The jälleenrakennus (reconstruction) programme that delivered ₽300M of Soviet war reparations in kind (completed 1952) also built the metal, shipbuilding and hydropower capacity now exporting east commercially. The lever spans austerity to an accelerated investment drive.",
    policyDomain: "infrastructure",
    subCategory: "Reconstruction investment",
    budgetCategory: "infrastructure",
    nationalOnly: true,
    // §4.7 (P2c): the infrastructure metrics (transportEfficiency etc.) are
    // engine-derived from the infrastructure spending channel — a GENERIC
    // whole-infrastructure FUNDING law that also targets one directly
    // double-counts. Re-pointed to budgetBalance (the fiscal cost, mirroring
    // de_bundeswehr_funding's pattern) with a ruralRevitalization secondary
    // for the regional-development flavour (not an infra-channel readout) and
    // an economicFreedom secondary for the right-option upside (P6c).
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: fiPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_infrastructure_investment",
        [
          {
            name: "Jälleenrakennus Retrenchment Act",
            explanation: "Scale back the reconstruction programme",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Slow investment growth to balance the budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Jälleenrakennus Act",
            explanation: "Maintain the reparations-built industrial investment programme",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Accelerated Industrialisation Act",
            explanation: "Expand metal, shipbuilding and hydropower investment",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02025, 0.03038, 0.04051, 0.05671]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: Paris Peace Treaty-capped forces ───────────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center) reconciles to 1.27% of GDP (mk10B / mk790B) — the
  // Paris Peace Treaty (1947) caps the conscript force.
  {
    _id: "fi_defense_appropriations",
    countryScope: "fi",
    name: "Puolustusvoimain Act",
    description: "Sets the overall military appropriations envelope",
    explanation:
      "The Puolustusvoimat (Finnish Defence Forces), capped in personnel and equipment by the 1947 Paris Peace Treaty, defend Finland's Cold War neutrality between East and West. The lever spans further reductions to (treaty-straining) rearmament.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: fiPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_defense_appropriations",
        [
          {
            name: "Disarmament Act",
            explanation: "Cut the armed forces below the treaty ceiling",
            stance: "left",
            economic: 0,
            social: -4,
          },
          {
            name: "Appropriations Reduction Act",
            explanation: "Trim the military budget",
            stance: "left",
            economic: 0,
            social: -2,
          },
          {
            name: "Puolustusvoimain Act",
            explanation: "Maintain the standing treaty-capped appropriation",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Treaty-Straining Rearmament Act",
            explanation: "Expand appropriations toward the treaty's ceiling",
            stance: "right",
            economic: 0,
            social: 4,
          },
        ],
        "social"
      ),
      [0.00443, 0.00759, 0.01266, 0.02025]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: state-company subsidies ──────────────────────────────────────────
  // "other" budget line — support for Alko's monopoly operations and the state
  // companies beyond the ownership question already modeled by
  // fi_state_enterprises. Default idx2 reconciles to 2.28% of GDP
  // (mk18B / mk790B).
  {
    _id: "fi_economic_subsidies",
    countryScope: "fi",
    name: "Valtionyhtiöiden Tuki Act",
    description: "Sets the level of operating subsidies to the state-company sector",
    explanation:
      "Operating subsidies and price supports for Valmet, Neste, Enso-Gutzeit and Alko's monopoly network, plus agricultural price supports for Finnish farmers. The lever spans austerity to expanded state support.",
    policyDomain: "economic",
    subCategory: "State subsidies",
    budgetCategory: "other",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: fiPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to state companies and farms",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim subsidy growth to balance the budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Valtionyhtiöiden Tuki Act",
            explanation: "Maintain support for the state-company sector and farm prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for the state-company sector and farm prices",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01139, 0.01709, 0.02278, 0.0319]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: valtionosuudet to municipalities ────────────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 1.77% of GDP (mk14B / mk790B).
  {
    _id: "fi_local_grants",
    countryScope: "fi",
    name: "Valtionosuudet Act",
    description: "Sets central government transfers to the kunnat (municipalities)",
    explanation:
      "The valtionosuudet — the state's fiscal-equalisation transfer to Finland's kunnat, which deliver most local services including Karelian-resettlement support. The lever spans centralisation (low transfer) to generous local funding.",
    policyDomain: "economic",
    subCategory: "Fiscal transfer",
    budgetCategory: "economic",
    isGrant: true,
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: fiPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fi_local_grants",
        [
          {
            name: "Transfer Retrenchment Act",
            explanation: "Cut transfers to the kunnat",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim transfer growth to balance the budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Valtionosuudet Act",
            explanation: "Maintain the standard transfer to local government",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Transfer Expansion Act",
            explanation: "Expand transfers to local government",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.00886, 0.01329, 0.01772, 0.02481]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default fiLegislationTypes;
