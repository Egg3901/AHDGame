import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Greece (GR) legislation — 1979, a state-heavy mixed economy on the EEC
 * accession path. The defining levers are the swollen para-state sector (banks,
 * utilities, the "problematic enterprises") and the tariff wall the EEC treaty
 * commits Athens to dismantling. countryScope "gr".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 progressive … +5
 * traditional. effectTargetsWeighted signed relative to LEFT (+1) so right
 * options carry the natural-metric upside (passes policySymmetry).
 */
function grPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "vouli_chair",
      name: `Chair, Parliamentary Committee on ${domainLabel}`,
      chamber: "vouli",
    },
    {
      positionId: "vouli_vice",
      name: `Vice-Chair, Parliamentary Committee on ${domainLabel}`,
      chamber: "vouli",
    },
  ];
}

export const grLegislationTypes: LegislationType[] = [
  {
    _id: "gr_income_tax",
    countryScope: "gr",
    name: "Income Tax Statute",
    description: "Sets the top marginal personal income tax rate",
    explanation: "Greece's progressive personal income tax (foros isodimatos).",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: grPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("gr_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 18,
        name: "Flat Tax Reform",
        description: "A low flat rate",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 32,
        name: "Tax Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 48,
        name: "Income Tax Statute",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 60,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for the budget",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 72,
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
    _id: "gr_corporate_tax",
    countryScope: "gr",
    name: "Corporate Tax Statute",
    description: "Sets the corporate income tax rate",
    explanation: "Tax on company profits; shipping enjoys its own tonnage regime.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: grPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("gr_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 20,
        name: "Competitive Rate Act",
        description: "Low rate for investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 32,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 43,
        name: "Corporate Tax Statute",
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
    _id: "gr_sales_tax",
    countryScope: "gr",
    name: "Turnover Tax Schedule",
    description: "Sets the indirect turnover/consumption tax (pre-VAT)",
    explanation:
      "In 1979 Greece levied turnover and stamp taxes on transactions (VAT arrived only in 1987 under EEC harmonisation).",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: grPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("gr_sales_tax", [
      {
        rate: 0,
        name: "Abolish Turnover Tax Act",
        description: "Eliminate the turnover tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 5,
        name: "Reduced Tax Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 10,
        name: "Turnover Tax Schedule",
        description: "The standard 1979 turnover tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
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
    _id: "gr_social_charges",
    countryScope: "gr",
    name: "IKA Contribution Statute",
    description: "Sets employer social-insurance contributions (IKA)",
    explanation:
      "Greece funds social insurance through IKA employer/employee contributions and a maze of occupational funds.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: grPositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("gr_social_charges", [
      {
        rate: 10,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 22,
        name: "IKA Contribution Statute",
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
    _id: "gr_customs_tariff",
    countryScope: "gr",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (protection vs the EEC accession path)",
    explanation:
      "Greece's postwar tariff wall is committed to dismantling under the 1979 EEC accession treaty; the lever spans protection vs integration.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: grPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("gr_customs_tariff", [
      {
        rate: 0,
        name: "EEC Integration Act",
        description: "Dismantle the tariff wall on the accession schedule",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 12,
        name: "Customs Tariff Statute",
        description: "Moderate protection",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
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

  // ── Para-state sector: state banks, utilities, problematic enterprises ──────
  {
    _id: "gr_state_enterprises",
    countryScope: "gr",
    name: "Public Enterprise Law",
    description: "Sets the scope of the state/para-state enterprise sector",
    explanation:
      "State banks steer most credit; DEI, OTE and the swelling 'problematic enterprises' dominate industry. The lever spans divestment vs further étatisation.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: grPositions("Industry"),
    policyOptions: policyOptions(
      "gr_state_enterprises",
      [
        {
          name: "Mass Divestment Act",
          explanation: "Sell the para-state firms; minimal state sector",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Liberalisation Program",
          explanation: "Open credit and shed the loss-making enterprises",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Public Enterprise Law",
          explanation: "Maintain the state-bank-led mixed economy",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Socialisation Act",
          explanation: "Extend state control across industry and banking",
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
    _id: "gr_labor_law",
    countryScope: "gr",
    name: "Labour Code Statute",
    description: "Sets labor protection and union rights",
    explanation:
      "The GSEE unions and post-junta labor mobilisation — from flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: grPositions("Labour"),
    policyOptions: policyOptions(
      "gr_labor_law",
      [
        {
          name: "Labor Liberalization Act",
          explanation: "Flexible contracts, easier dismissal, curbed strikes",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Moderate Flexibility Act",
          explanation: "Ease some rules, keep core protections",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Labour Code Statute",
          explanation: "Statutory protections and the right to strike",
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
  // socialSecurity budget line: occupational pension funds. Default idx2
  // reconciles to 3.20% of GDP (₯1.6B / ₯50B).
  {
    _id: "gr_welfare_state",
    countryScope: "gr",
    name: "Social Provision Statute",
    description: "Sets welfare and social-provision generosity",
    explanation:
      "Greece's fragmented welfare state — occupational pensions, IKA healthcare, farm supports — can be retrenched or expanded.",
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
    positions: grPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_welfare_state",
        [
          {
            name: "Welfare Retrenchment Act",
            explanation: "Cut subsidies and benefits",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim benefit and subsidy growth",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Social Provision Statute",
            explanation: "Maintain pensions, health and farm supports",
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
      [0.01568, 0.0224, 0.032, 0.0448]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: IKA health services ──────────────────────────────────────────────
  // healthcare budget line. Default idx2 reconciles to 1.80% of GDP
  // (₯900M / ₯50B).
  {
    _id: "gr_health_insurance",
    countryScope: "gr",
    name: "IKA Health Services Act",
    description: "Sets funding for IKA-administered health services",
    explanation:
      "IKA (Idryma Koinonikon Asfaliseon, est. 1937) runs its own clinics and hospitals for urban wage-earners, alongside a patchwork of occupational funds. The lever spans austerity to expanded coverage.",
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
    positions: grPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_health_insurance",
        [
          {
            name: "IKA Retrenchment Act",
            explanation: "Cut IKA clinic and hospital funding",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim funding growth to balance IKA's budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "IKA Health Services Act",
            explanation: "Maintain IKA-administered clinics and hospitals",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "IKA Expansion Act",
            explanation: "Expand IKA clinic capacity and rural outreach",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.009, 0.0135, 0.018, 0.0252]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: national education ───────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 2.40% of GDP
  // (₯1.2B / ₯50B).
  {
    _id: "gr_education_funding",
    countryScope: "gr",
    name: "National Education Act",
    description: "Sets funding for the state school and university system",
    explanation:
      "Greece's centralised school and university system, still recovering enrollment and staffing lost to occupation and civil war. The lever spans austerity to expanded state investment.",
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
    positions: grPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_education_funding",
        [
          {
            name: "Education Retrenchment Act",
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
            name: "National Education Act",
            explanation: "Maintain the centralised state education system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Education Expansion Act",
            explanation: "Rebuild schools and expand university places",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.012, 0.018, 0.024, 0.0336]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: DEI reconstruction ──────────────────────────────────────
  // infrastructure budget line. Default idx2 reconciles to 5.20% of GDP
  // (₯2.6B / ₯50B) — roads, ports and power reconstruction, financed heavily
  // by American aid counterpart funds.
  {
    _id: "gr_infrastructure_investment",
    countryScope: "gr",
    name: "DEI Reconstruction Act",
    description: "Sets funding for the postwar roads, ports and power reconstruction programme",
    explanation:
      "Postwar reconstruction of roads, ports and the power grid — including the new Dimosia Epicheirisi Ilektrismou (DEI, the Public Power Corporation, 1950) — financed heavily by American aid counterpart funds after the ruinous occupation and civil war. The lever spans austerity to an accelerated investment drive.",
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
    positions: grPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_infrastructure_investment",
        [
          {
            name: "Reconstruction Retrenchment Act",
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
            name: "DEI Reconstruction Act",
            explanation: "Maintain the roads, ports and power reconstruction programme",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Accelerated Reconstruction Act",
            explanation: "Expand road, port and power investment",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.026, 0.039, 0.052, 0.0728]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: post-civil-war army ────────────────────────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center) reconciles to 6.40% of GDP (₯3.2B / ₯50B) — a large
  // post-civil-war army, backed by American aid and NATO membership (1952).
  {
    _id: "gr_defense_appropriations",
    countryScope: "gr",
    name: "National Defense Act",
    description: "Sets the overall military appropriations envelope",
    explanation:
      "Greece maintains a large standing army fresh from defeating the Democratic Army in the 1946-49 civil war, now integrated into NATO (1952) and heavily subsidised by American military aid. The lever spans demobilisation to further rearmament.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: grPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_defense_appropriations",
        [
          {
            name: "Demobilisation Act",
            explanation: "Cut the standing army toward peacetime levels",
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
            name: "National Defense Act",
            explanation: "Maintain the standing NATO-aligned appropriation",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Rearmament Act",
            explanation: "Expand appropriations and modernise the armed forces",
            stance: "right",
            economic: 0,
            social: 4,
          },
        ],
        "social"
      ),
      [0.0224, 0.0384, 0.064, 0.1024]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: agricultural and industrial subsidies ────────────────────────────
  // "other" budget line — farm price supports and reconstruction-era industrial
  // subsidies. Default idx2 reconciles to 2.40% of GDP (₯1.2B / ₯50B).
  {
    _id: "gr_economic_subsidies",
    countryScope: "gr",
    name: "Agricultural and Industrial Subsidies Act",
    description: "Sets the level of subsidies to agriculture and reconstruction-era industry",
    explanation:
      "Price supports for smallholder tobacco, currant and grain farmers, plus subsidies to reconstruction-era industry steered by state banks. The lever spans austerity to expanded state support.",
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
    positions: grPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to farmers and industry",
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
            name: "Agricultural and Industrial Subsidies Act",
            explanation: "Maintain support for farmers and reconstruction-era industry",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for farmers and industry",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.012, 0.018, 0.024, 0.0336]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: transfers to municipalities ─────────────────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 1.60% of GDP (₯800M / ₯50B).
  {
    _id: "gr_local_grants",
    countryScope: "gr",
    name: "Municipal Grants Act",
    description: "Sets central government transfers to the dimoi and koinotites",
    explanation:
      "Athens's fiscal-equalisation transfer to Greece's dimoi (municipalities) and koinotites (communes), which still bear the reconstruction costs of the civil war. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: grPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "gr_local_grants",
        [
          {
            name: "Transfer Retrenchment Act",
            explanation: "Cut transfers to local government",
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
            name: "Municipal Grants Act",
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
      [0.008, 0.012, 0.016, 0.0224]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default grLegislationTypes;
