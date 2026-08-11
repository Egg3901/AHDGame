import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * France (FR) legislation — 1979 Fifth Republic, a market economy with a large
 * welfare state. The defining lever is nationalization ↔ privatization (the
 * left's 1972 Programme commun vs the governing centre-right). countryScope "fr".
 *
 * economic axis: -5 statist/dirigiste … +5 liberal/market.
 * social axis:   -5 secular/liberal … +5 traditional.
 * effectTargetsWeighted signed relative to LEFT (+1) so right options carry the
 * natural-metric upside (passes policySymmetry).
 */

function frPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "an_chair",
      name: `Chair, National Assembly Committee on ${domainLabel}`,
      chamber: "assembleeNationale",
    },
    {
      positionId: "an_vice",
      name: `Vice-Chair, National Assembly Committee on ${domainLabel}`,
      chamber: "assembleeNationale",
    },
  ];
}

export const frLegislationTypes: LegislationType[] = [
  {
    _id: "fr_income_tax",
    countryScope: "fr",
    name: "Impôt sur le Revenu Statute",
    description: "Sets the top marginal personal income tax rate",
    explanation:
      "France's progressive impôt sur le revenu. The lever spans deep cuts (liberal) to steeply progressive top rates (left).",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: frPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("fr_income_tax", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate the income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 15,
        name: "Flat Tax Reform",
        description: "A low flat income tax",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Moderate Relief Act",
        description: "Cut top rates to spur investment",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 45,
        name: "Impôt sur le Revenu Statute",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 55,
        name: "Solidarity Surtax Act",
        description: "Raise top rates to fund social programs",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 65,
        name: "Wealth Redistribution Act",
        description: "Steeply progressive top rates",
        stance: "left",
        economic: -4,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fr_corporate_tax",
    countryScope: "fr",
    name: "Impôt sur les Sociétés Statute",
    description: "Sets the corporate income tax rate",
    explanation: "France's impôt sur les sociétés on company profits.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: frPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("fr_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 15,
        name: "Competitive Rate Act",
        description: "Low rate to attract capital",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Business Relief Act",
        description: "Cut the rate for investment",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 50,
        name: "Impôt sur les Sociétés Statute",
        description: "The standard 1979 corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 60,
        name: "Excess Profits Act",
        description: "Higher rate on company profits",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fr_vat",
    countryScope: "fr",
    name: "TVA Schedule",
    description: "Sets the value-added tax (TVA) rate",
    explanation: "France invented the VAT (TVA, 1954); it is the largest revenue source.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: frPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("fr_vat", [
      {
        rate: 0,
        name: "Abolish TVA Act",
        description: "Eliminate the VAT",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Reduced TVA Act",
        description: "A single low VAT rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 18,
        name: "TVA Schedule",
        description: "The standard 1979 TVA rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 25,
        name: "Luxury TVA Act",
        description: "Raise the VAT to fund the budget",
        stance: "left",
        economic: -2,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fr_social_charges",
    countryScope: "fr",
    name: "Cotisations Sociales Statute",
    description: "Sets employer social-security contributions (cotisations sociales)",
    explanation: "France funds its Sécurité sociale through high employer/employee social charges.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: frPositions("Social Affairs"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("fr_social_charges", [
      {
        rate: 10,
        name: "Charge Relief Act",
        description: "Cut social charges to boost employment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 25,
        name: "Cotisations Sociales Statute",
        description: "The standard high French social charges",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 38,
        name: "Expanded Sécurité Sociale Act",
        description: "Raise charges to expand welfare",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "fr_customs_tariff",
    countryScope: "fr",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (within EEC constraints)",
    explanation:
      "France trades within the EEC customs union; the lever models protectionism vs openness.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: frPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("fr_customs_tariff", [
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
        description: "The standard EEC common external tariff",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "National Protection Act",
        description: "Protect French industry behind higher tariffs",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── Scenario lever: nationalization ↔ privatization (Programme commun) ───────
  {
    _id: "fr_nationalization",
    countryScope: "fr",
    name: "Industrial Ownership Law",
    description: "Sets the balance of state vs private ownership of industry and banks",
    explanation:
      "The defining 1979 economic divide: the left's Programme commun called for nationalizing banks and major industrial groups; the governing right favored the mixed-but-market status quo and (later) privatization.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
    ],
    positions: frPositions("Industry"),
    policyOptions: policyOptions(
      "fr_nationalization",
      [
        {
          name: "Mass Privatization Act",
          explanation: "Sell state enterprises; minimal public sector",
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
          name: "Mixed Economy Statute",
          explanation: "The dirigiste mixed economy — strategic state firms + private markets",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Industrial Ownership Law (Partial Nationalization)",
          explanation: "Nationalize key banks and a few industrial groups",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Programme Commun Nationalizations",
          explanation: "Nationalize the banks and the major industrial groups (the 1981 program)",
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

  // ── Labor law: flexible ↔ protective ────────────────────────────────────────
  {
    _id: "fr_labor_law",
    countryScope: "fr",
    name: "Code du Travail Statute",
    description: "Sets labor-market protection and worker rights",
    explanation:
      "From flexible hire-and-fire liberalization to strong Code du Travail protections, the 35-hour-week tradition, and union codetermination.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: frPositions("Labour"),
    policyOptions: policyOptions(
      "fr_labor_law",
      [
        {
          name: "Labor Market Liberalization Act",
          explanation: "Flexible contracts, easier dismissal, deregulated hours",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          name: "Moderate Flexibility Act",
          explanation: "Ease some hiring rules while keeping core protections",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Code du Travail Statute",
          explanation: "Strong statutory worker protections and collective bargaining",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Worker Codetermination Act",
          explanation: "Extend protections, shorten the work week, and expand union power",
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

  // ── Welfare state generosity ────────────────────────────────────────────────
  // socialSecurity budget line: pensions (vieillesse) + family allowances
  // (allocations familiales) under the 1945 Sécurité Sociale ordinances. The
  // Monnet Plan (reconstruction investment) and Indochina War (defense) are
  // costed separately below — this type covers the Sécu's cash-transfer core
  // only. Ladder calibrated so the default (idx2, "Sécurité Sociale Statute",
  // the 1953 baseline per src/lib/seeds/reference/budgets.ts's FR 1953
  // config) reconciles to 10.94% of GDP (₣1,800B / ₣16,450B).
  {
    _id: "fr_welfare_state",
    countryScope: "fr",
    name: "Sécurité Sociale Statute",
    description: "Sets the generosity of the social-security and welfare system",
    explanation:
      "France's comprehensive Sécurité sociale — pensions, family benefits, healthcare — can be retrenched (liberal) or expanded (left).",
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
    positions: frPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_welfare_state",
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
            explanation: "Trim benefit growth to balance the funds",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Sécurité Sociale Statute",
            explanation: "Maintain the comprehensive welfare state",
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
      [0.05362, 0.0766, 0.10942, 0.15319]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: assurance maladie / hospital funding ────────────────────────────
  // healthcare budget line. Pre-SSN (Sécu covers reimbursement, but the state
  // separately funds the public-hospital network — the 1941/1945 hôpitaux
  // publics system rebuilt with Marshall Plan aid). Default idx2 reconciles
  // to 3.65% of GDP (₣600B / ₣16,450B).
  {
    _id: "fr_health_insurance",
    countryScope: "fr",
    name: "Politique Hospitalière Act",
    description: "Sets funding for the public hospital network and health reimbursement rates",
    explanation:
      "France's public hôpitaux — rebuilt with Marshall Plan aid — and the Sécurité sociale's assurance-maladie reimbursement schedule. The lever spans austerity to expanded coverage.",
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
    positions: frPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_health_insurance",
        [
          {
            name: "Hospital Budget Retrenchment Act",
            explanation: "Cut hospital budgets and reimbursement rates",
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
            name: "Politique Hospitalière Act",
            explanation: "Maintain the public hospital network and standard reimbursement",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Hospital Expansion Act",
            explanation: "Expand public hospital capacity and reimbursement generosity",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01824, 0.02736, 0.03647, 0.05106]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Éducation Nationale ──────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 4.26% of GDP
  // (₣700B / ₣16,450B).
  {
    _id: "fr_education_funding",
    countryScope: "fr",
    name: "Éducation Nationale Act",
    description: "Sets funding for the state education system",
    explanation:
      "France's centralised Éducation Nationale — primary schools, lycées, and the growing university system. The lever spans austerity to expanded state investment.",
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
    positions: frPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_education_funding",
        [
          {
            name: "Éducation Nationale Retrenchment Act",
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
            name: "Éducation Nationale Act",
            explanation: "Maintain the centralised state education system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Éducation Nationale Expansion Act",
            explanation: "Expand schools, lycées and university places",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.02128, 0.03191, 0.04255, 0.05957]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: Plan de Modernisation et d'Équipement (Monnet Plan) ─────
  // infrastructure budget line. Default idx2 reconciles to 3.65% of GDP
  // (₣600B / ₣16,450B).
  {
    _id: "fr_infrastructure_investment",
    countryScope: "fr",
    name: "Plan de Modernisation et d'Équipement",
    description: "Sets funding for the state reconstruction and modernisation plan",
    explanation:
      "Jean Monnet's Plan de Modernisation et d'Équipement (1946) — Marshall-Plan-funded investment rebuilding coal, steel, electricity, cement, and rail. The lever spans austerity to an accelerated modernisation drive.",
    policyDomain: "infrastructure",
    subCategory: "Reconstruction & modernisation",
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
    positions: frPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_infrastructure_investment",
        [
          {
            name: "Plan Retrenchment Act",
            explanation: "Scale back the modernisation plan",
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
            name: "Plan de Modernisation et d'Équipement",
            explanation: "Maintain the Monnet Plan's reconstruction investment",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Accelerated Modernisation Act",
            explanation: "Expand investment in coal, steel, power and rail",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01824, 0.02736, 0.03647, 0.05106]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: Indochina War appropriations ───────────────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center, "the standing appropriation") reconciles to 8.51%
  // of GDP (₣1,400B / ₣16,450B) — the Indochina War at its 1953 peak.
  {
    _id: "fr_defense_appropriations",
    countryScope: "fr",
    name: "Loi des Crédits Militaires",
    description: "Sets the overall military appropriations envelope, including the Indochina War",
    explanation:
      "France's Loi des Crédits Militaires funds the metropolitan army, NATO commitments, and above all the Indochina War (Corps Expéditionnaire) — near its peak drain on the 1953 budget. The lever spans disengagement to further escalation.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: frPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_defense_appropriations",
        [
          {
            name: "Indochina Disengagement Act",
            explanation: "Wind down the expeditionary corps and cut appropriations",
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
            name: "Loi des Crédits Militaires",
            explanation: "Maintain the standing appropriation, Indochina included",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Escalation Act",
            explanation: "Expand appropriations and reinforce the expeditionary corps",
            stance: "right",
            economic: 0,
            social: 4,
          },
        ],
        "social"
      ),
      [0.02979, 0.05106, 0.08511, 0.13617]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: state industrial and agricultural subsidies ──────────────────────
  // "other" budget line — subsidies to nationalized industry (Renault, Charbonnages
  // de France, EDF/GDF) plus agricultural price supports. Default idx2
  // reconciles to 4.56% of GDP (₣750B / ₣16,450B).
  {
    _id: "fr_economic_subsidies",
    countryScope: "fr",
    name: "Subventions Économiques Act",
    description: "Sets the level of subsidies to nationalized industry and agriculture",
    explanation:
      "Operating subsidies to the nationalized sector (Renault, Charbonnages de France, EDF/GDF) and agricultural price supports for French farmers. The lever spans austerity to expanded state support.",
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
    positions: frPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut subsidies to nationalized industry and farms",
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
            name: "Subventions Économiques Act",
            explanation: "Maintain support for nationalized industry and farm prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand support for nationalized industry and farm prices",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.0228, 0.0342, 0.04559, 0.06383]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: transfers to départements and communes ──────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 2.43% of GDP (₣400B / ₣16,450B).
  {
    _id: "fr_local_grants",
    countryScope: "fr",
    name: "Dotation aux Collectivités Locales",
    description: "Sets central government transfers to départements and communes",
    explanation:
      "The state's fiscal-equalisation transfer to France's départements and communes, funding local services from Paris. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: frPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "fr_local_grants",
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
            name: "Dotation aux Collectivités Locales",
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
      [0.01216, 0.01824, 0.02432, 0.03404]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default frLegislationTypes;
