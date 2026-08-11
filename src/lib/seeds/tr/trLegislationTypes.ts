import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withGdpFractionCosts,
} from "../reference/policyOptionHelpers";

/**
 * Turkey (TR) legislation — 1979, an étatist import-substitution economy in
 * crisis on the eve of the January 1980 liberalisation. The defining lever is the
 * state-economic-enterprise (KİT) sector: étatism vs liberalisation/privatisation.
 * countryScope "tr".
 *
 * economic axis: -5 statist … +5 market. social axis: -5 secular … +5 traditional.
 * effectTargetsWeighted signed relative to LEFT (+1) so right options carry the
 * natural-metric upside (passes policySymmetry).
 */
function trPositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "mm_chair",
      name: `Chair, Assembly Committee on ${domainLabel}`,
      chamber: "milletMeclisi",
    },
    {
      positionId: "mm_vice",
      name: `Vice-Chair, Assembly Committee on ${domainLabel}`,
      chamber: "milletMeclisi",
    },
  ];
}

export const trLegislationTypes: LegislationType[] = [
  {
    _id: "tr_income_tax",
    countryScope: "tr",
    name: "Gelir Vergisi Statute",
    description: "Sets the top marginal personal income tax rate",
    explanation: "Turkey's progressive personal income tax (gelir vergisi).",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: trPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("tr_income_tax", [
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
        rate: 35,
        name: "Tax Relief Act",
        description: "Cut top rates",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 50,
        name: "Gelir Vergisi Statute",
        description: "The standard progressive schedule",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 65,
        name: "Solidarity Surtax Act",
        description: "Raise top rates for the budget",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 75,
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
    _id: "tr_corporate_tax",
    countryScope: "tr",
    name: "Kurumlar Vergisi Statute",
    description: "Sets the corporate income tax rate",
    explanation: "Tax on company profits (kurumlar vergisi).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: trPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("tr_corporate_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Abolish corporate tax",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 18,
        name: "Competitive Rate Act",
        description: "Low rate for investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Business Relief Act",
        description: "Cut the rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 40,
        name: "Kurumlar Vergisi Statute",
        description: "The standard corporate rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 52,
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
    _id: "tr_sales_tax",
    countryScope: "tr",
    name: "Production Tax Schedule",
    description: "Sets the indirect production/consumption tax (pre-VAT)",
    explanation:
      "In 1979 Turkey levied production and consumption taxes (VAT/KDV arrived in 1985).",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
    ],
    positions: trPositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("tr_sales_tax", [
      {
        rate: 0,
        name: "Abolish Production Tax Act",
        description: "Eliminate the production tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 6,
        name: "Reduced Tax Act",
        description: "A low single rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 12,
        name: "Production Tax Schedule",
        description: "The standard 1979 production tax",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
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
    _id: "tr_social_charges",
    countryScope: "tr",
    name: "SSK Contribution Statute",
    description: "Sets employer social-security contributions (SSK)",
    explanation: "Turkey funds social insurance through SSK employer/employee contributions.",
    policyDomain: "tax",
    subCategory: "Social contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: trPositions("Labour"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("tr_social_charges", [
      {
        rate: 8,
        name: "Charge Relief Act",
        description: "Cut contributions to boost jobs",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 20,
        name: "SSK Contribution Statute",
        description: "The standard social-insurance charges",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 32,
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
    _id: "tr_customs_tariff",
    countryScope: "tr",
    name: "Customs Tariff Statute",
    description: "Sets the external tariff (import-substitution protectionism)",
    explanation:
      "1979 Turkey ran a highly protected import-substitution regime; the lever spans protectionism vs the coming trade liberalisation.",
    policyDomain: "tax",
    subCategory: "Trade",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
    ],
    positions: trPositions("Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("tr_customs_tariff", [
      {
        rate: 0,
        name: "Trade Liberalization Act",
        description: "Open the economy (the 1980 export-led turn)",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Customs Tariff Statute",
        description: "Moderate protection",
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

  // ── State economic enterprises: étatism ↔ liberalisation (KİT) ───────────────
  {
    _id: "tr_state_enterprises",
    countryScope: "tr",
    name: "KİT Étatism Law",
    description: "Sets the scope of the state economic enterprise (KİT) sector",
    explanation:
      "Turkey's étatist KİTs (Sümerbank, Etibank, steel, sugar) dominate industry. The lever spans deeper étatism to the liberalisation/privatisation of the imminent Özal reforms.",
    policyDomain: "economic",
    subCategory: "Ownership",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
    ],
    positions: trPositions("Industry"),
    policyOptions: policyOptions(
      "tr_state_enterprises",
      [
        {
          name: "Mass Privatization Act",
          explanation: "Sell off the KİTs; minimal state sector",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          name: "Liberalisation Program",
          explanation: "The Özal-style export-led market opening",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "KİT Étatism Law",
          explanation: "Maintain the state-led import-substitution model",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Étatism Expansion Act",
          explanation: "Extend state enterprises into more industries",
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
    _id: "tr_labor_law",
    countryScope: "tr",
    name: "Labor Code Statute",
    description: "Sets labor protection and union rights",
    explanation:
      "The militant DİSK/Türk-İş unions and labor protections — from flexibility to expanded union power.",
    policyDomain: "economic",
    subCategory: "Labor",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "coDeterminationQuality", weight: 0.6 },
    ],
    positions: trPositions("Labour"),
    policyOptions: policyOptions(
      "tr_labor_law",
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
          name: "Labor Code Statute",
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
  // socialSecurity budget line: SSK pensions. Default idx1 (the ladder's
  // "Cost-Control Reform" — minimal, per COUNTRY_POLICY_CONFIGS_1953.tr's
  // "rural and traditional" framing) reconciles to 3.33% of GDP
  // (₺800M / ₺24B).
  {
    _id: "tr_welfare_state",
    countryScope: "tr",
    name: "Social Provision Statute",
    description: "Sets welfare and social-provision generosity",
    explanation:
      "Turkey's limited welfare state — pensions, health and subsidies — can be retrenched or expanded.",
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
    positions: trPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_welfare_state",
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
            explanation: "Maintain pensions, health and price subsidies",
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
      [0.02333, 0.03333, 0.04667, 0.06533]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Health: SSK health services ──────────────────────────────────────────────
  // healthcare budget line. Default idx2 reconciles to 2.08% of GDP
  // (₺500M / ₺24B).
  {
    _id: "tr_health_insurance",
    countryScope: "tr",
    name: "SSK Health Services Act",
    description: "Sets funding for SSK-administered health services",
    explanation:
      "Sosyal Sigortalar Kurumu (SSK, est. 1945) runs its own hospitals and clinics for insured industrial and urban workers, still a narrow slice of Turkey's largely agrarian workforce. The lever spans austerity to expanded coverage.",
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
    positions: trPositions("Social Affairs"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_health_insurance",
        [
          {
            name: "SSK Retrenchment Act",
            explanation: "Cut SSK hospital and clinic funding",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Cost-Control Reform",
            explanation: "Trim funding growth to balance SSK's budget",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "SSK Health Services Act",
            explanation: "Maintain SSK-administered hospitals and clinics",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "SSK Expansion Act",
            explanation: "Expand SSK coverage toward the agrarian workforce",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01042, 0.01562, 0.02083, 0.02917]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Education: Milli Eğitim ──────────────────────────────────────────────────
  // education budget line. Default idx2 reconciles to 3.75% of GDP
  // (₺900M / ₺24B).
  {
    _id: "tr_education_funding",
    countryScope: "tr",
    name: "Milli Eğitim Act",
    description: "Sets funding for the state school and university system",
    explanation:
      "The Milli Eğitim Bakanlığı's village-institute and school network, expanding literacy across rural Anatolia alongside the growing university system. The lever spans austerity to expanded state investment.",
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
    positions: trPositions("Education"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_education_funding",
        [
          {
            name: "Milli Eğitim Retrenchment Act",
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
            name: "Milli Eğitim Act",
            explanation: "Maintain the state school and university system",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Milli Eğitim Expansion Act",
            explanation: "Expand rural village institutes and university places",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01875, 0.02812, 0.0375, 0.0525]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Infrastructure: Menderes-era public works ───────────────────────────────
  // infrastructure budget line. Default idx2 reconciles to 10.42% of GDP
  // (₺2.5B / ₺24B) — the largest 1953 category, reflecting the Menderes-era
  // roads, dams and irrigation drive at the height of the Marshall-Plan-and-
  // tractor-financed agricultural boom.
  {
    _id: "tr_infrastructure_investment",
    countryScope: "tr",
    name: "Bayındırlık Act",
    description: "Sets funding for the state roads, dams and irrigation programme",
    explanation:
      "The Menderes government's signature Bayındırlık (Public Works) drive — asphalt highways connecting Anatolian villages to market towns, and the first big irrigation dams — riding the Marshall-Plan-financed tractor and agricultural export boom. The lever spans austerity to an accelerated investment drive.",
    policyDomain: "infrastructure",
    subCategory: "Public works investment",
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
    positions: trPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_infrastructure_investment",
        [
          {
            name: "Bayındırlık Retrenchment Act",
            explanation: "Scale back the public-works programme",
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
            name: "Bayındırlık Act",
            explanation: "Maintain the roads, dams and irrigation investment programme",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Accelerated Public Works Act",
            explanation: "Expand highways, dams and irrigation investment",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.05208, 0.07812, 0.10417, 0.14583]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Defense: NATO and the Korean War contribution ───────────────────────────
  // defense budget line. INVERTED ladder (per the DE de_bundeswehr_funding
  // convention): pacifist/left = low spend, hawkish/right = high spend.
  // Default idx2 (center) reconciles to 10.42% of GDP (₺2.5B / ₺24B) — a very
  // large NATO-aligned army, including the Turkish Brigade serving in Korea.
  {
    _id: "tr_defense_appropriations",
    countryScope: "tr",
    name: "Milli Savunma Act",
    description: "Sets the overall military appropriations envelope",
    explanation:
      "Turkey fields a very large standing army as NATO's southeastern flank (joined 1952), with the Turkish Brigade still committed in Korea. The lever spans demobilisation to further rearmament.",
    policyDomain: "defense",
    subCategory: "Defense appropriations",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: trPositions("Defence"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_defense_appropriations",
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
            name: "Milli Savunma Act",
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
      [0.03646, 0.0625, 0.10417, 0.16667]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Other: KİT price supports ────────────────────────────────────────────────
  // "other" budget line — KİT price supports beyond the ownership question
  // already modeled by tr_state_enterprises, plus grain price supports for the
  // Toprak Mahsulleri Ofisi. Default idx2 reconciles to 2.92% of GDP
  // (₺700M / ₺24B).
  {
    _id: "tr_economic_subsidies",
    countryScope: "tr",
    name: "KİT Fiyat Destekleme Act",
    description: "Sets the level of price supports for KİT products and grain",
    explanation:
      "Price supports for KİT (state economic enterprise) products and the Toprak Mahsulleri Ofisi's grain purchases — the fiscal backbone of the Menderes government's rural popularity. The lever spans austerity to expanded state support.",
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
    positions: trPositions("Industry"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_economic_subsidies",
        [
          {
            name: "Subsidy Retrenchment Act",
            explanation: "Cut KİT and grain price supports",
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
            name: "KİT Fiyat Destekleme Act",
            explanation: "Maintain price supports for KİT products and grain",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Subsidy Expansion Act",
            explanation: "Expand price supports for KİT products and grain",
            stance: "left",
            economic: -4,
            social: 0,
          },
        ],
        "economic"
      ),
      [0.01458, 0.02187, 0.02917, 0.04083]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── Grants: transfers to the İl Özel İdareleri ──────────────────────────────
  // isGrant law (stateGrants line, not byCategory). Default idx2 reconciles to
  // 1.67% of GDP (₺400M / ₺24B).
  {
    _id: "tr_local_grants",
    countryScope: "tr",
    name: "İl Özel İdareleri Fonu Act",
    description: "Sets central government transfers to the İl Özel İdareleri and belediyeler",
    explanation:
      "Ankara's fiscal-equalisation transfer to the İl Özel İdareleri (special provincial administrations) and belediyeler (municipalities), which deliver most local services across rural Anatolia. The lever spans centralisation (low transfer) to generous local funding.",
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
    positions: trPositions("Local Government"),
    policyOptions: withGdpFractionCosts(
      policyOptions(
        "tr_local_grants",
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
            name: "İl Özel İdareleri Fonu Act",
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
      [0.00833, 0.0125, 0.01667, 0.02333]
    ),
    source: "seed",
    isPermanent: true,
  },
];

export default trLegislationTypes;
