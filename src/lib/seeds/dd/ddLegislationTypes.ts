import type { LegislationType } from "@/lib/db/types/legislation";
import { policyOptions, taxRateOptions } from "../reference/policyOptionHelpers";

/**
 * East Germany (DD) legislation — 1979. Dual-scenario, like the USSR: each lever
 * spans keeping the SED planned economy / one-party state (the left/default ends)
 * vs reform → market + multiparty democracy → reunification (the right ends,
 * pairing with collapseTargetSystem=parliamentaryRepublic). countryScope "dd".
 *
 * economic axis: -5 plan/state … +5 market. social axis: -5 secular/liberal …
 * +5 traditional. effectTargetsWeighted signed relative to LEFT (+1) so the
 * reform (right) options carry the natural-metric upside (passes policySymmetry).
 */
function ddPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "vk_chair",
      name: `Chair, Volkskammer Committee on ${domainLabel}`,
      chamber: "volkskammer",
    },
    {
      positionId: "vk_vice",
      name: `Vice-Chair, Volkskammer Committee on ${domainLabel}`,
      chamber: "volkskammer",
    },
  ];
}

export const ddLegislationTypes: LegislationType[] = [
  // ── Fiscal levers ───────────────────────────────────────────────────────────
  {
    _id: "dd_enterprise_levy",
    countryScope: "dd",
    name: "VEB Surplus Remittance Statute",
    description: "Sets how enterprise (VEB/Kombinat) surplus is taxed or remitted",
    explanation:
      "How the state extracts the surplus of the people's enterprises — from total remittance under the plan to a light corporate tax under market reform.",
    policyDomain: "tax",
    subCategory: "Enterprise",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: ddPositions("Planning"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("dd_enterprise_levy", [
      {
        rate: 0,
        name: "Full Privatization Act",
        description: "Sell enterprises; no state surplus claim",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 15,
        name: "Market Corporate Tax",
        description: "A light corporate tax on privatised firms",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Mixed Enterprise Levy",
        description: "Partial autonomy with a profit levy",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 55,
        name: "VEB Surplus Remittance Statute",
        description: "The plan remits enterprise surplus to the state",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 70,
        name: "Total Surplus Remittance",
        description: "Full central appropriation of enterprise surplus",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_income_tax",
    countryScope: "dd",
    name: "Citizens' Income Tax Statute",
    description: "Sets the personal income tax rate",
    explanation:
      "Wage taxation, low and flat under the plan; a lever toward either relief or redistribution.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: ddPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("dd_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate the wage tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 12,
        name: "Citizens' Income Tax Statute",
        description: "The low flat wage tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Progressive Income Tax Act",
        description: "A progressive schedule",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_product_tax",
    countryScope: "dd",
    name: "Product Tax Schedule",
    description: "Sets the indirect product/turnover tax",
    explanation: "The turnover tax embedded in administered prices.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: ddPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("dd_product_tax", [
      {
        rate: 0,
        name: "Abolish Product Tax Act",
        description: "Eliminate the turnover tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 8,
        name: "Market VAT",
        description: "A market-style consumption tax",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 16,
        name: "Product Tax Schedule",
        description: "The plan's turnover tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Maximal Turnover Tax",
        description: "High turnover extraction for the budget",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_social_insurance",
    countryScope: "dd",
    name: "Unified Social Insurance Statute",
    description: "Sets social-insurance contributions",
    explanation: "The FDGB-administered unified social insurance.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: ddPositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("dd_social_insurance", [
      {
        rate: 10,
        name: "Private Insurance Act",
        description: "Shift to private/market insurance",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 20,
        name: "Unified Social Insurance Statute",
        description: "The standard unified contribution",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Expanded Social Insurance Act",
        description: "Raise contributions to expand benefits",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_foreign_trade",
    countryScope: "dd",
    name: "Foreign Trade Monopoly Statute",
    description: "Sets the state monopoly over foreign trade",
    explanation: "The Außenhandelsmonopol vs opening to Western trade and convertibility.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.7 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.3 },
    ],
    positions: ddPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("dd_foreign_trade", [
      {
        rate: 0,
        name: "Open Trade Act",
        description: "Abolish the monopoly; open to Western trade",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Managed Opening",
        description: "Selective trade liberalisation",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 25,
        name: "Foreign Trade Monopoly Statute",
        description: "The state monopoly over all foreign trade",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Scenario levers ─────────────────────────────────────────────────────────
  {
    _id: "dd_economic_system",
    countryScope: "dd",
    name: "Economic Order Law",
    description: "Sets central planning vs market reform",
    explanation:
      "The core choice: the SED planned economy (Plankommission) vs market reform, privatisation and ultimately a social-market economy on reunification.",
    policyDomain: "economic",
    subCategory: "System",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
    ],
    positions: ddPositions("Planning"),
    policyOptions: policyOptions(
      "dd_economic_system",
      [
        {
          name: "Social Market Economy",
          explanation: "Full market economy (the reunification path)",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Market Transition",
          explanation: "Privatise and free prices",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Reform Socialism",
          explanation: "Enterprise autonomy within a reformed plan",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Economic Order Law",
          explanation: "Orthodox central planning (Plankommission)",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Total Centralisation",
          explanation: "Maximal central control of the economy",
          stance: "left",
          economic: -5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_political_system",
    countryScope: "dd",
    name: "Leading Role Statute",
    description: "Sets the SED's monopoly vs multiparty democracy",
    explanation:
      "The SED's constitutionally-enshrined leading role and the National Front vs free multiparty elections — and ultimately reunification with the Federal Republic.",
    policyDomain: "governance",
    subCategory: "System",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
    ],
    positions: ddPositions("Constitution"),
    policyOptions: policyOptions(
      "dd_political_system",
      [
        {
          name: "Reunification & Free Elections",
          explanation: "Free multiparty elections leading to reunification",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Multiparty Democracy",
          explanation: "Legalise opposition parties and contested elections",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "Limited Pluralism",
          explanation: "Give the bloc parties real autonomy",
          stance: "left",
          economic: 0,
          social: -1,
        },
        {
          name: "Leading Role Statute",
          explanation: "The SED's constitutional monopoly via the National Front",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Vanguard Dictatorship",
          explanation: "Tighten the party's grip on all institutions",
          stance: "right",
          economic: 0,
          social: 4,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_price_controls",
    countryScope: "dd",
    name: "Price Regulation Statute",
    description: "Sets administered prices vs free pricing",
    explanation:
      "The GDR's subsidised, fixed prices for food, rent and transport vs market pricing.",
    policyDomain: "economic",
    subCategory: "Prices",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.7 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.3 },
    ],
    positions: ddPositions("Prices"),
    policyOptions: policyOptions(
      "dd_price_controls",
      [
        {
          name: "Full Price Liberalisation",
          explanation: "Free all prices to the market",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Partial Decontrol",
          explanation: "Free non-essential prices",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Price Regulation Statute",
          explanation: "Administered, subsidised prices",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Frozen Prices & Rationing",
          explanation: "Hard price freeze with allocation",
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
  {
    _id: "dd_civil_liberties",
    countryScope: "dd",
    name: "State Security Statute",
    description: "Sets the security state vs civil liberties",
    explanation:
      "The Stasi surveillance state, censorship and the Wall vs free expression, free travel and the rule of law.",
    policyDomain: "governance",
    subCategory: "Civil liberties",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: 0.8 },
      { metricCategoryId: "publicSafety", metricId: "incarcerationRate", weight: 0.5 },
    ],
    positions: ddPositions("Interior"),
    policyOptions: policyOptions(
      "dd_civil_liberties",
      [
        {
          name: "Open Society Act",
          explanation: "Abolish the Stasi; free travel, press and assembly",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Liberalisation",
          explanation: "Ease censorship and travel restrictions",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "State Security Statute",
          explanation: "The Stasi surveillance state and censorship",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Maximum Security",
          explanation: "Tighten surveillance and border control",
          stance: "right",
          economic: 0,
          social: 4,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "dd_housing",
    countryScope: "dd",
    name: "Housing Allocation Statute",
    description: "Sets state housing allocation vs a housing market",
    explanation:
      "The GDR's subsidised state housing program (Plattenbau) vs private ownership and a rental market.",
    policyDomain: "economic",
    subCategory: "Housing",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingSupplyGrowth",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
      { metricCategoryId: "social", metricId: "housingSupplyGrowth", weight: -0.4 },
    ],
    positions: ddPositions("Construction"),
    policyOptions: policyOptions(
      "dd_housing",
      [
        {
          name: "Housing Privatisation",
          explanation: "Sell housing into a private market",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Mixed Housing Market",
          explanation: "Allow private ownership alongside state housing",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Housing Allocation Statute",
          explanation: "State-allocated, heavily-subsidised housing",
          stance: "left",
          economic: -2,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default ddLegislationTypes;
