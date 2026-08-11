import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withPerCapitaCosts,
} from "../reference/policyOptionHelpers";

/**
 * Brazil (BR) legislation — 1953, Getúlio Vargas's second (constitutional) term.
 * Unlike the other market-democracy/Warsaw-Pact cohorts seeded alongside it
 * (FR/IT/ES/SE/TR/GR/AT/FI and BG/CS/HU/PL/RO/YU), Brazil had ZERO authored
 * legislation types — a fully-seeded legislature (Chamber of Deputies + an
 * electing Federal Senate) with nothing to legislate, and a federal budget
 * whose spending was a frozen constant (the all-or-nothing baseline fallback
 * in `src/lib/budget/spending.ts`) forever. This module authors BOTH halves:
 * revenue/structural levers (matching the FR/TR pattern) AND spending
 * programmes across all six budget categories (matching the CN/DE/NG/JP
 * pattern), since BR needs both to stop being inert to its own politics.
 *
 * Historical anchors, 1953: Vargas's nationalist-developmentalist "estado
 * novo"-legacy programme; Petrobras founded by Law 2004 (3 Oct 1953), the
 * state oil monopoly; Vale do Rio Doce (1942) and CSN/Volta Redonda (1941,
 * steel) already state-controlled; BNDE (Banco Nacional de Desenvolvimento
 * Econômico, June 1952) channeling investment; the SALTE Plan (Saúde,
 * Alimentação, Transporte, Energia — 1948) still nominally in force; the CLT
 * (Consolidação das Leis do Trabalho, 1943) governing labor; the IAP system
 * (Institutos de Aposentadoria e Pensões — sectoral pension/social-insurance
 * institutes, est. 1933-1938) predating the 1990 INSS unification; the IVC
 * (Imposto sobre Vendas e Consignações — a cascading state turnover tax)
 * predating the 1965 ICMS value-added reform; and the July 1953 split of the
 * old Ministério da Educação e Saúde into separate Ministério da Educação e
 * Cultura and Ministério da Saúde. No named officeholders are seeded per
 * project convention — institutions, ministries and programmes only.
 *
 * economic axis: -5 statist/dirigiste … +5 liberal/market.
 * social axis:   -5 secular/liberal … +5 traditional (unused here; 0 throughout).
 * effectTargetsWeighted signed relative to LEFT (+1), matching the FR/TR/NG
 * convention so right (market/austerity) options carry the natural-metric
 * upside.
 */

function brPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "chamber_chair",
      name: `Chair, Chamber of Deputies Committee on ${domainLabel}`,
      chamber: "chamber",
    },
    {
      positionId: "chamber_vice",
      name: `Vice-Chair, Chamber of Deputies Committee on ${domainLabel}`,
      chamber: "chamber",
    },
  ];
}

// ── Shared 5-rung spending curve (left-heavy ↔ right-light), matching the
// NG_SPENDING_CURVE convention: index 2 (center) is the calibrated default. ──
const BR_SPENDING_CURVE = [1.8, 1.4, 1.0, 0.6, 0.3];

export const brLegislationTypes: LegislationType[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // Revenue / structural levers
  // ═══════════════════════════════════════════════════════════════════════
  {
    _id: "br_income_tax_rate",
    countryScope: "br",
    name: "Imposto de Renda Statute",
    description: "Sets the top marginal personal income tax rate",
    explanation:
      "Brazil's progressive imposto de renda de pessoa física. In 1953 the tax base was narrow (agrarian economy, large informal sector), so even the 'standard' bracket raises modest revenue relative to GDP.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: brPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("br_income_tax_rate", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description: "Eliminate the income tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 8,
        name: "Flat Tax Reform",
        description: "A low flat income tax",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 13,
        name: "Moderate Relief Act",
        description: "Cut top rates to spur investment",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 18,
        name: "Imposto de Renda Statute",
        description: "The standard 1953 progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Solidarity Surtax Act",
        description: "Raise top rates to fund social programs",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 30,
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
    _id: "br_corporate_tax",
    countryScope: "br",
    name: "Imposto de Renda sobre Pessoas Jurídicas Statute",
    description: "Sets the corporate income tax rate",
    explanation:
      "Brazil's tax on company profits, levied alongside the state-controlled sector's own remittances (Petrobras, CSN, Vale).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: brPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("br_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 8,
        name: "Competitive Rate Act",
        description: "Low rate to attract capital",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 13,
        name: "Business Relief Act",
        description: "Cut the rate for investment",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 18,
        name: "Imposto de Renda sobre Pessoas Jurídicas Statute",
        description: "The standard 1953 corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 26,
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
    _id: "br_ivc",
    countryScope: "br",
    name: "Imposto sobre Vendas e Consignações Schedule",
    description: "Sets the cascading sales/turnover tax (IVC) rate",
    explanation:
      "The IVC (Imposto sobre Vendas e Consignações) was Brazil's consumption tax through 1953 — a cascading turnover levy on each sale, the direct predecessor of the value-added ICMS introduced by the 1965 tax reform.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: brPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("br_ivc", [
      {
        rate: 0,
        name: "Abolish IVC Act",
        description: "Eliminate the sales/turnover tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 5,
        name: "Reduced IVC Act",
        description: "A low single turnover rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 10,
        name: "Imposto sobre Vendas e Consignações Schedule",
        description: "The standard 1953 cascading turnover rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "Cascading Levy Act",
        description: "Raise the turnover tax to fund the budget",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 22,
        name: "Luxury Consumption Act",
        description: "Heavily tax consumption to fund state programs",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_iap_contribution",
    countryScope: "br",
    name: "Institutos de Aposentadoria e Pensões Contribution Statute",
    description: "Sets employer/employee social-insurance contributions (the IAP system)",
    explanation:
      "Pre-1990 Brazil funded pensions and social insurance through sectoral Institutos de Aposentadoria e Pensões (IAPI, IAPC, IAPB, and others, est. 1933-1938) rather than a unified INSS (which only unified the IAPs in 1990). This lever sets the shared employer/employee contribution rate.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: brPositions("Labor"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("br_iap_contribution", [
      {
        rate: 10,
        name: "Contribution Relief Act",
        description: "Cut IAP contributions to boost formal employment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 20,
        name: "Institutos de Aposentadoria e Pensões Contribution Statute",
        description: "The standard 1953 IAP contribution rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 32,
        name: "Expanded Social Insurance Act",
        description: "Raise contributions to expand IAP coverage",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_customs_tariff",
    countryScope: "br",
    name: "Tarifa Aduaneira Statute",
    description: "Sets the external customs tariff",
    explanation:
      "Brazil's import-substitution-industrialization tariff wall, formalized by the 1951 Alberto Pasqualini tariff reform — protecting the nascent domestic industrial base built up under Vargas.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: brPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("br_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Act",
        description: "Open the economy to imports",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 18,
        name: "Tarifa Aduaneira Statute",
        description: "The standard 1953 ISI tariff wall",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 35,
        name: "Import-Substitution Act",
        description: "Heavy protection for domestic industry",
        stance: "left",
        economic: -3,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── State-enterprise / developmentalist lever ─────────────────────────────
  {
    _id: "br_state_enterprises",
    countryScope: "br",
    name: "Empresa Estatal Statute",
    description: "Sets the balance of state vs private ownership of strategic industry",
    explanation:
      "Petrobras (state oil monopoly, created by Law 2004, October 1953 — this exact seed year), Vale do Rio Doce (nationalized iron-ore giant, 1942), and CSN's Volta Redonda steelworks (1941) anchor Vargas's developmentalist state sector. The lever spans full privatization to further nationalization of strategic industry.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
    ],
    positions: brPositions("Industry"),
    policyOptions: policyOptions(
      "br_state_enterprises",
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
          explanation: "Strategic state firms alongside private markets",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Empresa Estatal Statute",
          explanation:
            "The 1953 developmentalist model — Petrobras' state oil monopoly, Vale, and CSN anchoring strategic industry",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "State Monopoly Expansion Act",
          explanation: "Extend state monopoly into further strategic sectors",
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

  // ── Labor law: CLT ─────────────────────────────────────────────────────────
  {
    _id: "br_labor_law",
    countryScope: "br",
    name: "Consolidação das Leis do Trabalho Statute",
    description: "Sets labor-market protection and union rights",
    explanation:
      "The CLT (Consolidação das Leis do Trabalho, 1943) codified Vargas-era corporatist labor protections — minimum wage, paid vacation, state-recognized unions. The lever spans deregulation to expanded protections.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: brPositions("Labor"),
    policyOptions: policyOptions(
      "br_labor_law",
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
          explanation: "Ease some hiring rules while keeping core CLT protections",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Consolidação das Leis do Trabalho Statute",
          explanation:
            "The standard 1943 CLT — minimum wage, paid vacation, state-recognized unions",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Worker Protection Expansion Act",
          explanation: "Extend CLT protections and union power further",
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

  // ═══════════════════════════════════════════════════════════════════════
  // Spending programmes — one per budget category, plus the federal-to-state
  // grant lever. Per-capita costs are calibrated below (BR_SPENDING_CALIBRATION)
  // via withPerCapitaCosts, matching the NG_SPENDING_CALIBRATION pattern.
  // ═══════════════════════════════════════════════════════════════════════
  {
    _id: "br_social_security_benefits",
    countryScope: "br",
    name: "IAP Pension & Social Insurance Benefits Act",
    description: "Sets the generosity of IAP pension and social-insurance benefits",
    explanation:
      "The sectoral Institutos de Aposentadoria e Pensões (IAPI, IAPC, IAPB, and others) paid pensions and sickness/disability benefits to formal-sector workers well before the 1990 INSS unification. The lever spans retrenchment to expanded universal coverage.",
    policyDomain: "social",
    subCategory: "Social security",
    budgetCategory: "socialSecurity",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    // No socialMobility/povertyRate weighted target: socialSecurity is an
    // engine-derived §4.7 cluster budgetCategory, so a direct target here
    // would double-count against the social-spending channel that already
    // reads this law's booked cost (see socialSpendingSweep.test.ts).
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Social Security"),
    policyOptions: policyOptions(
      "br_social_security_benefits",
      [
        {
          name: "Universal Social Insurance Act",
          explanation: "Extend IAP-style coverage toward every worker, formal and informal",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "IAP Benefit Expansion Act",
          explanation: "Raise pension and sickness-benefit generosity across the IAPs",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "IAP Pension & Social Insurance Benefits Act",
          explanation: "Maintain the standard 1953 IAP benefit schedule",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "IAP Cost-Control Reform",
          explanation: "Trim benefit growth to keep the institutes solvent",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "IAP Retrenchment Act",
          explanation: "Cut benefits and narrow eligibility",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_public_health",
    countryScope: "br",
    name: "Ministério da Saúde Funding Act",
    description: "Sets public-health service funding",
    explanation:
      "In July 1953 the old Ministério da Educação e Saúde split into separate ministries — this is the newly-independent Ministério da Saúde's funding lever, covering rural public-health campaigns (in the SESP tradition) alongside urban hospitals.",
    policyDomain: "healthcare",
    subCategory: "Public health",
    budgetCategory: "healthcare",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Health"),
    policyOptions: policyOptions(
      "br_public_health",
      [
        {
          name: "Universal Public Health Act",
          explanation: "Build toward comprehensive state-funded health coverage",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Rural Health Expansion Act",
          explanation: "Expand SESP-style rural sanitation and disease-control campaigns",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Ministério da Saúde Funding Act",
          explanation:
            "Maintain the newly-independent Ministry of Health at its 1953 funding level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Basic Sanitation Reform",
          explanation: "Trim funding to core sanitation and hospital operations",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Public Health Austerity Act",
          explanation: "Cut public-health spending to a bare minimum",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_education_funding",
    countryScope: "br",
    name: "Ministério da Educação e Cultura Funding Act",
    description: "Sets public-education funding",
    explanation:
      "The other half of the July 1953 ministry split — the Ministério da Educação e Cultura, funding primary literacy campaigns and the federal university system against Brazil's still-high illiteracy rate.",
    policyDomain: "education",
    subCategory: "Education",
    budgetCategory: "education",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Education"),
    policyOptions: policyOptions(
      "br_education_funding",
      [
        {
          name: "Universal Public Education Act",
          explanation: "A maximal literacy and school-construction drive",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Literacy Campaign Expansion Act",
          explanation: "Expand primary schools and adult-literacy campaigns",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Ministério da Educação e Cultura Funding Act",
          explanation:
            "Maintain the newly-independent Ministry of Education at its 1953 funding level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "School Modernization Reform",
          explanation: "Trim funding to core primary schooling",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Education Austerity Act",
          explanation: "Cut education spending to a bare minimum",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_defense_policy",
    countryScope: "br",
    name: "Forças Armadas Funding Act",
    description: "Sets national defense funding",
    explanation:
      "Joint funding lever for the Ministries of War, Navy, and Aeronautics — Brazil fielded an expeditionary force in Italy (1944-45) and maintains a garrison posture against Cold War hemispheric commitments (the Rio Treaty, 1947).",
    policyDomain: "defense",
    subCategory: "Defense",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Defense"),
    policyOptions: policyOptions(
      "br_defense_policy",
      [
        {
          name: "National Rearmament Act",
          explanation: "A maximal rearmament and force-expansion programme",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Continental Defense Expansion Act",
          explanation: "Expand force levels under the Rio Treaty hemispheric-defense commitment",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Forças Armadas Funding Act",
          explanation: "Maintain the standard 1953 joint-services funding level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Force Modernization Reform",
          explanation: "Trim funding while modernizing core units",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Defense Austerity Act",
          explanation: "Cut defense spending to a bare minimum garrison force",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_infrastructure_investment",
    countryScope: "br",
    name: "SALTE Plan Investment Act",
    description: "Sets federal infrastructure and development-bank investment",
    explanation:
      "The SALTE Plan (Saúde, Alimentação, Transporte, Energia — 1948) remains the nominal framework for federal public works in 1953, now increasingly channeled through the new BNDE (Banco Nacional de Desenvolvimento Econômico, founded June 1952) into the rail, road, and energy projects that fed directly into Petrobras.",
    policyDomain: "infrastructure",
    subCategory: "Infrastructure",
    budgetCategory: "infrastructure",
    nationalOnly: true,
    // effectTarget is the only gdpGrowth reference (a dead engine node with
    // maxPolicyDelta 0 outside effectTarget — see seedInvariants.deadNodes.test.ts,
    // which forbids NEW effectTargetsWeighted/metricEffects references to it).
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Infrastructure"),
    policyOptions: policyOptions(
      "br_infrastructure_investment",
      [
        {
          name: "National Development Maximization Act",
          explanation: "A maximal BNDE-financed push across rail, road, and energy",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "BNDE Investment Expansion Act",
          explanation: "Expand BNDE lending into new heavy-industry and energy projects",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "SALTE Plan Investment Act",
          explanation: "Maintain the standard 1953 SALTE Plan / BNDE investment level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Public Works Retrenchment Reform",
          explanation: "Trim investment to essential maintenance",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Infrastructure Austerity Act",
          explanation: "Cut federal investment to a bare minimum",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
  {
    _id: "br_general_administration",
    countryScope: "br",
    name: "Administração Federal Act",
    description: "Sets general federal civil-administration funding",
    explanation:
      "The catch-all federal civil-service and administrative apparatus Vargas built up under the Estado Novo and carried into the constitutional Republic — ministries, the DASP civil-service bureau, and general governance overhead.",
    policyDomain: "governance",
    subCategory: "Administration",
    budgetCategory: "other",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: brPositions("Administration"),
    policyOptions: policyOptions(
      "br_general_administration",
      [
        {
          name: "Federal Bureaucracy Expansion Act",
          explanation: "Substantially grow the federal civil service",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Civil Service Expansion Act",
          explanation: "Expand federal administrative capacity",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Administração Federal Act",
          explanation: "Maintain the standard 1953 federal-administration funding level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Civil Service Streamlining Reform",
          explanation: "Trim general administrative overhead",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Federal Austerity Act",
          explanation: "Cut federal administration to a bare-bones apparatus",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Federal-to-state grant lever ──────────────────────────────────────────
  {
    _id: "br_state_grants",
    countryScope: "br",
    name: "Auxílios aos Estados Act",
    description: "Sets discretionary federal aid/subventions to state governments",
    explanation:
      "Pre-dating the 1967 Fundo de Participação dos Estados, 1953 Brazil's federal-to-state transfers were discretionary auxílios e subvenções — a real but ad hoc mechanism of Vargas's centralizing federalism, not yet a formula-driven revenue-sharing fund.",
    policyDomain: "economic",
    budgetCategory: "stateGrants",
    isGrant: true,
    subCategory: "Fiscal transfer",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: brPositions("Federalism"),
    policyOptions: policyOptions(
      "br_state_grants",
      [
        {
          name: "Maximum State Assistance Act",
          explanation: "Maximize discretionary transfers to state governments",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Expanded State Aid Act",
          explanation: "Expand federal auxílios to poorer states",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Auxílios aos Estados Act",
          explanation: "Maintain the standard 1953 discretionary state-aid level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "State Aid Reduction Reform",
          explanation: "Trim discretionary transfers to states",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "State Self-Sufficiency Act",
          explanation: "Cut federal transfers, leaving states to their own revenue",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },
];

/**
 * Per-capita cost calibration for BR's spending programmes, mirroring
 * NG_SPENDING_CALIBRATION (ngLegislationTypes.ts). Baselines are the target
 * default-option per-capita cost (local currency), computed from the authored
 * 1953 baselineSpendingByCategory ÷ population (57,000,000) in budgets.ts:
 *   socialSecurity 12.5B / 57M ≈ 219
 *   healthcare      4.0B / 57M ≈  70
 *   education      10.0B / 57M ≈ 175
 *   defense         7.5B / 57M ≈ 132
 *   infrastructure 30.0B / 57M ≈ 526
 *   other          17.5B / 57M ≈ 307
 *   stateGrants    10.0B / 57M ≈ 175
 * These feed the option ladder shape (and the raw ranking used by the 1953
 * seed's category-override rescale in budgets.ts, which pins the DEFAULT
 * option's booked cost to the authored baseline exactly); a non-default
 * option's cost is NOT rescaled and genuinely differs (see
 * brLegislationTypes.test.ts).
 */
const BR_SPENDING_CALIBRATION: Record<
  string,
  { category: string; baseline: number; curve: number[] }
> = {
  br_social_security_benefits: {
    category: "socialSecurity",
    baseline: 219,
    curve: BR_SPENDING_CURVE,
  },
  br_public_health: { category: "healthcare", baseline: 70, curve: BR_SPENDING_CURVE },
  br_education_funding: { category: "education", baseline: 175, curve: BR_SPENDING_CURVE },
  br_defense_policy: { category: "defense", baseline: 132, curve: BR_SPENDING_CURVE },
  br_infrastructure_investment: {
    category: "infrastructure",
    baseline: 526,
    curve: BR_SPENDING_CURVE,
  },
  br_general_administration: { category: "other", baseline: 307, curve: BR_SPENDING_CURVE },
  br_state_grants: { category: "stateGrants", baseline: 175, curve: BR_SPENDING_CURVE },
};

const brCalibratedIds = new Set<string>();
for (const lt of brLegislationTypes) {
  const cal = BR_SPENDING_CALIBRATION[lt._id];
  if (!cal) continue;
  lt.budgetCategory = cal.category === "stateGrants" ? lt.budgetCategory : cal.category;
  const { baseline, curve } = cal;
  const options = lt.policyOptions ?? [];
  if (options.length !== curve.length) {
    throw new Error(
      `BR spending calibration for ${lt._id}: expected ${curve.length} options, got ${options.length}`
    );
  }
  lt.policyOptions = withPerCapitaCosts(
    options,
    curve.map((m) => Math.round(baseline * m))
  );
  brCalibratedIds.add(lt._id);
}
// Guard against a mistyped calibration key silently under-seeding spending.
const brUnmatched = Object.keys(BR_SPENDING_CALIBRATION).filter((id) => !brCalibratedIds.has(id));
if (brUnmatched.length > 0) {
  throw new Error(`BR spending calibration references unknown type ids: ${brUnmatched.join(", ")}`);
}

export default brLegislationTypes;
