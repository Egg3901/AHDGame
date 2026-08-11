import type { LegislationType } from "@/lib/db/types/legislation";
import { policyOptions, taxRateOptions } from "../reference/policyOptionHelpers";

/**
 * Spain (ES) legislation — 1979 Transition. A modernising economy with a large
 * state-holding sector (INI) and a welfare state being built. countryScope "es".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 secular … +5 traditional.
 * effectTargetsWeighted signed relative to LEFT (+1) so right options carry the
 * natural-metric upside (passes policySymmetry).
 */
function esPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "cd_chair",
      name: `Chair, Congress Committee on ${domainLabel}`,
      chamber: "congresoDiputados",
    },
    {
      positionId: "cd_vice",
      name: `Vice-Chair, Congress Committee on ${domainLabel}`,
      chamber: "congresoDiputados",
    },
  ];
}

export const esLegislationTypes: LegislationType[] = [
  {
    _id: "es_income_tax",
    countryScope: "es",
    name: "IRPF Statute",
    description: "Sets the top personal income tax (IRPF) rate",
    explanation: "Spain's progressive IRPF, created in the 1978 tax reform of the new democracy.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: esPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("es_income_tax", [
      {
        rate: 0,
        name: "Abolish IRPF Act",
        description: "Eliminate income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 16,
        name: "Flat Tax Reform",
        description: "A low flat rate",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 44,
        name: "IRPF Statute",
        description: "The 1978-reform progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 58,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for social spending",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 66,
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
    _id: "es_corporate_tax",
    countryScope: "es",
    name: "Impuesto de Sociedades Statute",
    description: "Sets the corporate income tax rate",
    explanation: "Tax on company profits (Impuesto sobre Sociedades).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: esPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("es_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 16,
        name: "Competitive Rate Act",
        description: "Low rate for investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 26,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 35,
        name: "Impuesto de Sociedades Statute",
        description: "The standard corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 46,
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
    _id: "es_consumption_tax",
    countryScope: "es",
    name: "ITE Schedule",
    description: "Sets the indirect consumption tax (ITE turnover tax)",
    explanation:
      "In 1979 Spain levied the ITE (Impuesto sobre el Tráfico de Empresas), the pre-VAT turnover tax.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: esPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("es_consumption_tax", [
      {
        rate: 0,
        name: "Abolish ITE Act",
        description: "Eliminate the turnover tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 4,
        name: "Reduced ITE Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 9,
        name: "ITE Schedule",
        description: "The standard 1979 turnover tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 16,
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
    _id: "es_social_charges",
    countryScope: "es",
    name: "Seguridad Social Statute",
    description: "Sets employer social-security contributions",
    explanation: "Spain funds pensions and benefits via Seguridad Social contributions.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: esPositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("es_social_charges", [
      {
        rate: 12,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 26,
        name: "Seguridad Social Statute",
        description: "The standard social-security charges",
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
    _id: "es_customs_tariff",
    countryScope: "es",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (Spain pre-EEC accession)",
    explanation:
      "In 1979 Spain protected industry behind tariffs while negotiating EEC entry; the lever models protectionism vs openness.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: esPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("es_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Act",
        description: "Open trade and pursue EEC entry",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 12,
        name: "Customs Tariff Statute",
        description: "The standard protective tariff",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "National Protection Act",
        description: "Protect industry behind higher tariffs",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── State holdings: privatize ↔ expand INI ──────────────────────────────────
  {
    _id: "es_state_holdings",
    countryScope: "es",
    name: "Patrimonio del Estado Law",
    description: "Sets the scope of the state-holding sector (INI)",
    explanation:
      "The Instituto Nacional de Industria (INI) owns steel, shipbuilding, autos (SEAT) and energy. The lever spans privatization to further nationalization.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: esPositions("Industry"),
    policyOptions: policyOptions(
      "es_state_holdings",
      [
        {
          name: "Mass Privatization Act",
          explanation: "Sell off INI holdings; minimal state sector",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Privatization Program",
          explanation: "Privatize competitive state firms",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Patrimonio del Estado Law",
          explanation: "Maintain the INI mixed-economy holding sector",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Nationalization Expansion Act",
          explanation: "Extend state holdings into more industries",
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

  // ── Labor: Estatuto de los Trabajadores ─────────────────────────────────────
  {
    _id: "es_labor_law",
    countryScope: "es",
    name: "Estatuto de los Trabajadores Statute",
    description: "Sets labor protection and worker rights",
    explanation:
      "The 1980 Estatuto de los Trabajadores set Spain's labor framework after the Moncloa Pacts; the lever spans flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: esPositions("Labour"),
    policyOptions: policyOptions(
      "es_labor_law",
      [
        {
          name: "Labor Liberalization Act",
          explanation: "Flexible contracts, easier dismissal",
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
          name: "Estatuto de los Trabajadores Statute",
          explanation: "Statutory protections + collective bargaining",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Worker Power Expansion Act",
          explanation: "Extend protections and union codetermination",
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

  // ── Welfare / Estado del bienestar ──────────────────────────────────────────
  {
    _id: "es_welfare_state",
    countryScope: "es",
    name: "Estado del Bienestar Statute",
    description: "Sets welfare and pension generosity",
    explanation:
      "Spain's young welfare state — pensions and the expanding Seguridad Social health system — can be retrenched or expanded.",
    policyDomain: "economic",
    subCategory: "Welfare",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.5 },
    ],
    positions: esPositions("Social Affairs"),
    policyOptions: policyOptions(
      "es_welfare_state",
      [
        {
          name: "Welfare Retrenchment Act",
          explanation: "Cut benefits and pension generosity",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Cost-Control Reform",
          explanation: "Trim benefit growth to control the deficit",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Estado del Bienestar Statute",
          explanation: "Build out pensions and public health",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Universal Welfare Expansion Act",
          explanation: "Expand pensions, family and health benefits",
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
];

export default esLegislationTypes;
