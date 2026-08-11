import type { LegislationType } from "@/lib/db/types/legislation";
import { policyOptions, taxRateOptions } from "../reference/policyOptionHelpers";

/**
 * USSR (SU) legislation — designed to span BOTH playable trajectories:
 *   • SU-continuing: keep the command economy + one-party state (the left /
 *     state-control / democratic-centralist option ends — the 1979 defaults).
 *   • Russia liberalizing: privatization, market prices, multiparty democracy,
 *     glasnost (the right / market / liberal option ends — the reform path that
 *     pairs with the country config's `collapseTargetSystem: parliamentaryRepublic`).
 *
 * A single set of levers serves both: the option a player/NPP enacts decides the
 * path. The fiscal levers also back the FY1979 national budget (taxPolicyIds in
 * reference/budgets.ts). countryScope "ru"; gated to the 1979 preset via the
 * country being 1979-only.
 *
 * economic axis: -5 command/state-control … +5 market/private.
 * social axis:   -5 liberal/glasnost … +5 authoritarian/orthodox.
 */

function supremeSovietPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "ss_chair",
      name: `Chair, Supreme Soviet Committee on ${domainLabel}`,
      chamber: "sovietOfTheUnion",
    },
    {
      positionId: "ss_vice",
      name: `Vice-Chair, Supreme Soviet Committee on ${domainLabel}`,
      chamber: "sovietOfTheUnion",
    },
  ];
}

export const ruLegislationTypes: LegislationType[] = [
  // ── Tax: enterprise profit remittance / corporate tax (domesticCorporateTax) ─
  {
    _id: "su_enterprise_levy",
    countryScope: "ru",
    name: "Enterprise Profit Remittance Statute",
    description: "Sets the share of state-enterprise profit remitted to the central budget",
    explanation:
      "In the planned economy the budget is funded mainly by state-enterprise profit deductions (otchisleniya) and the turnover tax. Lowering the remittance share toward a Western-style corporate tax is the core marketization lever.",
    policyDomain: "tax",
    subCategory: "Enterprise taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: supremeSovietPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("su_enterprise_levy", [
      {
        rate: 0,
        name: "Full Privatization Act",
        description:
          "Abolish profit remittance; enterprises become private firms taxed only via consumption",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 10,
        name: "Market Enterprise Law",
        description:
          "Low flat corporate tax replacing remittance — full khozraschet (self-financing) and private ownership",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Cooperative Enterprise Reform",
        description:
          "Permit cooperatives and joint ventures; modest profit tax (cf. the 1987 Law on State Enterprise)",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 35,
        name: "Mixed Remittance Statute",
        description: "Partial self-financing with a reduced central remittance share",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 55,
        name: "Enterprise Profit Remittance Statute",
        description: "Standard Gosplan-era profit deductions to the all-union budget",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 75,
        name: "Total Surplus Appropriation Act",
        description: "Near-total appropriation of enterprise surplus to fund the central plan",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Tax: individual income tax (incomeTax) ──────────────────────────────────
  {
    _id: "su_individual_income_tax",
    countryScope: "ru",
    name: "Income Tax of Citizens Statute",
    description: "Sets the personal income tax rate",
    explanation:
      "Soviet personal income tax was low and flat (wages were set centrally). A reformer can build a progressive market-style income tax; a hardliner keeps the token flat levy.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: supremeSovietPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("su_individual_income_tax", [
      {
        rate: 0,
        name: "Abolish Wage Tax Act",
        description: "Eliminate income tax entirely in a deregulated wage market",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 8,
        name: "Flat Citizens' Levy",
        description: "The traditional low flat Soviet wage tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Progressive Income Tax Act",
        description: "A Western-style progressive income tax to fund a transitional welfare state",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 35,
        name: "Redistributive Income Tax Act",
        description: "Steeply progressive rates to compress post-reform inequality",
        stance: "left",
        economic: -4,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Tax: turnover tax / VAT (salesTax) ──────────────────────────────────────
  {
    _id: "su_turnover_tax",
    countryScope: "ru",
    name: "Turnover Tax Schedule",
    description: "Sets the turnover tax embedded in consumer-goods prices",
    explanation:
      "The turnover tax (nalog s oborota) — the gap between the fixed retail price and the wholesale price — was a pillar of Soviet revenue. Reform converts it into a transparent value-added tax.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: supremeSovietPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("su_turnover_tax", [
      {
        rate: 0,
        name: "Abolish Turnover Tax Act",
        description: "Free retail prices entirely; no consumption tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 12,
        name: "Transparent VAT Act",
        description: "Replace the hidden turnover tax with a modern value-added tax",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "Turnover Tax Schedule",
        description: "The standard embedded turnover-tax wedge on consumer goods",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximal Price-Wedge Act",
        description: "Widen the turnover wedge to maximize budget revenue and suppress consumption",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Tax: social insurance (payrollTax) ──────────────────────────────────────
  {
    _id: "su_social_insurance",
    countryScope: "ru",
    name: "Social Insurance Contribution Statute",
    description: "Sets the enterprise social-insurance contribution funding pensions and benefits",
    explanation:
      "Soviet social insurance was funded by enterprise contributions to the unified state social fund. Reform can shift it toward a contributory market pension system.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: supremeSovietPositions("Labour and Social Welfare"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("su_social_insurance", [
      {
        rate: 4,
        name: "Private Pension Transition Act",
        description: "Minimal state contribution; shift to funded private pensions",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 14,
        name: "Unified Social Insurance Statute",
        description: "The standard enterprise contribution to the all-union social fund",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Expanded Welfare Fund Act",
        description: "Raise contributions to expand pensions, sanatoria and benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Tax: foreign-trade monopoly / customs (tariffs) ─────────────────────────
  {
    _id: "su_customs_tariff",
    countryScope: "ru",
    name: "Foreign Trade Monopoly Statute",
    description: "Sets the state monopoly on foreign trade and its effective tariff wall",
    explanation:
      "The Ministry of Foreign Trade held a near-total monopoly on imports/exports. Dismantling it and adopting ordinary tariffs is a central opening-up reform.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: supremeSovietPositions("Foreign Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("su_customs_tariff", [
      {
        rate: 0,
        name: "Open Trade & Convertibility Act",
        description: "Abolish the trade monopoly; free trade and a convertible ruble",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Managed Liberalization Act",
        description: "License private foreign trade behind a moderate tariff",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 25,
        name: "Foreign Trade Monopoly Statute",
        description: "Retain the state foreign-trade monopoly (high effective barrier)",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 40,
        name: "Autarkic Closure Act",
        description: "Near-total trade closure / Comecon-only autarky",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ═══ Scenario levers (command-state ↔ market/liberal) ═══════════════════════

  // ── Economic system: central planning ↔ privatization ───────────────────────
  {
    _id: "su_economic_system",
    countryScope: "ru",
    name: "Economic Organization Law",
    description: "Sets the ownership and coordination model of the economy",
    explanation:
      "The defining lever: keep Gosplan's central command economy, experiment with self-financing and cooperatives (perestroika), or transition to private ownership and markets (shock therapy).",
    policyDomain: "economic",
    subCategory: "Economic system",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    // Weights signed relative to LEFT (central planning) = +1; right (market) is
    // the natural-metric upside (economicFreedom / smallBusinessFormation rise).
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.7 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
    ],
    positions: supremeSovietPositions("Planning and Economy"),
    policyOptions: policyOptions(
      "su_economic_system",
      [
        {
          name: "Shock Therapy Privatization Act",
          explanation: "Mass privatization, free prices and markets — the post-Soviet Russia path",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Market Transition Act",
          explanation:
            "Privatize small/medium enterprise, legalize private property, phase in markets",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Cooperative & Self-Financing Reform",
          explanation:
            "Khozraschet self-financing + cooperatives within a planned framework (perestroika)",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Reformed Planning Act",
          explanation: "Retain central planning with limited enterprise autonomy",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Economic Organization Law",
          explanation:
            "Orthodox Gosplan command economy with state ownership of the means of production",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Total Centralization Act",
          explanation: "Recentralize all production targets and abolish private plots",
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

  // ── Political system: one-party ↔ multiparty democracy ───────────────────────
  {
    _id: "su_political_system",
    countryScope: "ru",
    name: "Article 6 Statute (Party Leadership)",
    description: "Sets the constitutional role of the Communist Party and political pluralism",
    explanation:
      "Article 6 of the 1977 Constitution enshrined the CPSU's leading role. Repealing it legalizes opposition parties and competitive elections — the democratization lever; tightening it restores one-party democratic centralism.",
    policyDomain: "governance",
    subCategory: "Political system",
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
    positions: supremeSovietPositions("Constitutional Affairs"),
    policyOptions: policyOptions(
      "su_political_system",
      [
        {
          name: "Multiparty Democracy Act",
          explanation:
            "Repeal Article 6; legalize opposition parties and free competitive elections",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Contested Elections Act",
          explanation:
            "Allow multi-candidate (intra-system) elections — the 1989 Congress of People's Deputies model",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "Limited Pluralism Act",
          explanation: "Tolerate informal political associations under continued Party guidance",
          stance: "left",
          economic: 0,
          social: -1,
        },
        {
          name: "Article 6 Statute (Party Leadership)",
          explanation: "The CPSU's constitutionally-enshrined leading role; single-list elections",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Vanguard Discipline Act",
          explanation: "Reassert strict democratic centralism and purge factionalism",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Price controls: fixed planned prices ↔ market pricing ───────────────────
  {
    _id: "su_price_controls",
    countryScope: "ru",
    name: "State Price Regulation Statute",
    description: "Sets the degree of administrative price control",
    explanation:
      "Fixed retail prices (stable for decades) underpinned the social contract but caused shortages. Freeing prices ends shortages but risks inflation and unrest.",
    policyDomain: "economic",
    subCategory: "Prices",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    // LEFT (fixed prices) = +1: suppresses costOfLiving + keeps cohesion; RIGHT
    // (free prices) is the economicFreedom upside but risks inflation.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.7 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.6 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.4 },
    ],
    positions: supremeSovietPositions("Prices and Supply"),
    policyOptions: policyOptions(
      "su_price_controls",
      [
        {
          name: "Full Price Liberalization Act",
          explanation: "Free all prices to the market",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Partial Price Reform Act",
          explanation: "Free non-essential prices; keep staples controlled",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "State Price Regulation Statute",
          explanation: "Administratively fixed retail prices across the board",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Frozen Prices & Rationing Act",
          explanation: "Hold prices and introduce rationing to manage shortages",
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

  // ── Agriculture: collective/state farms ↔ private farming ───────────────────
  {
    _id: "su_agriculture",
    countryScope: "ru",
    name: "Collective Agriculture Statute",
    description: "Sets the organization of agriculture",
    explanation:
      "Kolkhoz/sovkhoz collective and state farms vs. legalized private family farming. De-collectivization is a major reform with food-supply and social consequences.",
    policyDomain: "agriculture",
    subCategory: "Farm organization",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "foodInsecurity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "foodInsecurity", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
    ],
    positions: supremeSovietPositions("Agriculture"),
    policyOptions: policyOptions(
      "su_agriculture",
      [
        {
          name: "Private Farming Act",
          explanation: "Break up collectives; legalize private family farms and land leasing",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Mixed Farm Lease Act",
          explanation: "Permit leasehold and household contracts alongside collectives",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Collective Agriculture Statute",
          explanation: "Kolkhoz/sovkhoz collective and state farms with private plots",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Agro-Industrial Complex Act",
          explanation:
            "Consolidate into large mechanized state agro-complexes; abolish private plots",
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

  // ── Civil liberties: censorship/repression ↔ glasnost ───────────────────────
  {
    _id: "su_civil_liberties",
    countryScope: "ru",
    name: "State Information & Order Statute",
    description: "Sets press freedom, expression, and the security apparatus",
    explanation:
      "From pervasive censorship and KGB control toward glasnost (openness), free press and civil rights — or back toward tightened information control.",
    policyDomain: "social",
    subCategory: "Civil liberties",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: 0.8 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
    ],
    positions: supremeSovietPositions("State Security and Justice"),
    policyOptions: policyOptions(
      "su_civil_liberties",
      [
        {
          name: "Free Press & Civil Rights Act",
          explanation: "Abolish censorship; guarantee free press, assembly and emigration",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Glasnost Openness Act",
          explanation: "Relax censorship, permit criticism and historical truth-telling",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "State Information & Order Statute",
          explanation: "Glavlit censorship and KGB oversight of public life",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Maximum Security Act",
          explanation: "Intensify surveillance, censorship and dissident suppression",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense spending ────────────────────────────────────────────────────────
  {
    _id: "su_defense_spending",
    countryScope: "ru",
    name: "Defense and Military-Industrial Statute",
    description: "Sets military expenditure and the military-industrial complex's share",
    explanation:
      "The USSR devoted an outsized share of output to defense. Converting military industry to civilian use (conversion) frees resources but disrupts the core economy.",
    policyDomain: "defense",
    subCategory: "Military spending",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    // LEFT (military buildup) = +1: raises readiness but worsens budget + diverts
    // civilian growth; RIGHT (conversion/cuts) is the fiscal upside.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "militaryReadiness", weight: 0.5 },
    ],
    positions: supremeSovietPositions("Defense"),
    policyOptions: policyOptions(
      "su_defense_spending",
      [
        {
          name: "Military Conversion Act",
          explanation: "Deep cuts; convert defense plants to consumer-goods production",
          stance: "right",
          economic: 3,
          social: -1,
        },
        {
          name: "Détente Drawdown Act",
          explanation: "Moderate arms-control-linked reductions",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Defense and Military-Industrial Statute",
          explanation: "Sustain the large standing military-industrial complex",
          stance: "left",
          economic: -2,
          social: 1,
        },
        {
          name: "Strategic Buildup Act",
          explanation: "Maximal arms buildup and Afghanistan/Cold-War escalation",
          stance: "left",
          economic: -4,
          social: 2,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Housing ─────────────────────────────────────────────────────────────────
  {
    _id: "su_housing",
    countryScope: "ru",
    name: "State Housing Allocation Statute",
    description: "Sets housing provision and ownership",
    explanation:
      "State-allocated apartments at nominal rents vs. privatized housing markets — a tangible everyday marker of the command/market choice.",
    policyDomain: "economic",
    subCategory: "Housing",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingSupplyGrowth",
      scope: "national",
    },
    // LEFT (state allocation) = +1: lowers homelessness; RIGHT (privatization) is
    // the economicFreedom upside and lifts market housing supply.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
      { metricCategoryId: "social", metricId: "housingSupplyGrowth", weight: -0.5 },
      { metricCategoryId: "social", metricId: "homelessnessRate", weight: -0.3 },
    ],
    positions: supremeSovietPositions("Housing and Construction"),
    policyOptions: policyOptions(
      "su_housing",
      [
        {
          name: "Housing Privatization Act",
          explanation: "Transfer apartments to occupants; create a private housing market",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Housing Cooperative Act",
          explanation: "Expand cooperative (paid) housing alongside state allocation",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "State Housing Allocation Statute",
          explanation: "State-built apartments allocated by waiting list at nominal rent",
          stance: "left",
          economic: -3,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default ruLegislationTypes;
