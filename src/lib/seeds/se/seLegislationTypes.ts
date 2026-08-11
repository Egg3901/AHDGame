import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Sweden (SE) legislation — 1979, the Swedish model. A high-tax, high-welfare
 * economy with powerful unions. The defining lever is the wage-earner funds
 * (löntagarfonder) debate — union-controlled funds gradually buying company
 * shares vs keeping private ownership. countryScope "se".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 secular … +5 traditional.
 * effectTargetsWeighted signed relative to LEFT (+1) so right options carry the
 * natural-metric upside (passes policySymmetry).
 */
function sePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "rd_chair",
      name: `Chair, Riksdag Committee on ${domainLabel}`,
      chamber: "riksdag",
    },
    {
      positionId: "rd_vice",
      name: `Vice-Chair, Riksdag Committee on ${domainLabel}`,
      chamber: "riksdag",
    },
  ];
}

export const seLegislationTypes: LegislationType[] = [
  {
    _id: "se_income_tax",
    countryScope: "se",
    name: "Statlig Inkomstskatt Statute",
    description: "Sets the top marginal personal income tax rate",
    explanation: "Sweden's famously steep progressive income tax funds the welfare state.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: sePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("se_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 25,
        name: "Flat Tax Reform",
        description: "A low flat rate",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 45,
        name: "Tax Relief Act",
        description: "Cut the steep top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 60,
        name: "Statlig Inkomstskatt Statute",
        description: "The standard steep progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 75,
        name: "Solidarity Surtax Act",
        description: "Raise top rates further",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 85,
        name: "Marginal Tax Maximum Act",
        description: "The near-confiscatory top marginal rates of the era",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "se_corporate_tax",
    countryScope: "se",
    name: "Bolagsskatt Statute",
    description: "Sets the corporate income tax rate",
    explanation: "Tax on company profits (bolagsskatt).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: sePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("se_corporate_tax", [
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
        rate: 35,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 50,
        name: "Bolagsskatt Statute",
        description: "The standard 1979 corporate rate (with generous reserves)",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 60,
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
    _id: "se_vat",
    countryScope: "se",
    name: "Moms Schedule",
    description: "Sets the value-added tax (moms) rate",
    explanation: "Sweden's moms (VAT), in place since 1969, is a major revenue source.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: sePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("se_vat", [
      {
        rate: 0,
        name: "Abolish Moms Act",
        description: "Eliminate the VAT",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 12,
        name: "Reduced Moms Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 21,
        name: "Moms Schedule",
        description: "The standard 1979 moms rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 28,
        name: "Revenue Moms Act",
        description: "Raise VAT to fund welfare",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "se_social_charges",
    countryScope: "se",
    name: "Arbetsgivaravgift Statute",
    description: "Sets employer social-security contributions (arbetsgivaravgift)",
    explanation: "Sweden funds its welfare state heavily through employer payroll fees.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: sePositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("se_social_charges", [
      {
        rate: 15,
        name: "Charge Relief Act",
        description: "Cut employer fees to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 33,
        name: "Arbetsgivaravgift Statute",
        description: "The standard high employer fees",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 45,
        name: "Expanded Welfare Act",
        description: "Raise fees to expand benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "se_customs_tariff",
    countryScope: "se",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (Sweden as an EFTA member)",
    explanation: "Sweden trades freely within EFTA; the lever models openness vs protection.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: sePositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("se_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Act",
        description: "Open EFTA-aligned free trade",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 6,
        name: "Customs Tariff Statute",
        description: "The standard low tariff",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
        name: "Industry Protection Act",
        description: "Protect shipyards and steel behind tariffs",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Wage-earner funds: private ownership ↔ union funds (löntagarfonder) ──────
  {
    _id: "se_wage_earner_funds",
    countryScope: "se",
    name: "Löntagarfonder Law",
    description: "Sets the balance of private vs collective (union-fund) ownership",
    explanation:
      "The defining 1970s–80s Swedish debate: the LO/Meidner plan for wage-earner funds — union-controlled funds buying company shares from taxed profits, gradually socialising ownership — vs keeping firms privately owned.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
    ],
    positions: sePositions("Industry"),
    policyOptions: policyOptions(
      "se_wage_earner_funds",
      [
        {
          name: "Private Ownership Guarantee Act",
          explanation: "Bar collective funds; protect private ownership",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Free-Market Reform",
          explanation: "Deregulate capital and keep firms privately held",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Status Quo Ownership Statute",
          explanation: "Private ownership with the existing mixed economy",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Wage-Earner Funds (Partial)",
          explanation: "Establish modest union-controlled wage-earner funds",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Meidner Plan Funds",
          explanation: "Full löntagarfonder gradually transferring ownership to labour",
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

  // ── Labor: codetermination (MBL) ────────────────────────────────────────────
  {
    _id: "se_labor_law",
    countryScope: "se",
    name: "Medbestämmandelagen Statute",
    description: "Sets labor protection and worker codetermination",
    explanation:
      "The 1976 MBL gave unions strong codetermination rights; the lever spans flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: sePositions("Labour"),
    policyOptions: policyOptions(
      "se_labor_law",
      [
        {
          name: "Labor Market Liberalization Act",
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
          name: "Medbestämmandelagen Statute",
          explanation: "Strong codetermination + the active labour-market model",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Union Power Expansion Act",
          explanation: "Extend codetermination toward economic democracy",
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

  // ── Welfare: the folkhem ────────────────────────────────────────────────────
  // socialSecurity budget line: folkpension (1913/1946 universal old-age
  // pension) + the 1947 universal child allowance. Default idx3 (the most
  // generous option — "folkhem under active construction," per
  // COUNTRY_POLICY_CONFIGS_1953.se) reconciles to 10.56% of GDP
  // (kr3.8B / kr36B).
  {
    _id: "se_welfare_state",
    countryScope: "se",
    name: "Folkhemmet Statute",
    description: "Sets the generosity of the universal welfare state",
    explanation:
      "Sweden's universal folkhem — childcare, pensions, healthcare, parental leave — can be retrenched or expanded.",
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
    positions: sePositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_welfare_state",
        [
          {
            name: "Welfare Retrenchment Act",
            explanation: "Cut benefits and shift to private provision",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim benefit growth to control spending",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Folkhemmet Statute",
            explanation: "Maintain the universal welfare state",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Universal Welfare Expansion Act",
            explanation: "Expand childcare, parental leave and pensions",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.03621, 0.05172, 0.07389, 0.10556]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: Sjukförsäkring / county-council care ────────────────────────────
  // healthcare budget line. Default idx2 reconciles to 4.17% of GDP
  // (kr1.5B / kr36B).
  {
    _id: "se_health_insurance",
    countryScope: "se",
    name: "Sjukförsäkring Act",
    description: "Sets funding for county-council health services and sickness insurance",
    explanation:
      "Sweden's landsting (county councils) run universal hospital and primary care, backed by the national Sjukförsäkring sickness-benefit scheme. The lever spans austerity to expanded coverage.",
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
    positions: sePositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_health_insurance",
        [
          {
            name: "Sjukvård Retrenchment Act",
            explanation: "Cut county-council health funding",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim funding growth to balance county budgets",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Sjukförsäkring Act",
            explanation: "Maintain universal county-council health coverage",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Sjukvård Expansion Act",
            explanation: "Expand hospital capacity and sickness-benefit generosity",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02083, 0.03125, 0.04167, 0.05833]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Folkskolan ────────────────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 3.33% of GDP
  // (kr1.2B / kr36B).
  {
    _id: "se_education_funding",
    countryScope: "se",
    name: "Folkskolan Act",
    description: "Sets funding for the state school system",
    explanation:
      "Sweden's folkskolan (compulsory primary school) and the expanding realskola/gymnasium tiers, on the eve of the 1962 comprehensive-school (grundskola) reform. The lever spans austerity to expanded state investment.",
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
    positions: sePositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_education_funding",
        [
          {
            name: "Folkskolan Retrenchment Act",
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
            name: "Folkskolan Act",
            explanation: "Maintain the state school system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Folkskolan Expansion Act",
            explanation: "Expand schools and prepare the comprehensive-school reform",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01667, 0.025, 0.03333, 0.04667]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: hydropower and roads ────────────────────────────────────
  // infrastructure budget line. Default idx2 reconciles to 4.17% of GDP
  // (kr1.5B / kr36B).
  {
    _id: "se_infrastructure_investment",
    countryScope: "se",
    name: "Vattenkraft och Väg Act",
    description: "Sets funding for hydropower, road and rail investment",
    explanation:
      "State investment in Vattenfall's hydropower expansion (norra Norrland's rivers), the national road network, and SJ rail — the backbone of Sweden's export-led industrial boom. The lever spans austerity to an accelerated investment drive.",
    policyDomain: "infrastructure",
    subCategory: "Energy & transport investment",
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
    positions: sePositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_infrastructure_investment",
        [
          {
            name: "Investment Retrenchment Act",
            explanation: "Scale back hydropower and road investment",
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
            name: "Vattenkraft och Väg Act",
            explanation: "Maintain the state hydropower and road investment programme",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Investment Expansion Act",
            explanation: "Expand hydropower, rail and road investment",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02083, 0.03125, 0.04167, 0.05833]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: Försvarsbeslutet (neutral but large armed forces) ─────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center) reconciles to 5.56% of GDP (kr2B / kr36B) — a large
  // force for a neutral state, funding the domestic Saab/Bofors arms industry.
  {
    _id: "se_defense_appropriations",
    countryScope: "se",
    name: "Försvarsbeslutet Act",
    description: "Sets the overall military appropriations envelope",
    explanation:
      "Sweden's armed-neutrality doctrine funds a large domestically-armed military (Saab fighters, Bofors artillery) despite staying outside NATO. The Försvarsbeslut sets the multi-year appropriation. The lever spans disarmament to accelerated rearmament.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: sePositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_defense_appropriations",
        [
          {
            name: "Disarmament Act",
            explanation: "Cut the armed forces sharply",
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
            name: "Försvarsbeslutet Act",
            explanation: "Maintain the standing armed-neutrality appropriation",
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
      [0.01944, 0.03333, 0.05556, 0.08889]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: industrial subsidies ─────────────────────────────────────────────
  // "other" budget line — support for export industry, shipyards and
  // agricultural price supports. Default idx2 reconciles to 3.33% of GDP
  // (kr1.2B / kr36B).
  {
    _id: "se_economic_subsidies",
    countryScope: "se",
    name: "Industristöd Act",
    description: "Sets the level of subsidies to export industry and agriculture",
    explanation:
      "State support for shipyards, steel and export-led manufacturing, plus agricultural price supports under the SAP-LO growth model. The lever spans austerity to expanded state support.",
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
    positions: sePositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to export industry and farms",
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
            name: "Industristöd Act",
            explanation: "Maintain support for export industry and farm prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for export industry and farm prices",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01667, 0.025, 0.03333, 0.04667]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: transfers to kommuner and landsting ─────────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 5.00% of GDP (kr1.8B / kr36B) — a large transfer, since kommuner/landsting
  // deliver most social services.
  {
    _id: "se_local_grants",
    countryScope: "se",
    name: "Statsbidrag till Kommuner Act",
    description: "Sets central government transfers to kommuner and landsting",
    explanation:
      "The state's statsbidrag to kommuner (municipalities) and landsting (county councils), which deliver most Swedish social services directly. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: sePositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "se_local_grants",
        [
          {
            name: "Transfer Retrenchment Act",
            explanation: "Cut transfers to kommuner and landsting",
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
            name: "Statsbidrag till Kommuner Act",
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
      [0.025, 0.0375, 0.05, 0.07]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default seLegislationTypes;
