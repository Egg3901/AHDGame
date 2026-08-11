import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Austria (AT) legislation — 1979, the Austro-Keynesian consensus economy.
 * The defining levers are the verstaatlichte Industrie (the ÖIAG nationalised
 * sector, largest state-owned industry share in the West) and the
 * Sozialpartnerschaft wage-setting machinery. countryScope "at".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 progressive … +5
 * traditional. effectTargetsWeighted signed relative to LEFT (+1) so right
 * options carry the natural-metric upside (passes policySymmetry).
 */
function atPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "nationalrat_chair",
      name: `Chair, Nationalrat Committee on ${domainLabel}`,
      chamber: "nationalrat",
    },
    {
      positionId: "nationalrat_vice",
      name: `Vice-Chair, Nationalrat Committee on ${domainLabel}`,
      chamber: "nationalrat",
    },
  ];
}

export const atLegislationTypes: LegislationType[] = [
  {
    _id: "at_income_tax",
    countryScope: "at",
    name: "Income Tax Act",
    description: "Sets the top marginal personal income tax rate",
    explanation: "Austria's progressive wage and income tax (Einkommensteuer).",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: atPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("at_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 20,
        name: "Flat Tax Reform",
        description: "A low flat rate",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 38,
        name: "Tax Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 62,
        name: "Income Tax Act",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 72,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for the budget",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 82,
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
    _id: "at_corporate_tax",
    countryScope: "at",
    name: "Corporation Tax Act",
    description: "Sets the corporate income tax rate",
    explanation: "Tax on company profits (Körperschaftsteuer).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: atPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("at_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 25,
        name: "Competitive Rate Act",
        description: "Low rate for investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 40,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 55,
        name: "Corporation Tax Act",
        description: "The standard corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 65,
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
    _id: "at_sales_tax",
    countryScope: "at",
    name: "Value-Added Tax Act",
    description: "Sets the VAT standard rate",
    explanation:
      "Austria replaced its turnover tax with VAT (Mehrwertsteuer) in 1973; the 1979 standard rate stood at 18%.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: atPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("at_sales_tax", [
      {
        rate: 0,
        name: "Abolish VAT Act",
        description: "Eliminate the value-added tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Reduced Rate Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 18,
        name: "Value-Added Tax Act",
        description: "The standard 1979 VAT rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 26,
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
    _id: "at_social_charges",
    countryScope: "at",
    name: "Social Insurance Contribution Act",
    description: "Sets employer social-insurance contributions",
    explanation:
      "Austria funds pensions, health and accident insurance through Sozialversicherung payroll contributions administered by the Krankenkassen.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: atPositions("Social Affairs"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("at_social_charges", [
      {
        rate: 14,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 26,
        name: "Social Insurance Contribution Act",
        description: "The standard social-insurance charges",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 38,
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
    _id: "at_customs_tariff",
    countryScope: "at",
    name: "Customs Tariff Act",
    description: "Sets the external tariff (protection vs EFTA/EEC free trade)",
    explanation:
      "Neutral Austria trades through EFTA and the 1972 EEC free-trade agreement; the lever spans protection vs open integration with the West German economy.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: atPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("at_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Integration Act",
        description: "Full EFTA/EEC free trade, zero industrial tariffs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 8,
        name: "Customs Tariff Act",
        description: "Moderate protection",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
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

  // ── Verstaatlichte Industrie: the ÖIAG nationalised sector ─────────────────
  {
    _id: "at_state_enterprises",
    countryScope: "at",
    name: "Nationalised Industries Act",
    description: "Sets the scope of the ÖIAG state-enterprise sector",
    explanation:
      "The 1946/47 nationalisation laws gave Vienna the largest state-owned industrial sector in the West — VOEST steel, the big banks, oil and electricity under ÖIAG. The lever spans privatisation vs further étatisation.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: atPositions("Industry"),
    policyOptions: policyOptions(
      "at_state_enterprises",
      [
        {
          name: "Mass Privatisation Act",
          explanation: "Sell the ÖIAG holdings; minimal state sector",
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
          name: "Nationalised Industries Act",
          explanation: "Maintain the ÖIAG state-industry core",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Socialisation Expansion Act",
          explanation: "Extend state ownership across industry and banking",
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
    _id: "at_labor_law",
    countryScope: "at",
    name: "Labour Constitution Act",
    description: "Sets labor protection and the social-partnership machinery",
    explanation:
      "The Arbeitsverfassungsgesetz and the Parity Commission: ÖGB unions and the chambers set wages by consensus — from flexibility to expanded co-determination.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: atPositions("Labour"),
    policyOptions: policyOptions(
      "at_labor_law",
      [
        {
          name: "Labor Liberalization Act",
          explanation: "Flexible contracts, easier dismissal, weakened chambers",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Moderate Flexibility Act",
          explanation: "Ease some rules, keep the social partnership",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Labour Constitution Act",
          explanation: "Works councils, chambers and the Parity Commission",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Co-Determination Expansion Act",
          explanation: "Extend works-council power and union rights",
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
  // socialSecurity budget line: war pensions (Opferfürsorge/Kriegsopferrente)
  // and the coming ASVG (codified 1956). Default idx2 reconciles to 10.59% of
  // GDP (öS9B / öS85B).
  {
    _id: "at_welfare_state",
    countryScope: "at",
    name: "General Social Insurance Act",
    description: "Sets welfare and social-provision generosity",
    explanation:
      "The ASVG welfare state — pensions, Krankenkassen healthcare, family allowances and Gemeindebau housing — can be retrenched or expanded.",
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
    positions: atPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_welfare_state",
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
            name: "General Social Insurance Act",
            explanation: "Maintain pensions, health and family benefits",
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
      [0.05188, 0.07412, 0.10588, 0.14824]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: Krankenkassen ────────────────────────────────────────────────────
  // healthcare budget line. Default idx2 reconciles to 4.12% of GDP
  // (öS3.5B / öS85B).
  {
    _id: "at_health_insurance",
    countryScope: "at",
    name: "Krankenversicherung Act",
    description: "Sets funding for the Krankenkassen sickness-insurance funds",
    explanation:
      "Austria's Bismarckian Krankenkassen (occupational sickness funds), inherited pre-1938 and rebuilt after 1945, cover doctor visits and hospital stays. The lever spans austerity to expanded coverage.",
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
    positions: atPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_health_insurance",
        [
          {
            name: "Krankenkassen Retrenchment Act",
            explanation: "Cut sickness-fund reimbursement",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim reimbursement growth to balance the funds",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Krankenversicherung Act",
            explanation: "Maintain the Krankenkassen sickness-insurance system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Krankenkassen Expansion Act",
            explanation: "Widen coverage and reimbursement across the Krankenkassen",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02059, 0.03088, 0.04118, 0.05765]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Schulwesen ────────────────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 5.29% of GDP
  // (öS4.5B / öS85B).
  {
    _id: "at_education_funding",
    countryScope: "at",
    name: "Schulwesen Act",
    description: "Sets funding for the state school and university system",
    explanation:
      "Austria's centralised Schulwesen — Volksschule, Gymnasium, and the universities — rebuilding after wartime disruption and occupation-era resource strain. The lever spans austerity to expanded state investment.",
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
    positions: atPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_education_funding",
        [
          {
            name: "Schulwesen Retrenchment Act",
            explanation: "Cut school and university funding",
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
            name: "Schulwesen Act",
            explanation: "Maintain the centralised state education system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Schulwesen Expansion Act",
            explanation: "Expand schools and rebuild university capacity",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02647, 0.03971, 0.05294, 0.07412]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: ERP reconstruction (Kaprun, rail, power) ────────────────
  // infrastructure budget line. Default idx2 reconciles to 9.41% of GDP
  // (öS8B / öS85B) — the largest 1953 category, reflecting the ERP
  // (Marshall Plan) counterpart-fund investment boom.
  {
    _id: "at_infrastructure_investment",
    countryScope: "at",
    name: "ERP-Wiederaufbau Act",
    description: "Sets funding for the ERP-financed reconstruction investment programme",
    explanation:
      "European Recovery Program (Marshall Plan) counterpart funds financing the Kaprun hydroelectric project, rail reconstruction, and industrial rebuilding — the centrepiece of Austria's postwar recovery. The lever spans austerity to an accelerated investment drive.",
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
    positions: atPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_infrastructure_investment",
        [
          {
            name: "ERP Retrenchment Act",
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
            name: "ERP-Wiederaufbau Act",
            explanation: "Maintain the ERP-financed reconstruction programme",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Accelerated Reconstruction Act",
            explanation: "Expand Kaprun, rail and industrial investment",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.04706, 0.07059, 0.09412, 0.13176]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: no standing army until 1955 ────────────────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend. Default
  // idx0 ("no standing army", the 1953 reality per the AT budget config
  // comment "no army until 1955") reconciles to 0.94% of GDP (öS0.8B / öS85B)
  // — gendarmerie plus occupation costs. The ladder foreshadows the 1955
  // Austrian State Treaty and the founding of the Bundesheer.
  {
    _id: "at_defense_appropriations",
    countryScope: "at",
    name: "Bundesgendarmerie und Besatzungskosten Act",
    description: "Sets funding for the gendarmerie and occupation-related costs",
    explanation:
      "Four-power-occupied Austria has no standing army — only the Bundesgendarmerie and the costs of hosting occupying forces. The lever spans the occupation-era status quo to an early conscript-army build-up ahead of the 1955 State Treaty.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: atPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_defense_appropriations",
        [
          {
            name: "Bundesgendarmerie und Besatzungskosten Act",
            explanation: "Maintain gendarmerie policing and occupation-cost payments only",
            stance: "left",
            economic: 0,
            social: -4,
          },
          {
            name: "Gendarmerie Expansion Act",
            explanation: "Expand the gendarmerie's paramilitary capacity",
            stance: "left",
            economic: 0,
            social: -2,
          },
          {
            name: "Conscript Army Formation Act",
            explanation: "Begin forming a conscript army ahead of the State Treaty",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Full Rearmament Act",
            explanation: "Accelerate rearmament and conscript-army formation",
            stance: "right",
            economic: 0,
            social: 4,
          },
        ],
        "social"
      ),
      [0.00941, 0.016, 0.02635, 0.04047]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: nationalised-industry subsidies & occupation losses ─────────────
  // "other" budget line — subsidies to the nationalised (verstaatlichte)
  // sector and USIA war-reparations losses. Default idx2 reconciles to 5.88%
  // of GDP (öS5B / öS85B).
  {
    _id: "at_economic_subsidies",
    countryScope: "at",
    name: "Verstaatlichte Industrie Subventionsgesetz",
    description: "Sets the level of subsidies to the nationalised-industry sector",
    explanation:
      "Operating subsidies to the ÖIAG nationalised industries and food-price subsidies, plus the fiscal drain of Soviet-administered USIA enterprises still extracting reparations from eastern Austria. The lever spans austerity to expanded state support.",
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
    positions: atPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to nationalised industry",
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
            name: "Verstaatlichte Industrie Subventionsgesetz",
            explanation: "Maintain support for the nationalised sector and food prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for the nationalised sector and food prices",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02941, 0.04412, 0.05882, 0.08235]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: Finanzausgleich to Länder and Gemeinden ─────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 4.12% of GDP (öS3.5B / öS85B).
  {
    _id: "at_local_grants",
    countryScope: "at",
    name: "Finanzausgleichsgesetz",
    description: "Sets central government transfers to the Länder and Gemeinden",
    explanation:
      "The Finanzausgleichsgesetz — Austria's fiscal-equalisation transfer to the nine Länder and their Gemeinden. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: atPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "at_local_grants",
        [
          {
            name: "Transfer Retrenchment Act",
            explanation: "Cut transfers to the Länder and Gemeinden",
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
            name: "Finanzausgleichsgesetz",
            explanation: "Maintain the standard transfer to the Länder and Gemeinden",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Transfer Expansion Act",
            explanation: "Expand transfers to the Länder and Gemeinden",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02059, 0.03088, 0.04118, 0.05765]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default atLegislationTypes;
