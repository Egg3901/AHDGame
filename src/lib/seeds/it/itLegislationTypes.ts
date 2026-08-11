import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Italy (IT) legislation — 1979 First Republic, a mixed economy with vast state
 * holdings (IRI, ENI) and a strong welfare/union tradition. The defining lever is
 * the scope of the state-holding sector (privatize ↔ expand). countryScope "it".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 secular … +5 traditional.
 * effectTargetsWeighted signed relative to LEFT (+1) so right options carry the
 * natural-metric upside (passes policySymmetry).
 */
function itPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "cd_chair",
      name: `Chair, Chamber Committee on ${domainLabel}`,
      chamber: "cameraDeputati",
    },
    {
      positionId: "cd_vice",
      name: `Vice-Chair, Chamber Committee on ${domainLabel}`,
      chamber: "cameraDeputati",
    },
  ];
}

export const itLegislationTypes: LegislationType[] = [
  {
    _id: "it_income_tax",
    countryScope: "it",
    name: "IRPEF Statute",
    description: "Sets the top personal income tax (IRPEF) rate",
    explanation: "Italy's progressive IRPEF, introduced in the 1973 reform.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: itPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("it_income_tax", [
      {
        rate: 0,
        name: "Abolish IRPEF Act",
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
        name: "Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 45,
        name: "IRPEF Statute",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 60,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for social spending",
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
    _id: "it_corporate_tax",
    countryScope: "it",
    name: "IRPEG Statute",
    description: "Sets the corporate income tax (IRPEG) rate",
    explanation: "Tax on company profits (IRPEG / later IRES).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: itPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("it_corporate_tax", [
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
        rate: 25,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 36,
        name: "IRPEG Statute",
        description: "The standard corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 48,
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
    _id: "it_vat",
    countryScope: "it",
    name: "IVA Schedule",
    description: "Sets the value-added tax (IVA) rate",
    explanation: "Italy's IVA (VAT), the largest indirect tax.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: itPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("it_vat", [
      {
        rate: 0,
        name: "Abolish IVA Act",
        description: "Eliminate VAT",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 9,
        name: "Reduced IVA Act",
        description: "A single low rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 15,
        name: "IVA Schedule",
        description: "The standard 1979 IVA rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 22,
        name: "Revenue IVA Act",
        description: "Raise VAT to fund the budget",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "it_social_charges",
    countryScope: "it",
    name: "Contributi INPS Statute",
    description: "Sets employer social-security contributions (INPS)",
    explanation: "Italy funds pensions and benefits via high INPS contributions.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: itPositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("it_social_charges", [
      {
        rate: 12,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 28,
        name: "Contributi INPS Statute",
        description: "The standard high Italian social charges",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 40,
        name: "Expanded Welfare Act",
        description: "Raise charges to expand pensions",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "it_customs_tariff",
    countryScope: "it",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (within EEC constraints)",
    explanation:
      "Italy trades within the EEC customs union; the lever models protectionism vs openness.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: itPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("it_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Act",
        description: "Open EEC-aligned free trade",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 8,
        name: "Customs Tariff Statute",
        description: "The EEC common external tariff",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
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

  // ── State holdings: privatize ↔ expand IRI/ENI ──────────────────────────────
  {
    _id: "it_state_holdings",
    countryScope: "it",
    name: "Partecipazioni Statali Law",
    description: "Sets the scope of the state-holding sector (IRI, ENI, EFIM)",
    explanation:
      "Italy's distinctive state-holding system (IRI, ENI) owns banks, steel, energy and manufacturing. The lever spans privatization to further nationalization.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: itPositions("Industry"),
    policyOptions: policyOptions(
      "it_state_holdings",
      [
        {
          name: "Mass Privatization Act",
          explanation: "Sell off IRI/ENI holdings; minimal state sector",
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
          name: "Partecipazioni Statali Law",
          explanation: "Maintain the IRI/ENI mixed-economy holding system",
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

  // ── Labor: Statuto dei Lavoratori ───────────────────────────────────────────
  {
    _id: "it_labor_law",
    countryScope: "it",
    name: "Statuto dei Lavoratori Statute",
    description: "Sets labor protection and worker rights",
    explanation:
      "The 1970 Statuto dei Lavoratori gave Italian workers strong protections (Article 18); the lever spans flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: itPositions("Labour"),
    policyOptions: policyOptions(
      "it_labor_law",
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
          name: "Statuto dei Lavoratori Statute",
          explanation: "Strong statutory protections (Article 18) + scala mobile",
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

  // ── Welfare / pensions ──────────────────────────────────────────────────────
  // socialSecurity budget line: INPS pensions. Default idx2 reconciles to
  // 7.06% of GDP ($1.2B / $17B, USD-anchored per the IT budget config note).
  {
    _id: "it_welfare_state",
    countryScope: "it",
    name: "Stato Sociale Statute",
    description: "Sets welfare and pension generosity",
    explanation:
      "Italy's pension-heavy welfare state (INPS) and the new 1978 national health service (SSN) can be retrenched or expanded.",
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
    positions: itPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_welfare_state",
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
            explanation: "Trim pension growth to control the deficit",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Stato Sociale Statute",
            explanation: "Maintain generous pensions + the new SSN",
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
      [0.03459, 0.04941, 0.07059, 0.09882]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: INAM mutualist sickness insurance (pre-SSN) ─────────────────────
  // healthcare budget line. Default idx2 reconciles to 1.88% of GDP
  // ($320M / $17B).
  {
    _id: "it_health_insurance",
    countryScope: "it",
    name: "Assicurazione Malattia (INAM) Act",
    description: "Sets funding for the occupational sickness-insurance funds (INAM/mutue)",
    explanation:
      "Italy's fragmented pre-SSN system: occupational mutue (INAM and sister funds) reimburse doctor visits and hospital stays. The national health service (SSN) is still 25 years away. The lever spans austerity to expanded mutue funding.",
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
    positions: itPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_health_insurance",
        [
          {
            name: "Mutue Retrenchment Act",
            explanation: "Cut occupational-fund reimbursement",
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
            name: "Assicurazione Malattia (INAM) Act",
            explanation: "Maintain the mutualist sickness-insurance system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Mutue Expansion Act",
            explanation: "Widen coverage and reimbursement across the mutue",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.00941, 0.01412, 0.01882, 0.02635]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Istruzione Pubblica ──────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 3.29% of GDP
  // ($560M / $17B).
  {
    _id: "it_education_funding",
    countryScope: "it",
    name: "Istruzione Pubblica Act",
    description: "Sets funding for the state school and university system",
    explanation:
      "Italy's centralised Istruzione Pubblica — primary schools, licei, and the university system, still marked by a wide north-south gap. The lever spans austerity to expanded state investment.",
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
    positions: itPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_education_funding",
        [
          {
            name: "Istruzione Pubblica Retrenchment Act",
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
            name: "Istruzione Pubblica Act",
            explanation: "Maintain the centralised state education system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Istruzione Pubblica Expansion Act",
            explanation: "Expand schools, licei and university places, closing the north-south gap",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01647, 0.02471, 0.03294, 0.04612]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: Cassa per il Mezzogiorno ────────────────────────────────
  // infrastructure budget line. Default idx2 reconciles to 4.71% of GDP
  // ($800M / $17B).
  {
    _id: "it_infrastructure_investment",
    countryScope: "it",
    name: "Cassa per il Mezzogiorno Act",
    description: "Sets funding for the southern-development and reconstruction investment fund",
    explanation:
      "The Cassa per il Mezzogiorno (established August 1950) — the flagship state fund for roads, aqueducts, land reclamation and industrial infrastructure in the impoverished South, alongside Marshall Plan reconstruction in the North. The lever spans austerity to an accelerated investment drive.",
    policyDomain: "infrastructure",
    subCategory: "Southern development & reconstruction",
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
    positions: itPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_infrastructure_investment",
        [
          {
            name: "Cassa Retrenchment Act",
            explanation: "Scale back the southern-development fund",
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
            name: "Cassa per il Mezzogiorno Act",
            explanation: "Maintain the Cassa's southern-development investment",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Mezzogiorno Investment Expansion Act",
            explanation: "Expand roads, land reclamation and industrial infrastructure",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02353, 0.03529, 0.04706, 0.06588]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: NATO membership ─────────────────────────────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center) reconciles to 2.82% of GDP ($480M / $17B).
  {
    _id: "it_defense_appropriations",
    countryScope: "it",
    name: "Difesa Nazionale Act",
    description: "Sets the overall military appropriations envelope",
    explanation:
      "Italy's postwar armed forces, constitutionally capped and rebuilt within NATO (joined 1949) after the Treaty of Paris disarmament clauses. The lever spans further disarmament to accelerated rearmament.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: itPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_defense_appropriations",
        [
          {
            name: "Disarmament Act",
            explanation: "Cut the armed forces to the treaty minimum",
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
            name: "Difesa Nazionale Act",
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
      [0.00988, 0.01694, 0.02824, 0.04518]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: IRI/ENI operating subsidies ───────────────────────────────────────
  // "other" budget line — operating subsidies to the state-holding sector
  // beyond the ownership question already modeled by it_state_holdings.
  // Default idx2 reconciles to 3.76% of GDP ($640M / $17B).
  {
    _id: "it_economic_subsidies",
    countryScope: "it",
    name: "Sovvenzioni IRI/ENI Act",
    description: "Sets the level of operating subsidies to the state-holding sector",
    explanation:
      "Operating subsidies and price supports channeled through IRI and the new ENI (founded 1953 under Enrico Mattei) — steel, shipbuilding, energy — plus support for smallholder agriculture. The lever spans austerity to expanded state support.",
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
    positions: itPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to IRI/ENI and agriculture",
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
            name: "Sovvenzioni IRI/ENI Act",
            explanation: "Maintain support for the state-holding sector and farm prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for the state-holding sector and farm prices",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01882, 0.02824, 0.03765, 0.05271]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: transfers to comuni and province ────────────────────────────────
  // isGrant law (stateGrants line, not byCategory; Italy's regions are not
  // established until 1970, so 1953 transfers run to comuni/province).
  // Default idx2 reconciles to 2.35% of GDP ($400M / $17B).
  {
    _id: "it_local_grants",
    countryScope: "it",
    name: "Finanza Locale Act",
    description: "Sets central government transfers to comuni and province",
    explanation:
      "Rome's fiscal-equalisation transfer to Italy's comuni and province — the regions are not established until 1970. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: itPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "it_local_grants",
        [
          {
            name: "Transfer Retrenchment Act",
            explanation: "Cut transfers to comuni and province",
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
            name: "Finanza Locale Act",
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
      [0.01176, 0.01765, 0.02353, 0.03294]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default itLegislationTypes;
