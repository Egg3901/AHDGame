import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withPerCapitaCosts,
} from "../reference/policyOptionHelpers";

/**
 * Japan-specific legislation types.
 *
 * Tax types expanded to 11 brackets each with LARP-style titles.
 * Committee positions use "shugiin" and "sangiin" chamber keys.
 * countryScope: "jp" gates these to Japan only.
 *
 * Spec: docs/plans/archive/2026-04/2026-04-10-jp-legislation-overhaul-design.md
 *
 * Helpers: shared `policyOptions(..., "both")` / `taxRateOptions` /
 * `withPerCapitaCosts` from `../reference/policyOptionHelpers`. Per-capita
 * costs are JPY amounts (helper is currency-neutral; UI display reads
 * `CountryConfig.currency`).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function standardJPCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "shugiin_chair",
      name: `Chair, Shugiin ${domainLabel} Committee`,
      chamber: "shugiin",
    },
    {
      positionId: "shugiin_ranking",
      name: `Ranking Member, Shugiin ${domainLabel} Committee`,
      chamber: "shugiin",
    },
    {
      positionId: "sangiin_chair",
      name: `Chair, Sangiin ${domainLabel} Committee`,
      chamber: "sangiin",
    },
    {
      positionId: "sangiin_ranking",
      name: `Ranking Member, Sangiin ${domainLabel} Committee`,
      chamber: "sangiin",
    },
  ];
}

function weightedTargets(
  primary: { category: string; metric: string },
  secondaries: { category: string; metric: string; weight: number }[]
): LegislationType["effectTargetsWeighted"] {
  return [
    {
      metricCategoryId: primary.category as "economic",
      metricId: primary.metric,
      weight: 1.0,
    },
    ...secondaries.map((s) => ({
      metricCategoryId: s.category as "economic",
      metricId: s.metric,
      weight: s.weight,
    })),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAX TYPES (7 — 5 national + 2 regional, 11 brackets each)
// ═════════════════════════════════════════════════════════════════════════════

export const jpLegislationTypes: LegislationType[] = [
  // ── A1. National Income Tax ──────────────────────────────────────────────
  // Center: 25% | Range: 0-50% | Increments: 5%
  {
    _id: "jp_income_tax_rate",
    countryScope: "jp",
    name: "Income Tax Rate Act",
    description: "Sets Japan's national income tax rate on earned income",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "povertyRate", weight: 0.5 },
      { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      // Progressive income tax compresses inequality: higher rate (left) must
      // LOWER inequality, so the weight is negative (matches UK/DE/IE/CN).
      { category: "social", metric: "incomeInequality", weight: -0.6 },
    ]),
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("jp_income_tax_rate", [
      {
        rate: 0,
        name: "Income Tax Abolition Act",
        description:
          "Eliminate national income taxation entirely, funding government through consumption tax and tariffs",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Minimal Revenue Levy",
        description:
          "A token income tax dramatically shrinking Ministry of Finance revenue capacity",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Flat Tax Modernization Act",
        description: "A simple low flat tax replacing the progressive bracket system",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Growth-First Tax Act",
        description: "Deep rate cuts to unleash private investment and revive economic growth",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 20,
        name: "Taxpayer Relief Act",
        description:
          "Meaningful rate reductions while preserving core public services and pension funding",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "Working Families Tax Framework",
        description:
          "A moderate rate balancing revenue needs with household affordability in an aging society",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Shared Prosperity Tax Plan",
        description: "Modestly higher rates to fund expanded elder care and social services",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 35,
        name: "Fair Contribution Act",
        description:
          "Restore higher rates to close the deficit and fund pension system sustainability",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 40,
        name: "Progressive Revenue Act",
        description:
          "Significantly higher rates to fund comprehensive healthcare and education expansion",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 45,
        name: "Wealth Equity Tax Act",
        description: "Near-historic top rates to aggressively redistribute income across society",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Redistribution Act",
        description:
          "A steeply progressive rate targeting the highest earners to maximize revenue and fund sweeping social programs",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A2. National Corporation Tax ─────────────────────────────────────────
  // Center: 23% | Range: 0-46% | Increments: ~4.6%
  {
    _id: "jp_domestic_corporation_tax",
    countryScope: "jp",
    name: "Domestic Corporation Tax Act",
    description: "Sets Japan's tax rate on profits of companies headquartered in Japan",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        { category: "economic", metric: "gdpGrowth", weight: 0.5 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      ]
    ),
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("jp_domestic_corporation_tax", [
      {
        rate: 0,
        name: "Corporate Tax Elimination Act",
        description:
          "Abolish corporate taxation entirely, making Japan the world's most competitive tax destination",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Business Liberation Act",
        description:
          "A near-zero corporate rate to attract multinational headquarters to Tokyo and Osaka",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 9,
        name: "Enterprise Growth Compact",
        description:
          "A low flat rate to attract global investment and stimulate keiretsu modernization",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 14,
        name: "SME Prosperity Act",
        description: "Rate cuts favoring capital formation and small-medium enterprise expansion",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 18,
        name: "Competitive Markets Tax Plan",
        description: "A globally competitive rate aligned with Asian tiger economies",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 23,
        name: "Balanced Corporate Revenue Act",
        description: "A moderate rate balancing business competitiveness with public revenue needs",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 28,
        name: "Corporate Accountability Tax",
        description:
          "Higher rates requiring corporations to contribute a larger share of national revenue",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 32,
        name: "Corporate Fair Share Act",
        description:
          "Rates approaching historically traditional levels to fund public services and pension obligations",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 37,
        name: "Corporate Excess Profits Act",
        description:
          "Elevated rates targeting outsized corporate earnings to fund public investment",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 41,
        name: "Corporate Wealth Recapture Act",
        description:
          "Rates exceeding the historic norm, extracting substantial revenue from zaibatsu-era conglomerates",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 46,
        name: "Maximum Corporate Extraction Act",
        description:
          "The highest modern corporate tax rate, capturing nearly half of all corporate profits for public use",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A2b. Foreign Corporation Tax ─────────────────────────────────────────
  // Center: 26% | Range: 0-65% | Mirrors UK foreign bill with JP context
  {
    _id: "jp_foreign_corporation_tax",
    countryScope: "jp",
    name: "Foreign Corporation Tax Act",
    description: "Sets Japan's tax rate on profits of companies headquartered outside Japan",
    policyDomain: "tax",
    subCategory: "Foreign corporate taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      { category: "economic", metric: "unemploymentRate", weight: 0.2 },
      { category: "economic", metric: "smallBusinessFormation", weight: -0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
    policyOptions: taxRateOptions("jp_foreign_corporation_tax", [
      {
        rate: 0,
        name: "Open Markets for Capital Act",
        description:
          "Abolish taxation on foreign corporate profits, positioning Japan as a free-market destination for global capital",
        stance: "right",
        economic: 5,
        social: 1,
      },
      {
        rate: 6,
        name: "Foreign Investment Attraction Act",
        description:
          "A near-zero foreign rate to draw multinational headquarters and FDI to Tokyo and Osaka",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 13,
        name: "Business-Friendly Foreign Rate",
        description:
          "A low foreign corporate rate encouraging cross-border operations and joint ventures",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 19,
        name: "Moderate Investor Act",
        description: "A slightly-below-parity foreign rate signaling an open-for-business climate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 26,
        name: "Parity with Domestic Corporation Tax",
        description:
          "Tax foreign corporations at the same rate as Japanese firms — a neutral, non-discriminatory policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 32,
        name: "Modestly Protective Foreign Rate",
        description: "A marginally higher rate favoring Japanese-headquartered companies",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 39,
        name: "Foreign Capital Accountability Act",
        description:
          "A meaningfully higher rate funded by profits extracted by foreign multinationals operating in Japan",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 45,
        name: "Japanese Workers Defense Act",
        description:
          "Elevated rates funding domestic workforce programs and discouraging foreign offshoring",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        // High foreign-corp rate ⇒ economically left; stance corrected from a
        // sovereignty theme so the effectDirection ladder stays monotone (Bug #0962).
        rate: 52,
        name: "Japan First (Nihon Ichi) Foreign Corp Tax",
        description:
          "A nationalist regime protecting keiretsu and Japanese business interests from gaiatsu (foreign pressure)",
        stance: "left",
        economic: -3,
        social: -2,
      },
      {
        rate: 58,
        name: "Japanese Economic Sovereignty Act",
        description:
          "A near-punitive foreign rate asserting Japanese economic independence from multinational capital",
        stance: "left",
        economic: -4,
        social: -3,
      },
      {
        rate: 65,
        name: "Multinational Extraction Act",
        description:
          "The highest foreign corporate rate, maximizing revenue capture from transnational profits",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A3. National Social Insurance ────────────────────────────────────────
  // Center: 15% | Range: 0-30% | Increments: 3%
  {
    _id: "jp_social_insurance",
    countryScope: "jp",
    name: "Social Insurance Contribution Act",
    description:
      "Sets Japan's social insurance contribution rate (pension, health, employment, long-term care)",
    policyDomain: "tax",
    subCategory: "Social insurance",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "socialCohesion",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "socialCohesion" }, [
      { category: "healthcare", metric: "elderCareQuality", weight: 0.6 },
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.3 },
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("jp_social_insurance", [
      {
        rate: 0,
        name: "Social Insurance Abolition Act",
        description:
          "Eliminate social insurance contributions entirely, privatizing pension and healthcare funding",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 3,
        name: "Entitlement Privatization Act",
        description:
          "A minimal contribution paired with private pension accounts and individual health savings",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 6,
        name: "Personal Responsibility Compact",
        description:
          "Dramatically reduced social insurance burden, shifting retirement and healthcare costs to individuals",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 9,
        name: "Insurance Relief Act",
        description:
          "Significant cuts to social insurance to boost take-home pay for working families",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 12,
        name: "Worker Affordability Act",
        description:
          "Reduced contributions easing the burden on employers and low-wage workers in an aging economy",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 15,
        name: "Social Insurance Preservation Act",
        description:
          "A rate sufficient to fund core pension, health insurance, and long-term care obligations",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
        name: "Pension Security Act",
        description:
          "Higher contributions to shore up the national pension fund against demographic decline",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 21,
        name: "Expanded Benefits Act",
        description:
          "Increased funding to expand health coverage eligibility and raise pension payments",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 24,
        name: "Universal Entitlement Act",
        description:
          "Substantially higher contributions funding comprehensive healthcare and enhanced retirement benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 27,
        name: "Cradle-to-Grave Security Act",
        description:
          "Near-Scandinavian rates funding comprehensive social insurance from birth to death",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 30,
        name: "Maximum Social Insurance Act",
        description:
          "The highest social insurance rate, funding a full Nordic-style welfare state through employer and worker contributions",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A4. National Customs Tariff ──────────────────────────────────────────
  // Center: 4% | Range: 0-20% | Increments: variable
  // Proposal module: per-country/per-category targeting (see spec Section A4 note)
  {
    _id: "jp_customs_tariff",
    countryScope: "jp",
    name: "Customs Tariff Act",
    description: "Sets Japan's import tariff rates on foreign goods",
    policyDomain: "tax",
    subCategory: "Trade policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      { category: "economic", metric: "foodSecurity", weight: 0.4 },
      { category: "economic", metric: "smallBusinessFormation", weight: -0.3 },
    ]),
    positions: standardJPCommitteePositions("Economy & Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("jp_customs_tariff", [
      {
        rate: 0,
        name: "Universal Free Trade Act",
        description: "Abolish all tariffs and embrace unrestricted global free trade",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 1,
        name: "Open Markets Accord",
        description: "Minimal revenue tariffs only, maximizing trade openness and consumer choice",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 2,
        name: "Free Trade Preservation Act",
        description: "Low tariffs limited to WTO and CPTPP enforcement mechanisms",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 3,
        name: "Fair Trade Compact",
        description:
          "Modest tariffs targeting unfair trade practices while preserving open markets",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 3.5,
        name: "Reciprocal Trade Act",
        description: "Tariffs calibrated to match rates imposed by trading partners",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 4,
        name: "Balanced Trade Act",
        description:
          "A moderate tariff rate balancing domestic industry protection with consumer affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 6,
        name: "Domestic Industry Shield Act",
        description:
          "Elevated tariffs protecting key manufacturing and agricultural sectors from foreign competition",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 8,
        name: "Japanese Production First Act",
        description:
          "Broad tariffs designed to incentivize reshoring of factories and supply chains",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 12,
        name: "Agricultural Fortress Act",
        description:
          "High protective tariffs across imported goods, especially rice, dairy, and agricultural products",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 16,
        name: "Economic Sovereignty Act",
        description: "Sweeping tariffs walling off the domestic economy from global competition",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Maximum Protectionist Act",
        description:
          "The highest peacetime tariff rates, designed to achieve near-total economic self-sufficiency",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A5. National Consumption Tax ─────────────────────────────────────────
  // Center: 10% | Range: 0-25% | Regressive: true
  {
    _id: "jp_consumption_tax",
    countryScope: "jp",
    name: "Consumption Tax Act",
    description: "Sets Japan's consumption tax rate (equivalent to VAT)",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "costOfLiving",
      scope: "national",
    },
    // Consumption tax on an INVERTED axis (high rate = right). Cost of living
    // stays the headline effect but with a NEGATIVE weight (higher consumption
    // tax raises consumer prices); poverty likewise rises. Explicit array because
    // weightedTargets() forces the primary to +1.0. Mirrors ie_vat_rate.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.25 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.4 },
      // Higher consumption tax raises food costs, reducing food security.
      { metricCategoryId: "economic", metricId: "foodSecurity", weight: -0.3 },
    ],
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("jp_consumption_tax", [
      {
        rate: 0,
        name: "Consumption Tax Abolition Act",
        description:
          "Eliminate the consumption tax entirely, preserving purchasing power for low-income households",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 3,
        name: "Minimal Consumption Levy",
        description: "A token rate dramatically reducing revenue from consumer spending",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5,
        name: "Reduced Consumption Tax Act",
        description: "A low rate significantly reducing the cost of living for ordinary families",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 8,
        name: "Consumer Relief Act",
        description: "A moderate consumption tax easing burden on household spending",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 9,
        name: "Income-Shift Consumption Act",
        description: "A below-center rate used to offset increases in progressive income taxation",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 10,
        name: "Moderate Consumption Tax Act",
        description:
          "A moderate consumption tax rate balancing Treasury revenue with consumer affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 13,
        name: "Revenue Diversification Act",
        description: "An elevated consumption tax replacing a portion of income tax revenue",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 15,
        name: "Consumption Priority Act",
        description:
          "A high consumption tax designed to reduce reliance on income taxes and fund pension shortfalls",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 18,
        name: "European-Level Consumption Act",
        description: "A continental-style rate replacing significant progressive income taxation",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 22,
        name: "Consumption-First Tax Act",
        description:
          "A near-total shift from income taxation to consumption-based revenue collection",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum Consumption Tax Act",
        description:
          "The highest consumption tax rate, funding government primarily through consumer spending",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A6. Regional Resident Tax ────────────────────────────────────────────
  // Center: 10% | Range: 0-20% | Increments: 2%
  {
    _id: "jp_resident_tax",
    countryScope: "jp",
    name: "Prefectural Resident Tax Act",
    description: "Sets the combined prefectural and municipal resident tax rate applied to income",
    policyDomain: "tax",
    subCategory: "Regional taxation",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "publicTrust",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "education", metric: "educationSpending", weight: 0.4 },
      { category: "publicSafety", metric: "crimeRate", weight: 0.3 },
    ]),
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "state", taxType: "residentTax" },
    policyOptions: taxRateOptions("jp_resident_tax", [
      {
        rate: 0,
        name: "Resident Tax Abolition Act",
        description:
          "Eliminate prefectural resident taxation entirely, removing a key local revenue source",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 2,
        name: "Minimal Resident Levy",
        description: "A token resident tax dramatically reducing household tax burden",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 4,
        name: "Householder Relief Act",
        description: "A low resident tax prioritizing housing affordability over local revenue",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 6,
        name: "Low-Burden Resident Levy",
        description:
          "A modest resident tax keeping household costs low while funding essential services",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 8,
        name: "Affordable Living Tax Act",
        description:
          "A below-average resident tax balancing household costs with local service funding",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 10,
        name: "Balanced Resident Tax Act",
        description:
          "A mid-range resident tax providing reliable funding for local schools, infrastructure, and emergency services",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 12,
        name: "Enhanced Local Services Levy",
        description:
          "An above-average resident tax funding expanded education and public infrastructure",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 14,
        name: "Community Investment Tax Act",
        description:
          "A higher resident tax enabling robust investment in local education and municipal services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 16,
        name: "Public Infrastructure Priority Act",
        description:
          "Elevated resident tax funding comprehensive local government services and capital improvements",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 18,
        name: "Maximum Local Investment Act",
        description:
          "Among the highest resident tax rates, extracting substantial revenue for public use",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 20,
        name: "Maximum Resident Tax Act",
        description:
          "The highest resident tax rate, maximizing local revenue extraction from resident income",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ── A7. Regional Fixed Asset Tax ─────────────────────────────────────────
  // Center: 1.4% | Range: 0-5% | Increments: variable
  {
    _id: "jp_fixed_asset_tax",
    countryScope: "jp",
    name: "Fixed Asset Tax Act",
    description: "Sets the tax rate on land, buildings, and depreciable business assets",
    policyDomain: "tax",
    subCategory: "Regional taxation",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "costOfLiving",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "costOfLiving" }, [
      {
        category: "economic",
        metric: "smallBusinessFormation",
        weight: -0.3,
      },
      { category: "governance", metric: "publicTrust", weight: 0.4 },
    ]),
    positions: standardJPCommitteePositions("Finance"),
    taxRateChange: { scope: "state", taxType: "fixedAssetTax" },
    policyOptions: taxRateOptions("jp_fixed_asset_tax", [
      {
        rate: 0,
        name: "Fixed Asset Tax Abolition Act",
        description:
          "Eliminate the fixed asset tax entirely to attract property investment and development",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 0.2,
        name: "Minimal Property Assessment",
        description: "A near-zero rate dramatically reducing landowner and business tax burden",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 0.5,
        name: "Property Owner Relief Act",
        description: "A low rate prioritizing housing and commercial property affordability",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 0.8,
        name: "Low-Burden Asset Levy",
        description:
          "A modest rate keeping property costs low while funding essential local services",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 1.1,
        name: "Affordable Property Tax Act",
        description:
          "A below-average rate balancing property ownership costs with local service funding",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 1.4,
        name: "Balanced Fixed Asset Tax Act",
        description:
          "A mid-range fixed asset tax rate providing reliable funding for local infrastructure and services",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 1.8,
        name: "Enhanced Asset Revenue Levy",
        description:
          "An above-average rate funding expanded local infrastructure and public investment",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 2.2,
        name: "Community Development Tax Act",
        description:
          "A higher rate enabling robust investment in local infrastructure and municipal services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 3.0,
        name: "Public Asset Revenue Act",
        description:
          "Elevated rates funding comprehensive local government services and capital improvements",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 4.0,
        name: "Maximum Local Asset Tax Act",
        description:
          "Among the highest fixed asset rates, extracting substantial revenue from property owners",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5.0,
        name: "Maximum Fixed Asset Tax Act",
        description:
          "The highest fixed asset tax rate, maximizing local revenue from land and property holdings",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  HEALTHCARE (5 — 4 national + 1 regional)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── B1. National Health Insurance ────────────────────────────────────────
  {
    _id: "jp_national_health_insurance",
    countryScope: "jp",
    name: "National Health Insurance Act",
    description:
      "Controls overall funding for Japan's universal health insurance system (kokumin kenko hoken). The backbone of Japan's healthcare.",
    policyDomain: "healthcare",
    budgetCategory: "healthcare",
    subCategory: "Health insurance",
    nationalOnly: true,
    // §4.7 (P2b): physicianRate/lifeExpectancy/elderCareQuality are spend-driven
    // readouts now — an INSURANCE law's mechanism is COVERAGE, so the primary
    // re-points to the uninsuredRate root (engine input to the outcome chain).
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "uninsuredRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "healthcare", metric: "uninsuredRate" }, [
      { category: "economic", metric: "povertyRate", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_national_health_insurance",
        [
          {
            name: "Universal Healthcare Expansion Act",
            explanation:
              "Massively expand coverage to eliminate all co-payments, fund new hospitals, and guarantee same-day access for every resident",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Healthcare Investment and Modernization Act",
            explanation:
              "Significantly increase health insurance funding to hire thousands of new doctors, rebuild aging hospitals, and expand specialist access",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Healthcare Enhancement Act",
            explanation:
              "Modestly increase health budgets to reduce waiting times, fund new treatments, and improve rural clinic access",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Healthcare Sustainability Act",
            explanation:
              "A moderate level of health insurance funding sustaining service levels and meeting demographic demand",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Healthcare Efficiency and Reform Act",
            explanation:
              "Reduce health spending through private sector partnerships, digital health adoption, and market-based efficiency reforms",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Healthcare Marketization Act",
            explanation:
              "Dramatically expand private healthcare delivery, introducing higher co-payments and insurance-based premium tiers",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Healthcare Privatization Act",
            explanation:
              "Abolish universal public health insurance, replacing it with a private insurance-based healthcare market",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [380000, 340000, 300000, 270000, 210000, 130000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. Elder Care ───────────────────────────────────────────────────────
  {
    _id: "jp_elder_care",
    countryScope: "jp",
    name: "Elder Care and Long-Term Services Act",
    description:
      "Japan's defining fiscal challenge — long-term care insurance (kaigo hoken), nursing homes, home care services, and support for the world's oldest population.",
    policyDomain: "healthcare",
    budgetCategory: "healthcare",
    subCategory: "Elder care",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "elderCareQuality",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "healthcare", metric: "elderCareQuality" }, [
      // Elder-care quality lifts the mortality driver (lifeExpectancy); the old
      // demographicDecline readout is removed (§4.7 sweep → §4.2/§4.6 driver).
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.3 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_elder_care",
        [
          {
            name: "Universal Elder Care Guarantee Act",
            explanation:
              "Guarantee free comprehensive care for all elderly, nationalize care facilities, and fund in-home support for every household",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Elder Care Transformation Act",
            explanation:
              "Significantly expand state-funded care, cap individual care costs, and raise caregiver wages to nurse-equivalent levels",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Care Quality Investment Act",
            explanation:
              "Modestly increase elder care funding to reduce waiting lists, improve facility inspections, and expand respite services",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Elder Care Framework Act",
            explanation:
              "A moderate level of elder care funding sustaining means-tested provision and facility regulation",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Elder Care Reform Act",
            explanation:
              "Tighten means-testing, encourage private insurance for care costs, and incentivize family-based care over state provision",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Elder Care Act",
            explanation:
              "Reduce state elder care to emergency safeguarding only, leaving long-term care to private providers and families",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Elder Care Privatization Act",
            explanation:
              "Eliminate all state-funded elder care, leaving elderly support entirely to private insurance and family responsibility",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [130000, 110000, 95000, 82000, 55000, 25000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B3. Mental Health ────────────────────────────────────────────────────
  {
    _id: "jp_mental_health",
    countryScope: "jp",
    name: "Mental Health Services Act",
    description:
      "Mental health is a growing political priority — Japan has historically high suicide rates and significant stigma around seeking psychological help.",
    policyDomain: "healthcare",
    budgetCategory: "healthcare",
    subCategory: "Mental health",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "mentalHealthAccess",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "mentalHealthAccess" },
      [
        { category: "education", metric: "academicPressure", weight: 0.5 },
        { category: "social", metric: "workLifeBalance", weight: 0.4 },
        { category: "publicSafety", metric: "crimeRate", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_mental_health",
        [
          {
            name: "Universal Mental Health Guarantee Act",
            explanation:
              "Guarantee same-day access to mental health services for all, fund counseling in every school and workplace, and eliminate all barriers to care",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Mental Health Parity Act",
            explanation:
              "Significantly increase mental health funding to achieve true parity with physical health services across the insurance system",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Mental Health Investment Act",
            explanation:
              "Modestly expand counseling services, increase crisis team staffing, and reduce waiting times for therapy and psychiatric care",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Mental Health Services Act",
            explanation:
              "A moderate level of mental health funding sustaining psychological services and crisis intervention capacity",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Mental Health Efficiency Act",
            explanation:
              "Reduce direct public mental health provision, encouraging private therapy services and digital mental health platforms",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Mental Health Provision Act",
            explanation:
              "Cut public mental health services to crisis intervention only, leaving routine therapy and counseling to private providers",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Mental Health Withdrawal Act",
            explanation:
              "Eliminate dedicated public mental health services, leaving psychiatric care to GPs, private therapists, and charitable organizations",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [38000, 30000, 25000, 20000, 14000, 6000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B4. Public Health ────────────────────────────────────────────────────
  {
    _id: "jp_public_health",
    countryScope: "jp",
    name: "Public Health and Prevention Act",
    description:
      "Disease prevention, vaccination, health education, pandemic preparedness. Administered through national public health centers (hokenjo).",
    policyDomain: "healthcare",
    budgetCategory: "healthcare",
    subCategory: "Public health",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "national",
    },
    // §4.7 (P2b): lifeExpectancy/physicianRate secondaries dropped — preparedness
    // (the primary root) is an ENGINE input to the mortality chain.
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [{ category: "economic", metric: "economicFreedom", weight: -0.15 }]
    ),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_public_health",
        [
          {
            name: "Comprehensive Public Health Act",
            explanation:
              "Massively expand public health centers, fund universal screening programs, build pandemic preparedness infrastructure, and guarantee health visitors for every community",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Public Health Workforce Expansion Act",
            explanation:
              "Significantly increase public health staffing, expand disease research grants, and invest in community health infrastructure",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Community Health Investment Act",
            explanation:
              "Modestly increase public health funding for vaccination drives, cancer screening, lifestyle disease prevention, and health education",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Public Health Services Act",
            explanation:
              "A moderate level of public health funding supporting disease monitoring, vaccination programs, and emergency preparedness",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Public Health Act",
            explanation:
              "Focus public health spending on critical threats only, reducing broad prevention and health promotion programs",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Public Health Reduction Act",
            explanation:
              "Substantially cut public health center budgets, deferring disease prevention to the health insurance system and local clinics",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Public Health Elimination Act",
            explanation:
              "Eliminate dedicated public health agencies, leaving disease prevention and health promotion entirely to the insurance system and private sector",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [12000, 9000, 7000, 5500, 3500, 1500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B5. Regional Health Services ─────────────────────────────────────────
  {
    _id: "jp_regional_health",
    countryScope: "jp",
    name: "Regional Health Services Act",
    description:
      "How the prefectural assembly allocates its health-related budget for local clinics, community health workers, health visitors, and local public health initiatives. Spending from the regional budget, not the national health insurance allocation.",
    policyDomain: "healthcare",
    budgetCategory: "healthcare",
    subCategory: "Regional health",
    nationalOnly: false,
    // §4.7 (P2b): regional health FUNDING — physicians/lifeExpectancy are
    // spend-driven readouts now. Re-pointed to the system-capacity root.
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [
        { category: "economic", metric: "ruralRevitalization", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_health",
        [
          {
            name: "Comprehensive Regional Health Act",
            explanation:
              "Fund community health centers in every neighborhood, guarantee health visitors for all families, and run extensive local screening programs",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Health Expansion Act",
            explanation:
              "Significantly expand prefectural health services, fund local clinics, and invest in community mental health and addiction programs",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Community Wellness Act",
            explanation:
              "Modestly increase regional health spending on community clinics, health visiting, and local prevention campaigns",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Health Services Act",
            explanation:
              "A moderate level of regional health funding supporting community clinics, health visitors, and basic local health programs",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Lean Regional Health Act",
            explanation:
              "Reduce prefectural health spending, focusing only on statutory public health obligations and essential community services",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Regional Health Act",
            explanation:
              "Cut regional health services to mandatory safeguarding and emergency public health functions only",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Regional Health Withdrawal Act",
            explanation:
              "Eliminate all prefectural-funded health services, leaving community health provision entirely to the national insurance system and voluntary sector",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [22000, 17000, 13000, 10000, 6500, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDUCATION (6 — 4 national + 2 regional)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── B2. Education Funding ─────────────────────────────────────────────────
  {
    _id: "jp_education_funding",
    countryScope: "jp",
    name: "National Education Budget Act",
    description:
      "The overall national schools funding envelope distributed to prefectures. Covers K-12 compulsory education, teacher salaries, and school infrastructure.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Education funding",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "education", metric: "academicPressure", weight: 0.3 },
      { category: "social", metric: "socialMobility", weight: 0.4 },
      { category: "social", metric: "incomeInequality", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_education_funding",
        [
          {
            name: "Maximum Education Investment Act",
            explanation:
              "Massively increase per-pupil funding, reduce class sizes to 20, guarantee free school meals for all, and fund wraparound childcare in every school",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Education Funding Expansion Act",
            explanation:
              "Significantly increase per-pupil spending, hire more teachers, expand special needs provision, and fund after-school programs in all elementary schools",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Education Enhancement Act",
            explanation:
              "Modestly increase school funding with targeted investments in underperforming regions and expanded special needs support",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "National Education Funding Act",
            explanation:
              "A moderate level of per-pupil funding covering core teaching, facilities, and special needs provision",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Education Efficiency Act",
            explanation:
              "Reduce per-pupil spending through school consolidation, larger class sizes, and streamlined administration",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Education Funding Act",
            explanation:
              "Cut national education funding to essentials only, relying on prefectural budgets and private fundraising to supplement",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Education Funding Withdrawal Act",
            explanation:
              "Eliminate national education funding, leaving education financing entirely to prefectures and private providers",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [85000, 70000, 60000, 50000, 35000, 15000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. University Tuition ────────────────────────────────────────────────
  {
    _id: "jp_university_tuition",
    countryScope: "jp",
    name: "University Tuition and Higher Education Act",
    description:
      "University tuition fees and student support. National university tuition is a significant debate, especially as birth rates decline and universities compete for shrinking cohorts.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Higher education",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "social", metric: "socialMobility", weight: 0.5 },
      { category: "social", metric: "incomeInequality", weight: 0.4 },
      { category: "population", metric: "birthRate", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_university_tuition",
        [
          {
            name: "Free University Education Act",
            explanation:
              "Abolish tuition fees entirely at all national and public universities, fund institutions through general taxation, and provide living stipends for every student",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Tuition Fee Reduction Act",
            explanation:
              "Halve tuition fees at national universities, expand scholarship programs, and increase direct university funding from the Ministry of Education",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Student Affordability Act",
            explanation:
              "Modestly reduce tuition fees, lower student loan interest rates, and raise income thresholds for repayment",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Higher Education Funding Act",
            explanation:
              "A moderate level of university funding balancing institutional needs with student affordability",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "University Market Reform Act",
            explanation:
              "Raise tuition caps to reflect true costs, reduce direct subsidies, and encourage universities to compete on price and quality",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Higher Education Deregulation Act",
            explanation:
              "Remove fee caps entirely, let universities set market rates, and replace grants with private student loans",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "University Privatization Act",
            explanation:
              "Eliminate all public university funding, converting national universities to fully private tuition-driven institutions",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [32000, 25000, 20000, 16000, 9000, 3000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. Academic Reform ───────────────────────────────────────────────────
  {
    _id: "jp_academic_reform",
    countryScope: "jp",
    name: "Academic Culture and Education Reform Act",
    description:
      "Japan's intense exam culture (juken), cram schools (juku), student mental health, and curriculum reform. A uniquely Japanese debate.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Academic culture",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "academicPressure",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "academicPressure" }, [
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.5 },
      { category: "education", metric: "educationSpending", weight: 0.3 },
      { category: "social", metric: "genderEquality", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_academic_reform",
        [
          {
            name: "Comprehensive Student Wellbeing Act",
            explanation:
              "Ban mandatory entrance exams below high school, regulate cram school hours, mandate mental health counselors in every school, and fund creativity-based curricula",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Education Equity and Wellness Act",
            explanation:
              "Restrict cram school advertising, fund school counselors and after-school enrichment, and reduce entrance exam weighting in university admissions",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Balanced Education Reform Act",
            explanation:
              "Modestly increase mental health support in schools, encourage holistic admissions criteria, and fund pilot programs for reduced testing",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Education Framework Act",
            explanation:
              "A moderate approach allowing a mix of exam-based and holistic assessment with basic school counseling services",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Academic Excellence Promotion Act",
            explanation:
              "Strengthen entrance exam rigor, increase funding for gifted programs, and reduce regulation of private cram schools",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Meritocratic Education Act",
            explanation:
              "Expand entrance exam scope, deregulate cram schools entirely, and fund competitive academic olympiad programs",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Full Academic Deregulation Act",
            explanation:
              "Eliminate all regulation of private education, remove mental health mandates from schools, and let market forces drive academic culture",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [10000, 8000, 6000, 5000, 3000, 1500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. Research & Science ────────────────────────────────────────────────
  {
    _id: "jp_research_science",
    countryScope: "jp",
    name: "Research and Science Funding Act",
    description:
      "JSPS (Japan Society for the Promotion of Science), RIKEN, JAXA, university research grants, and industrial R&D.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Research & science",
    nationalOnly: true,
    // §4.7 (P5): research FUNDING builds the R&D root — roboticsAdoption is
    // engine-derived from it (manufacturing + rdIntensity).
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "rdIntensity",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "rdIntensity" }, [
      { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_research_science",
        [
          {
            name: "Moonshot Research Initiative Act",
            explanation:
              "Double JSPS and RIKEN budgets, fund transformative research programs, and guarantee university research grants across all disciplines",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Scientific Discovery Expansion Act",
            explanation:
              "Significantly expand JSPS, JAXA, and national laboratory funding to accelerate breakthroughs in medicine, space, and materials science",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Applied Research Growth Act",
            explanation:
              "Modestly increase research grants with emphasis on practical applications, STEM workforce development, and industrial partnerships",
            stance: "left",
            economic: -1,
            social: 0,
          },
          {
            name: "Research Continuity Act",
            explanation:
              "A moderate level of research funding supporting ongoing JSPS programs, university grants, and JAXA operations",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Industry-Led Innovation Act",
            explanation:
              "Shift research toward public-private partnerships, reducing direct government-funded basic research in favor of commercial R&D",
            stance: "right",
            economic: 1,
            social: 0,
          },
          {
            name: "Science Spending Reduction Act",
            explanation:
              "Substantially cut JSPS and national laboratory budgets, relying on private sector and universities to fund their own research",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Research Funding Elimination Act",
            explanation:
              "Eliminate government science agencies, leaving all research funding to the private sector and university endowments",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "both"
      ),
      [22000, 17000, 13000, 11000, 7000, 3000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. Regional Education Services ──────────────────────────────────────
  {
    _id: "jp_regional_education",
    countryScope: "jp",
    name: "Regional Education Services Act",
    description:
      "Prefectural education spending — early childhood education, school meals, educational support services, and special needs coordination funded from the regional budget.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Regional education",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "social", metric: "socialMobility", weight: 0.3 },
      { category: "economic", metric: "ruralRevitalization", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_education",
        [
          {
            name: "Maximum Regional Education Act",
            explanation:
              "Fund universal free nursery places, guarantee free school meals for all pupils, and provide wraparound childcare and holiday programs in every school",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Regional Education Expansion Act",
            explanation:
              "Significantly expand early childhood places, extend free school meals eligibility, and fund after-school programs across the prefecture",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Education Support Investment Act",
            explanation:
              "Modestly increase regional education spending on nursery provision, school meals expansion, and educational psychologist services",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Education Services Act",
            explanation:
              "A moderate level of regional education funding covering early childhood provision, school support services, and special needs coordination",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Education Services Efficiency Act",
            explanation:
              "Reduce regional education spending through consolidated services, tighter nursery eligibility, and means-tested school meals",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Regional Education Act",
            explanation:
              "Cut regional education services to statutory minimums, eliminating discretionary early childhood and school support programs",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Regional Education Withdrawal Act",
            explanation:
              "Eliminate all prefectural-funded education services beyond statutory obligations, leaving provision to schools and private nurseries",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [25000, 20000, 17000, 14000, 9000, 4000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B2. Regional Skills & Vocational Training ─────────────────────────────
  {
    _id: "jp_regional_skills",
    countryScope: "jp",
    name: "Regional Skills and Vocational Training Act",
    description:
      "Vocational schools (senmon gakko), apprenticeships, adult retraining, and skills development — increasingly important as Japan faces labor shortages.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Regional skills",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "unemploymentRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "unemploymentRate" }, [
      { category: "economic", metric: "ruralRevitalization", weight: 0.3 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_skills",
        [
          {
            name: "Maximum Regional Skills Act",
            explanation:
              "Fund universal vocational training access, guarantee apprenticeship places for every school leaver, and provide free adult retraining programs",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Skills Expansion Act",
            explanation:
              "Significantly expand vocational school places, fund industry partnership programs, and invest in digital skills training centers",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Workforce Development Investment Act",
            explanation:
              "Modestly increase regional skills spending on vocational training, apprenticeships, and adult education programs",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Skills and Training Act",
            explanation:
              "A moderate level of vocational training funding supporting senmon gakko, apprenticeships, and basic adult retraining",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Skills Efficiency Act",
            explanation:
              "Reduce regional skills spending, focusing on high-demand sectors only and encouraging employer-funded training",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Skills Provision Act",
            explanation:
              "Cut regional vocational services to minimum statutory requirements, leaving skills development to employers and private providers",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Skills Training Withdrawal Act",
            explanation:
              "Eliminate all prefectural vocational training services, leaving workforce development entirely to employers and private institutions",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [8000, 6000, 5000, 4000, 2500, 1000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  DEFENSE & SECURITY (3 — all national)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── B3-1. Article 9 / SDF Policy ────────────────────────────────────────
  {
    _id: "jp_article9_sdf",
    countryScope: "jp",
    name: "National Defense Posture Act",
    description:
      "The core debate: Article 9 constitutional pacifism vs. military normalization. Controls the Self-Defense Forces' mandate, scope of operations, and constitutional interpretation.",
    policyDomain: "defense",
    budgetCategory: "defense",
    subCategory: "Defense posture",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "publicSafetyConfidence" },
      [
        { category: "social", metric: "foreignWorkerIntegration", weight: -0.2 },
        { category: "governance", metric: "publicTrust", weight: 0.4 },
        { category: "economic", metric: "smallBusinessFormation", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Defense"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_article9_sdf",
        [
          {
            name: "Absolute Pacifism Act",
            explanation:
              "Reaffirm Article 9 in its strictest interpretation, prohibit all overseas deployment, disband offensive capabilities, and reduce the SDF to a civil defense corps",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Peace Constitution Preservation Act",
            explanation:
              "Strictly limit SDF to homeland defense only, prohibit collective self-defense, ban arms exports, and withdraw from all overseas security commitments",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Defensive Posture Act",
            explanation:
              "Allow limited SDF overseas participation in UN peacekeeping only, restrict collective self-defense to immediate threats, and limit arms exports to defensive equipment",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Balanced Security Framework Act",
            explanation:
              "A moderate defense posture allowing SDF participation in collective self-defense with allied nations and limited UN peacekeeping operations",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Active Defense Doctrine Act",
            explanation:
              "Expand SDF operational scope to include preemptive strike capability, broaden collective self-defense agreements, and expand arms exports to allied nations",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Military Normalization Act",
            explanation:
              "Amend Article 9 to recognize full military rights, establish a Ministry of Defense with offensive capabilities, and join multilateral military alliances as a full partner",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Full Military Sovereignty Act",
            explanation:
              "Abolish Article 9 constraints entirely, establish a fully sovereign military with global power projection capability, nuclear deterrent option, and independent defense industrial base",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [3000, 10000, 22000, 35000, 48000, 62000, 78000]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B3-2. Defense Spending ───────────────────────────────────────────────
  // INVERTED: option 0 = left/minimal defense, option 6 = right/maximum defense.
  // Social axis represents pacifism ↔ militarism spectrum.
  {
    _id: "jp_defense_spending",
    countryScope: "jp",
    name: "Defense Budget Act",
    description:
      "Overall defense spending level — separate from the posture question. Controls procurement, personnel, base maintenance, and equipment modernization. Social axis represents pacifism ↔ militarism spectrum.",
    policyDomain: "defense",
    budgetCategory: "defense",
    subCategory: "Defense budget",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "publicSafetyConfidence" },
      [
        { category: "economic", metric: "gdpGrowth", weight: -0.2 },
        { category: "governance", metric: "roboticsAdoption", weight: 0.3 },
        { category: "economic", metric: "smallBusinessFormation", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Defense"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_defense_spending",
        [
          {
            name: "Minimal Defense Act",
            explanation:
              "Reduce defense spending to minimum civil defense and coast guard operations only",
            stance: "left",
            economic: 5,
            social: -5,
          },
          {
            name: "Peace Dividend Act",
            explanation:
              "Substantially cut defense spending, redirecting funds to social programs and reducing SDF personnel levels",
            stance: "left",
            economic: 3,
            social: -3,
          },
          {
            name: "Defense Efficiency Act",
            explanation:
              "Reduce defense spending through procurement reform, base consolidation, and reduced overseas deployment costs",
            stance: "left",
            economic: 1,
            social: -1,
          },
          {
            name: "Defense Sustainability Act",
            explanation:
              "A moderate level of defense spending sufficient to fund SDF operations, base maintenance, and gradual equipment replacement",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Defense Modernization Act",
            explanation:
              "Modestly increase defense spending to upgrade aging equipment, improve SDF recruitment, and invest in missile defense systems",
            stance: "right",
            economic: -1,
            social: 1,
          },
          {
            name: "Defense Expansion Act",
            explanation:
              "Significantly increase defense budgets to fund missile defense, naval expansion, cyber warfare units, and allied interoperability programs",
            stance: "right",
            economic: -3,
            social: 3,
          },
          {
            name: "Maximum Defense Investment Act",
            explanation:
              "Massively increase defense spending to fund next-generation weapons systems, expand naval capability, and achieve full spectrum military modernization",
            stance: "right",
            economic: -5,
            social: 5,
          },
        ],
        "both"
      ),
      [3000, 12000, 25000, 38000, 52000, 65000, 80000]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B3-3. Cybersecurity ──────────────────────────────────────────────────
  {
    _id: "jp_cybersecurity",
    countryScope: "jp",
    name: "National Cybersecurity Act",
    description:
      "Cybersecurity infrastructure, digital defense, critical infrastructure protection, and information warfare capabilities.",
    policyDomain: "defense",
    budgetCategory: "defense",
    subCategory: "Cybersecurity",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "publicSafetyConfidence" },
      [
        { category: "governance", metric: "roboticsAdoption", weight: 0.3 },
        { category: "infrastructure", metric: "broadbandAccess", weight: 0.4 },
        { category: "economic", metric: "smallBusinessFormation", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Defense"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_cybersecurity",
        [
          {
            name: "Comprehensive Cyber Defense Act",
            explanation:
              "Build a world-class cyber command, fund offensive and defensive cyber capabilities, mandate security standards for all critical infrastructure, and establish a national cyber reserve force",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Cyber Infrastructure Expansion Act",
            explanation:
              "Significantly expand NISC capabilities, fund cyber defense for government systems, and establish mandatory reporting for critical infrastructure breaches",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Cyber Resilience Investment Act",
            explanation:
              "Modestly increase cybersecurity funding for government networks, fund public-private threat intelligence sharing, and expand cyber workforce training",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Cybersecurity Framework Act",
            explanation:
              "A moderate level of cybersecurity funding supporting NISC operations, basic critical infrastructure protection, and incident response capability",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Cyber Defense Act",
            explanation:
              "Focus cybersecurity spending on highest-priority government and military networks only, reducing mandates on private sector",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Cyber Provision Act",
            explanation:
              "Cut government cybersecurity to essential military and intelligence networks, leaving private sector and infrastructure protection to market forces",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Cyber Deregulation Act",
            explanation:
              "Eliminate government cybersecurity mandates and agencies, leaving digital defense entirely to private industry and market incentives",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [5000, 3500, 2500, 1800, 1000, 400, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ECONOMIC (6 — 5 national + 1 regional)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── B4-1. Fiscal Stimulus ────────────────────────────────────────────────
  {
    _id: "jp_fiscal_stimulus",
    countryScope: "jp",
    name: "Fiscal and Economic Stimulus Act",
    description:
      "Government spending stimulus — Japan's long history of fiscal stimulus packages to combat deflation and stagnation.",
    policyDomain: "economic",
    budgetCategory: "economic",
    subCategory: "Fiscal policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      { category: "economic", metric: "unemploymentRate", weight: 0.5 },
      { category: "economic", metric: "medianIncome", weight: 0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Finance"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_fiscal_stimulus",
        [
          {
            name: "Maximum Economic Stimulus Act",
            explanation:
              "Launch the largest fiscal stimulus in history, funding massive public works, direct cash transfers, and universal consumption vouchers",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Economic Recovery Investment Act",
            explanation:
              "Significantly increase government spending on infrastructure, green energy, and regional revitalization to boost aggregate demand",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Targeted Stimulus Act",
            explanation:
              "Modestly increase fiscal spending on targeted sectors — childcare, elder care, and digital infrastructure — to support growth",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Fiscal Balance Act",
            explanation:
              "A moderate level of government spending balancing economic support with fiscal discipline and debt sustainability",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Fiscal Consolidation Act",
            explanation:
              "Reduce government spending to begin paying down national debt, cutting low-priority programs and freezing public sector hiring",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Austerity and Reform Act",
            explanation:
              "Substantially cut government spending across all ministries, privatize state assets, and impose strict debt reduction targets",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Balanced Budget Mandate Act",
            explanation:
              "Eliminate deficit spending entirely, requiring all government expenditure to be funded by tax revenue alone",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [100000, 80000, 65000, 50000, 30000, 12000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B4-2. Minimum Wage ───────────────────────────────────────────────────
  {
    _id: "jp_minimum_wage",
    countryScope: "jp",
    name: "Minimum Wage Act",
    description:
      "No annualCostPerCapita — cost borne by corporations. Uses minimumWageRate field (¥/hour).",
    policyDomain: "economic",
    budgetCategory: "economic",
    subCategory: "Wage policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "povertyRate", weight: 0.5 },
      { category: "economic", metric: "smallBusinessFormation", weight: -0.3 },
      { category: "social", metric: "incomeInequality", weight: 0.4 },
    ]),
    positions: standardJPCommitteePositions("Economy & Trade"),
    policyOptions: policyOptions(
      "jp_minimum_wage",
      [
        {
          name: "Living Wage Guarantee Act",
          explanation:
            "Mandate a ¥1,800/hour national minimum wage indexed to inflation, with annual automatic adjustments and wage subsidies for small businesses",
          stance: "left",
          economic: -5,
          social: -5,
        },
        {
          name: "Wage Equity Act",
          explanation:
            "Substantially raise the national minimum wage to ¥1,500/hour, narrow the prefectural wage gap, and strengthen enforcement against wage theft",
          stance: "left",
          economic: -3,
          social: -3,
        },
        {
          name: "Worker Protection Act",
          explanation:
            "Raise the minimum wage to ¥1,250/hour with phased implementation, expand earned income support, and fund small business transition assistance",
          stance: "left",
          economic: -1,
          social: -1,
        },
        {
          name: "Balanced Wage Framework Act",
          explanation:
            "Set the national minimum wage at ¥1,000/hour, balancing worker affordability with small business viability and regional cost differences",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Business Flexibility Act",
          explanation:
            "Set the minimum wage at ¥800/hour, expand regional variation, and allow lower training wages for young workers",
          stance: "right",
          economic: 1,
          social: 1,
        },
        {
          name: "Wage Deregulation Act",
          explanation:
            "Reduce the national minimum wage to ¥500/hour, giving prefectures full authority to set wages based on local conditions",
          stance: "right",
          economic: 3,
          social: 3,
        },
        {
          name: "Minimum Wage Abolition Act",
          explanation:
            "Eliminate the national minimum wage (¥0/hour), allowing wages to be set by market forces and individual negotiation",
          stance: "right",
          economic: 5,
          social: 5,
        },
      ],
      "both"
    ).map((opt, i) => ({
      ...opt,
      minimumWageRate: [1800, 1500, 1250, 1000, 800, 500, 0][i],
    })),
    source: "seed",
    isPermanent: true,
  },

  // ── B4-3. Labor Reform ───────────────────────────────────────────────────
  {
    _id: "jp_labor_reform",
    countryScope: "jp",
    name: "Labor and Employment Reform Act",
    description:
      "Overtime regulation, non-regular worker protections, work-life balance mandates, and karoshi prevention. A defining Japanese workplace debate.",
    policyDomain: "economic",
    budgetCategory: "economic",
    subCategory: "Labor policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "workLifeBalance",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "workLifeBalance" }, [
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.4 },
      { category: "population", metric: "birthRate", weight: 0.3 },
      { category: "social", metric: "genderEquality", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Economy & Trade"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_labor_reform",
        [
          {
            name: "Comprehensive Workers' Rights Act",
            explanation:
              "Cap weekly hours at 35, mandate equal pay for regular and non-regular workers, guarantee 30 days paid leave, and establish workplace mental health enforcement",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Work-Life Balance Transformation Act",
            explanation:
              "Significantly strengthen overtime caps, mandate paternity leave, require equal treatment of non-regular workers, and fund workplace inspection expansion",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Worker Protection Enhancement Act",
            explanation:
              "Modestly tighten overtime limits, expand protections for part-time and contract workers, and increase labor standards enforcement funding",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Labor Framework Act",
            explanation:
              "A moderate level of labor regulation balancing worker protections with employer flexibility and economic competitiveness",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Labor Market Flexibility Act",
            explanation:
              "Relax overtime restrictions for high-earning professionals, simplify non-regular worker contracts, and reduce compliance burden on small businesses",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Employment Deregulation Act",
            explanation:
              "Substantially weaken overtime caps, expand permissible non-regular employment, and reduce labor inspection mandates",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Full Labor Market Liberalization Act",
            explanation:
              "Eliminate overtime regulation, remove non-regular worker protections, and let employment terms be set entirely by contract negotiation",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [5000, 3500, 2500, 1800, 1000, 400, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B4-4. SME Support ────────────────────────────────────────────────────
  {
    _id: "jp_sme_support",
    countryScope: "jp",
    name: "Small and Medium Enterprise Support Act",
    description:
      "SME policy — Japan's economy is built on small and medium enterprises (99.7% of all businesses). Support programs, subsidies, and regulatory relief.",
    policyDomain: "economic",
    budgetCategory: "economic",
    subCategory: "SME policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
        { category: "economic", metric: "ruralRevitalization", weight: 0.3 },
        { category: "economic", metric: "gdpGrowth", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Economy & Trade"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_sme_support",
        [
          {
            name: "Maximum SME Investment Act",
            explanation:
              "Massively expand low-interest government loans, provide direct grants for technology adoption, fund universal business advisory services, and guarantee public procurement set-asides for SMEs",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "SME Growth and Innovation Act",
            explanation:
              "Significantly increase SME subsidies, expand credit guarantee programs, and fund technology transfer centers in every prefecture",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "SME Enhancement Act",
            explanation:
              "Modestly increase small business support through expanded loan programs, tax incentives for hiring, and succession planning assistance",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "SME Support Framework Act",
            explanation:
              "A moderate level of SME support through credit guarantees, basic advisory services, and targeted tax relief",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "SME Self-Reliance Act",
            explanation:
              "Reduce direct SME subsidies, focusing support on high-growth startups and encouraging market consolidation of uncompetitive firms",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal SME Support Act",
            explanation:
              "Cut SME programs to basic credit guarantees only, allowing market forces to determine which businesses survive",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "SME Support Elimination Act",
            explanation:
              "Eliminate all government SME support programs, leaving small businesses to compete on market terms without state assistance",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [5000, 3500, 2500, 1500, 800, 300, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B4-5. Local Allocation Tax ───────────────────────────────────────────
  // Feeds regional budget constraint system. Default: equal 1/8th distribution.
  {
    _id: "jp_local_allocation_tax",
    countryScope: "jp",
    name: "Local Allocation Tax Act",
    description:
      "Controls the ¥/cap grant sent from the national government to prefectural regions via the Local Allocation Tax (chihou koufu zei). The primary mechanism for central-to-regional fiscal transfer. Feeds into regional budget pages.",
    policyDomain: "economic",
    budgetCategory: "economic",
    isGrant: true,
    subCategory: "Fiscal transfer",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "ruralRevitalization" },
      [
        { category: "education", metric: "educationSpending", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_local_allocation_tax",
        [
          {
            name: "Maximum Regional Investment Act",
            explanation:
              "Massively increase the Local Allocation Tax to fund comprehensive regional services, eliminate fiscal disparities between prefectures, and guarantee minimum service levels everywhere",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Regional Empowerment Act",
            explanation:
              "Significantly increase central grants to prefectures, enabling expanded local services and reducing reliance on local tax increases",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Regional Support Enhancement Act",
            explanation:
              "Modestly increase the allocation to address funding gaps in rural prefectures and support basic service expansion",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Local Allocation Tax Act",
            explanation:
              "A moderate level of central-to-regional transfer balancing prefectural needs with national fiscal discipline",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Regional Self-Reliance Act",
            explanation:
              "Reduce central grants, encouraging prefectures to raise more own-source revenue and improve fiscal efficiency",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Regional Transfer Act",
            explanation:
              "Substantially cut the Local Allocation Tax, leaving prefectures to fund most services through local taxation",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Regional Transfer Elimination Act",
            explanation:
              "Eliminate central government grants to prefectures entirely, leaving local authorities to fund themselves through local taxation alone",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [200000, 170000, 148000, 128000, 95000, 50000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B4-6. Regional Economic Development ─────────────────────────────────
  {
    _id: "jp_regional_economic_development",
    countryScope: "jp",
    name: "Regional Economic Development Act",
    description:
      "Prefectural economic development — business attraction, industrial parks, startup incubators, and regional economic strategy funded from the regional budget.",
    policyDomain: "economic",
    budgetCategory: "economic",
    subCategory: "Regional development",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "unemploymentRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "unemploymentRate" }, [
      { category: "economic", metric: "smallBusinessFormation", weight: 0.4 },
      { category: "economic", metric: "ruralRevitalization", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Economy & Trade"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_economic_development",
        [
          {
            name: "Maximum Regional Development Act",
            explanation:
              "Fund large-scale industrial parks, offer generous business relocation incentives, establish startup incubators in every city, and provide direct employment grants",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Economic Expansion Act",
            explanation:
              "Significantly expand prefectural business incentives, fund technology parks, and invest in regional branding and tourism development",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Economic Development Investment Act",
            explanation:
              "Modestly increase regional economic spending on business support, startup programs, and local industry promotion",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Economic Framework Act",
            explanation:
              "A moderate level of economic development funding supporting basic business services, trade promotion, and industrial zone maintenance",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Economic Development Efficiency Act",
            explanation:
              "Reduce prefectural economic spending, focusing on proven high-return programs and eliminating underperforming incentive schemes",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Economic Development Act",
            explanation:
              "Cut regional economic programs to essential trade promotion only, leaving business development to private sector initiative",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Economic Development Withdrawal Act",
            explanation:
              "Eliminate all prefectural economic development programs, leaving business attraction and growth entirely to market forces",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [22000, 18000, 14000, 11000, 7000, 3000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  INFRASTRUCTURE (5 — 3 national + 2 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B5-1. Disaster Preparedness ─────────────────────────────────────────────
  {
    _id: "jp_disaster_preparedness",
    countryScope: "jp",
    name: "Disaster Preparedness and Resilience Act",
    description:
      "Japan's existential infrastructure challenge — earthquake-proofing, tsunami barriers, flood control, early warning systems, and evacuation infrastructure.",
    policyDomain: "infrastructure",
    budgetCategory: "infrastructure",
    subCategory: "Disaster resilience",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "naturalDisasterPreparedness",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "environment", metric: "naturalDisasterPreparedness" },
      [
        { category: "healthcare", metric: "publicHealthPreparedness", weight: 0.3 },
        { category: "economic", metric: "ruralRevitalization", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_disaster_preparedness",
        [
          {
            name: "Maximum Disaster Resilience Act",
            explanation:
              "Build the world's most comprehensive disaster infrastructure — universal seismic retrofitting, tsunami barriers on all coastlines, and guaranteed 72-hour survival supplies for every household",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Disaster Infrastructure Expansion Act",
            explanation:
              "Significantly increase disaster spending to retrofit all public buildings, expand tsunami barrier networks, and fund next-generation early warning systems",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Disaster Resilience Investment Act",
            explanation:
              "Modestly increase disaster funding for seismic retrofitting of schools and hospitals, improved flood control, and expanded emergency shelter capacity",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Disaster Preparedness Framework Act",
            explanation:
              "A moderate level of disaster funding supporting ongoing seismic monitoring, basic retrofitting programs, and emergency response maintenance",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Disaster Spending Efficiency Act",
            explanation:
              "Reduce disaster budgets through risk-based prioritization, focusing only on highest-risk zones and deferring low-priority retrofitting",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Disaster Provision Act",
            explanation:
              "Cut disaster preparedness to essential seismic monitoring and emergency response only, leaving building retrofitting to private owners",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Disaster Spending Withdrawal Act",
            explanation:
              "Eliminate dedicated disaster preparedness funding, leaving resilience to building codes, private insurance, and local government initiative",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [48000, 38000, 30000, 24000, 15000, 7000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B5-2. Rail & Transport ───────────────────────────────────────────────────
  {
    _id: "jp_rail_transport",
    countryScope: "jp",
    name: "Rail and Transportation Infrastructure Act",
    description:
      "Japan's rail network — shinkansen expansion, conventional rail maintenance, urban transit, and the debate over continued public investment vs. privatization.",
    policyDomain: "infrastructure",
    budgetCategory: "infrastructure",
    subCategory: "Transport",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "transportEfficiency",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "transportEfficiency" },
      [
        { category: "economic", metric: "ruralRevitalization", weight: 0.4 },
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "environment", metric: "carbonEmissions", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_rail_transport",
        [
          {
            name: "Maximum Transport Investment Act",
            explanation:
              "Fund a nationwide maglev network, extend shinkansen to every prefecture, guarantee universal public transit access, and eliminate rural transit deserts",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Rail Modernization Expansion Act",
            explanation:
              "Significantly increase rail investment to extend shinkansen lines, modernize aging conventional rail, and expand urban metro systems",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Transport Enhancement Act",
            explanation:
              "Modestly increase transport funding for targeted shinkansen extensions, station accessibility upgrades, and rural bus route subsidies",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Transportation Framework Act",
            explanation:
              "A moderate level of transport investment sustaining rail maintenance, gradual shinkansen expansion, and basic rural transit subsidies",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Transport Efficiency Act",
            explanation:
              "Reduce transport spending through route rationalization, closing unprofitable rural lines, and encouraging private sector investment",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Transport Privatization Act",
            explanation:
              "Substantially cut public transport investment, privatize remaining government rail interests, and let market demand determine service levels",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Transport Funding Withdrawal Act",
            explanation:
              "Eliminate all government transport investment, leaving rail and transit provision entirely to private operators",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [30000, 24000, 19000, 15000, 9000, 4000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B5-3. Digital Infrastructure ────────────────────────────────────────────
  {
    _id: "jp_digital_infrastructure",
    countryScope: "jp",
    name: "Digital Infrastructure and Connectivity Act",
    description:
      "Broadband expansion, 5G/6G rollout, government digitization, and My Number system modernization.",
    policyDomain: "infrastructure",
    budgetCategory: "infrastructure",
    subCategory: "Digital infrastructure",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "broadbandAccess" },
      [
        { category: "governance", metric: "roboticsAdoption", weight: 0.3 },
        { category: "economic", metric: "ruralRevitalization", weight: 0.3 },
        { category: "economic", metric: "gdpGrowth", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_digital_infrastructure",
        [
          {
            name: "Digital Transformation Act",
            explanation:
              "Guarantee universal gigabit broadband, fund 6G research leadership, digitize all government services, and establish digital literacy programs for every citizen",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Digital Infrastructure Expansion Act",
            explanation:
              "Significantly expand broadband to underserved rural areas, accelerate 5G deployment, and fund comprehensive e-government platforms",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Digital Connectivity Investment Act",
            explanation:
              "Modestly increase digital spending on rural broadband subsidies, government portal modernization, and cybersecurity infrastructure",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Digital Infrastructure Framework Act",
            explanation:
              "A moderate level of digital investment supporting broadband maintenance, gradual 5G rollout, and basic e-government services",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Digital Efficiency Act",
            explanation:
              "Reduce government digital spending, encouraging private telecom investment and limiting public broadband programs to market-failure areas",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Digital Provision Act",
            explanation:
              "Cut digital infrastructure spending to essential government systems only, leaving broadband and connectivity entirely to private telecom companies",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Digital Deregulation Act",
            explanation:
              "Eliminate all government digital infrastructure programs, leaving connectivity, broadband, and digital services to the private market",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [9000, 7000, 5000, 3500, 2000, 800, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B5-4. Regional Transport ─────────────────────────────────────────────────
  {
    _id: "jp_regional_transport",
    countryScope: "jp",
    name: "Regional Transport Act",
    description:
      "Prefectural transport — local bus routes, regional rail subsidies, road maintenance, and cycling infrastructure funded from the regional budget.",
    policyDomain: "infrastructure",
    budgetCategory: "infrastructure",
    subCategory: "Regional transport",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "transportEfficiency",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "transportEfficiency" },
      [
        { category: "economic", metric: "ruralRevitalization", weight: 0.4 },
        { category: "economic", metric: "unemploymentRate", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_transport",
        [
          {
            name: "Maximum Regional Transport Act",
            explanation:
              "Fund comprehensive local bus networks, subsidize all regional rail lines, build cycling infrastructure in every municipality, and guarantee transit access for isolated communities",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Transport Expansion Act",
            explanation:
              "Significantly expand local bus routes, increase rail subsidies to prevent line closures, and invest in station accessibility and park-and-ride facilities",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Transport Connectivity Investment Act",
            explanation:
              "Modestly increase regional transport spending on bus route extensions, road maintenance, and targeted rail line subsidies",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Transport Framework Act",
            explanation:
              "A moderate level of regional transport funding supporting basic bus services, road maintenance, and minimal rail subsidies",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Transport Services Efficiency Act",
            explanation:
              "Reduce regional transport spending through route consolidation, cutting unprofitable bus services, and ending rail subsidies for low-ridership lines",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Regional Transport Act",
            explanation:
              "Cut regional transport to essential road maintenance only, eliminating bus and rail subsidies",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Regional Transport Withdrawal Act",
            explanation:
              "Eliminate all prefectural transport spending, leaving local transit and road maintenance to municipalities and private operators",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [25000, 20000, 16000, 13000, 8000, 3500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B5-5. Regional Utilities ─────────────────────────────────────────────────
  {
    _id: "jp_regional_utilities",
    countryScope: "jp",
    name: "Regional Utilities and Public Works Act",
    description:
      "Water supply, sewage, waste management, and local public works funded from the regional budget.",
    policyDomain: "infrastructure",
    budgetCategory: "infrastructure",
    subCategory: "Regional utilities",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "waterQuality",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "infrastructure", metric: "waterQuality" }, [
      { category: "healthcare", metric: "publicHealthPreparedness", weight: 0.3 },
      { category: "environment", metric: "naturalDisasterPreparedness", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_utilities",
        [
          {
            name: "Maximum Regional Utilities Act",
            explanation:
              "Fund universal water and sewage modernization, build state-of-the-art waste processing in every municipality, and guarantee infrastructure resilience against all natural disasters",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Utilities Expansion Act",
            explanation:
              "Significantly expand water treatment capacity, upgrade aging sewage systems, and invest in advanced recycling and waste reduction facilities",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Utilities Modernization Investment Act",
            explanation:
              "Modestly increase utilities spending on pipe replacement, water quality improvements, and waste management capacity expansion",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Utilities Framework Act",
            explanation:
              "A moderate level of utilities funding supporting basic water, sewage, and waste management operations and gradual infrastructure replacement",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Utilities Efficiency Act",
            explanation:
              "Reduce utilities spending through service consolidation, private sector partnerships, and deferred non-critical infrastructure replacement",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Utilities Provision Act",
            explanation:
              "Cut utilities spending to essential water supply and basic waste collection only, deferring all capital improvements",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Utilities Privatization Act",
            explanation:
              "Eliminate prefectural utilities spending, privatizing water, sewage, and waste management services entirely",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [22000, 18000, 15000, 12000, 7500, 3000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  ENVIRONMENT & ENERGY (4 — 3 national + 1 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B6-1. Nuclear Energy ─────────────────────────────────────────────────────
  // Social axis is not applicable to this type — debate cuts across left/right.
  // Social scores are 0 (null in spec) per task instructions.
  {
    _id: "jp_nuclear_energy",
    countryScope: "jp",
    name: "Nuclear Energy Policy Act",
    description:
      "The post-Fukushima debate: restart reactors vs. phase out nuclear entirely. This debate cuts across traditional left/right lines — scored on economic axis only (transition costs vs. cheap baseload), social is null.",
    policyDomain: "environment",
    budgetCategory: "environment",
    subCategory: "Energy policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "nuclearSafety",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "nuclearSafety" }, [
      { category: "environment", metric: "carbonEmissions", weight: 0.4 },
      { category: "economic", metric: "costOfLiving", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_nuclear_energy",
        [
          {
            name: "Nuclear Phase-Out Act",
            explanation:
              "Permanently shut down all nuclear reactors, decommission all plants, ban new construction, and fund comprehensive transition support for affected communities",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Nuclear Reduction Act",
            explanation:
              "Prohibit new reactor construction, accelerate decommissioning of aging plants, and mandate transition to renewables within two decades",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Cautious Nuclear Policy Act",
            explanation:
              "Allow limited restarts of reactors meeting enhanced safety standards only, with no new construction and gradual reduction in nuclear share",
            stance: "left",
            economic: -1,
            social: 0,
          },
          {
            name: "Balanced Energy Mix Act",
            explanation:
              "A moderate nuclear policy allowing reactor restarts under strict safety regulation while investing in diversified energy sources",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Nuclear Renaissance Act",
            explanation:
              "Actively restart all safety-cleared reactors, streamline regulatory approval, and invest in next-generation reactor research",
            stance: "right",
            economic: 1,
            social: 0,
          },
          {
            name: "Nuclear Expansion Act",
            explanation:
              "Fund construction of new advanced reactors, extend operating licenses for existing plants, and position nuclear as the primary baseload energy source",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Maximum Nuclear Investment Act",
            explanation:
              "Massively expand nuclear capacity with new plants in every region, fund fusion research, and establish Japan as the global leader in nuclear technology",
            stance: "right",
            economic: 4,
            social: 0,
          },
        ],
        "both"
      ),
      // Costs are NOT monotonically decreasing: phase-out is expensive (decommissioning),
      // minimal maintenance is cheapest, restarts have upfront safety costs, full expansion is most expensive.
      [28000, 16000, 8000, 5000, 10000, 22000, 40000]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B6-2. Climate & Emissions ────────────────────────────────────────────────
  {
    _id: "jp_climate_emissions",
    countryScope: "jp",
    name: "Climate and Emissions Policy Act",
    description:
      "Carbon reduction targets, emissions trading, carbon pricing, and Japan's commitments under international climate agreements.",
    policyDomain: "environment",
    budgetCategory: "environment",
    subCategory: "Climate policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "carbonEmissions" }, [
      { category: "economic", metric: "gdpGrowth", weight: -0.3 },
      { category: "healthcare", metric: "publicHealthPreparedness", weight: 0.3 },
      { category: "economic", metric: "foodSecurity", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_climate_emissions",
        [
          {
            name: "Carbon Neutrality Emergency Act",
            explanation:
              "Declare a climate emergency, mandate net-zero by the earliest possible date, impose aggressive carbon taxes, ban new fossil fuel infrastructure, and fund massive green transition programs",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Accelerated Decarbonization Act",
            explanation:
              "Significantly tighten emissions targets, expand carbon pricing to all sectors, and fund major industrial decarbonization and green hydrogen programs",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Climate Action Enhancement Act",
            explanation:
              "Modestly strengthen emissions targets, introduce sector-specific carbon pricing, and fund clean technology research and deployment incentives",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Climate Policy Framework Act",
            explanation:
              "A moderate emissions reduction approach balancing climate commitments with economic competitiveness and energy security",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Economic-First Climate Act",
            explanation:
              "Relax emissions timelines to protect industrial competitiveness, limit carbon pricing to voluntary markets, and prioritize energy security over climate targets",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Climate Regulation Reduction Act",
            explanation:
              "Substantially weaken emissions targets, eliminate carbon pricing, and remove regulatory burden on fossil fuel industries",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Climate Policy Withdrawal Act",
            explanation:
              "Abandon emissions reduction targets, exit international climate agreements, and eliminate all climate-related regulation and spending",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [32000, 24000, 18000, 14000, 8000, 3000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B6-3. Renewable Energy ───────────────────────────────────────────────────
  {
    _id: "jp_renewable_energy",
    countryScope: "jp",
    name: "Renewable Energy Investment Act",
    description:
      "Solar, wind, geothermal, and hydroelectric investment. Japan has significant untapped geothermal potential and growing offshore wind capacity.",
    policyDomain: "environment",
    budgetCategory: "environment",
    subCategory: "Energy policy",
    nationalOnly: true,
    // §4.7 (P3c): pure renewables INVESTMENT law — re-pointed from carbon to the
    // renewables ROOT it actually builds; the engine derives carbon/transition.
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "renewableEnergy" }, [
      { category: "environment", metric: "nuclearSafety", weight: 0.2 },
      { category: "economic", metric: "costOfLiving", weight: 0.3 },
      { category: "economic", metric: "gdpGrowth", weight: -0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_renewable_energy",
        [
          {
            name: "Maximum Renewable Investment Act",
            explanation:
              "Fund a complete transition to renewable energy, mandate 100% renewable electricity, subsidize residential solar for every household, and invest in grid-scale battery storage nationwide",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Renewable Energy Acceleration Act",
            explanation:
              "Significantly increase renewable subsidies, fast-track offshore wind and geothermal permitting, and fund advanced grid storage research",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Green Energy Investment Act",
            explanation:
              "Modestly increase renewable energy funding for solar feed-in tariffs, community wind projects, and geothermal exploration grants",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Renewable Energy Framework Act",
            explanation:
              "A moderate level of renewable investment supporting gradual capacity growth through feed-in tariffs and competitive auctions",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Market-Based Energy Transition Act",
            explanation:
              "Reduce renewable subsidies, relying on market forces and carbon pricing to drive renewable adoption rather than direct government investment",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Renewable Support Act",
            explanation:
              "Cut renewable subsidies to research-only, ending feed-in tariffs and letting renewables compete unsubsidized against fossil fuels and nuclear",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Renewable Subsidy Elimination Act",
            explanation:
              "Eliminate all renewable energy subsidies and mandates, letting the energy market determine the optimal generation mix",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [28000, 20000, 15000, 12500, 7000, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B6-4. Regional Environment ───────────────────────────────────────────────
  {
    _id: "jp_regional_environment",
    countryScope: "jp",
    name: "Regional Environment Act",
    description:
      "Prefectural environmental spending — local pollution control, nature conservation, parks, recycling programs, and environmental monitoring funded from the regional budget.",
    policyDomain: "environment",
    budgetCategory: "environment",
    subCategory: "Regional environment",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "airQuality",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "airQuality" }, [
      { category: "economic", metric: "ruralRevitalization", weight: 0.2 },
      { category: "economic", metric: "foodSecurity", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_environment",
        [
          {
            name: "Maximum Regional Environment Act",
            explanation:
              "Fund comprehensive pollution monitoring, establish nature reserves in every municipality, mandate zero-waste programs, and invest in wetland and coastal restoration",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Environment Expansion Act",
            explanation:
              "Significantly expand environmental monitoring, fund river and coastal cleanup programs, and invest in prefectural nature conservation and park infrastructure",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Environmental Quality Investment Act",
            explanation:
              "Modestly increase environmental spending on air and water quality monitoring, recycling infrastructure, and local conservation programs",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Environment Framework Act",
            explanation:
              "A moderate level of environmental funding supporting basic pollution monitoring, waste management regulation, and park maintenance",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Environmental Efficiency Act",
            explanation:
              "Reduce environmental spending through streamlined monitoring, focusing only on critical pollution sources and statutory obligations",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Environmental Provision Act",
            explanation:
              "Cut environmental services to mandatory pollution compliance and basic waste regulation only",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Environmental Deregulation Act",
            explanation:
              "Eliminate prefectural environmental programs, leaving pollution control and conservation to national agencies and private landowners",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [18000, 14000, 10000, 8500, 5000, 2000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  SOCIAL POLICY (4 — 3 national + 1 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B7-1. Family Policy ──────────────────────────────────────────────────────
  {
    _id: "jp_family_policy",
    countryScope: "jp",
    name: "Family Policy and Birthrate Support Act",
    description:
      "Japan's most urgent social challenge — declining birthrate, childcare availability, parental leave, and financial incentives for family formation.",
    policyDomain: "social",
    budgetCategory: "social",
    subCategory: "Family policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "population",
      metricId: "birthRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "population", metric: "birthRate" }, [
      { category: "social", metric: "genderEquality", weight: 0.4 },
      { category: "social", metric: "workLifeBalance", weight: 0.3 },
      // demographicDecline removed (§4.7 sweep) — birthRate is already the primary
      // driver above; the decline readout emerges from the fertility flow.
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_family_policy",
        [
          {
            name: "Comprehensive Family Support Act",
            explanation:
              "Guarantee universal free childcare from birth, provide generous monthly child allowances through age 18, mandate one year paid parental leave for both parents, and fund fertility treatment coverage for all",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Family Investment Act",
            explanation:
              "Significantly expand childcare capacity, increase child allowances, extend paid parental leave, and fund housing subsidies for young families",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Family Support Enhancement Act",
            explanation:
              "Modestly increase childcare subsidies, expand parental leave eligibility, and fund after-school programs and child welfare services",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Family Policy Framework Act",
            explanation:
              "A moderate level of family support through childcare subsidies, basic parental leave provisions, and targeted child allowances",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Family Self-Reliance Act",
            explanation:
              "Reduce direct family subsidies, encouraging employer-provided childcare and private-sector family support solutions",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Family Support Act",
            explanation:
              "Cut family programs to basic child welfare protection only, leaving childcare and family formation support to employers and families",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Family Support Withdrawal Act",
            explanation:
              "Eliminate all government family support programs, leaving childcare, parental leave, and family planning entirely to private arrangements",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [45000, 36000, 28000, 22000, 12000, 5000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B7-1b. Pension & Retirement Age ──────────────────────────────────────────
  // §4.6 new-act gap #3: JP had elder care + family policy but NO pension/
  // retirement-age law — a glaring gap for the world's oldest society. The
  // retirement-age lever drives older-worker laborParticipation → labor force L
  // (§5.1); expanding/lowering the age (left) cuts participation, raising it
  // (right) lifts it. Dependency ratio emerges from the cohort vector (not wired
  // directly — it is a derived readout, §4.7).
  {
    _id: "jp_pension",
    countryScope: "jp",
    name: "Pension & Retirement Age Act",
    description:
      "Kōsei Nenkin / Kokumin Nenkin public pension — replacement rate, contribution balance, and the pensionable-age (shikyū kaishi nenrei) debate.",
    explanation:
      "Japan's public pension system and the retirement-age question for the world's oldest society. Left positions expand benefits and protect an earlier pensionable age; right positions raise the age and trim benefits for fiscal sustainability.",
    policyDomain: "economic",
    subCategory: "Pension system",
    budgetCategory: "social",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "povertyRate", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "povertyRate" }, [
      // Retirement-age lever → older-worker laborParticipation → labor force L
      // (§5.1). Negative: expanding pensions / lower pensionable age (left) cuts
      // participation; raising the age (right) lifts it.
      { category: "economic", metric: "laborParticipation", weight: -0.3 },
      { category: "governance", metric: "budgetBalance", weight: -0.4 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_pension",
        [
          {
            name: "Universal Pension Guarantee Act",
            explanation:
              "Guarantee a generous flat public pension, lower the pensionable age toward 60, and raise the replacement rate funded by higher contributions and general revenue",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Pension Expansion Act",
            explanation:
              "Raise benefit levels, strengthen the minimum guaranteed pension, and protect the current pensionable age against increases",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Pension Enhancement Act",
            explanation:
              "Modestly increase benefits and expand low-income pensioner supplements while holding the pensionable age steady",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Pension Sustainability Act",
            explanation:
              "Maintain the current replacement rate and pensionable age with macroeconomic-slide indexation to balance the fund",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Pension Reform Act",
            explanation:
              "Gradually raise the pensionable age toward 67, tighten indexation, and expand private supplementary accounts",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Retirement Age Increase Act",
            explanation:
              "Raise the pensionable age toward 70, means-test benefits for wealthier retirees, and incentivize continued employment of older workers",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Pension Privatization Act",
            explanation:
              "Convert the public pension to a minimum-floor scheme, mandate private retirement accounts, and let the effective retirement age float with the market",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "economic"
      ),
      [62000, 49000, 39000, 30000, 18000, 8000, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B7-2. Gender Equality ────────────────────────────────────────────────────
  {
    _id: "jp_gender_equality",
    countryScope: "jp",
    name: "Gender Equality and Women's Advancement Act",
    description:
      "Japan ranks notably low among developed nations for gender equality — workforce participation gap, political representation, pay equity, and workplace discrimination.",
    policyDomain: "social",
    budgetCategory: "social",
    subCategory: "Gender equality",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "genderEquality",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "genderEquality" }, [
      { category: "population", metric: "birthRate", weight: 0.3 },
      { category: "social", metric: "workLifeBalance", weight: 0.3 },
      { category: "economic", metric: "medianIncome", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Health & Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_gender_equality",
        [
          {
            name: "Comprehensive Gender Equality Act",
            explanation:
              "Mandate gender parity quotas in all elected bodies and corporate boards, enforce equal pay audits, guarantee universal childcare, and fund women's career re-entry programs",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Women's Advancement Act",
            explanation:
              "Significantly strengthen equal pay enforcement, set corporate diversity targets, fund women's entrepreneurship programs, and expand workplace harassment protections",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Gender Equity Enhancement Act",
            explanation:
              "Modestly increase funding for workplace equality programs, expand sexual harassment reporting mechanisms, and support women returning to work after childrearing",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Gender Policy Framework Act",
            explanation:
              "A moderate approach supporting voluntary corporate diversity initiatives and basic workplace equality enforcement",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Merit-Based Opportunity Act",
            explanation:
              "Reduce gender-specific programs in favor of merit-based policies, relying on market forces and voluntary corporate action to address gaps",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Minimal Equality Provision Act",
            explanation:
              "Cut gender equality programs to basic anti-discrimination enforcement only, eliminating affirmative action and diversity mandates",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Gender Program Elimination Act",
            explanation:
              "Eliminate all government gender equality programs and mandates, leaving workplace composition and pay entirely to employer discretion",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "social"
      ),
      [3000, 2000, 1200, 800, 400, 150, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B7-3. Work Culture Reform ────────────────────────────────────────────────
  {
    _id: "jp_work_culture_reform",
    countryScope: "jp",
    name: "Work Culture and Lifestyle Reform Act",
    description:
      "Karoshi prevention, mandatory vacation, remote work incentives, and the broader cultural shift away from overwork. Distinct from labor reform (which covers legal protections) — this is about culture change and lifestyle support.",
    policyDomain: "social",
    budgetCategory: "social",
    subCategory: "Work culture",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "workLifeBalance",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "workLifeBalance" }, [
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.4 },
      { category: "population", metric: "birthRate", weight: 0.3 },
      { category: "social", metric: "genderEquality", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Economy & Trade"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_work_culture_reform",
        [
          {
            name: "Comprehensive Work-Life Revolution Act",
            explanation:
              "Mandate a four-day work week, fund universal remote work infrastructure, require companies to track and report employee wellbeing metrics, and establish a national right to disconnect",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Work-Life Transformation Act",
            explanation:
              "Significantly expand mandatory vacation days, fund workplace wellness programs, require overtime disclosure reporting, and invest in community recreation infrastructure",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Lifestyle Enhancement Act",
            explanation:
              "Modestly increase work-life balance support through remote work subsidies, mental health days, and employer wellness program incentives",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Work Culture Framework Act",
            explanation:
              "A moderate approach supporting voluntary workplace wellness initiatives and basic karoshi prevention enforcement",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Workplace Flexibility Act",
            explanation:
              "Reduce mandated work-life programs, allowing employers and employees to negotiate work arrangements based on industry needs",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Work Culture Regulation Act",
            explanation:
              "Cut work culture programs to essential karoshi prevention enforcement only, eliminating lifestyle mandates and wellness requirements",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Work Culture Deregulation Act",
            explanation:
              "Eliminate all government work culture programs and mandates, leaving workplace culture entirely to employer-employee relationships",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [5000, 3500, 2500, 1600, 800, 300, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B7-4. Regional Social Services ──────────────────────────────────────────
  {
    _id: "jp_regional_social_services",
    countryScope: "jp",
    name: "Regional Social Services Act",
    description:
      "Prefectural social services — community centers, childcare coordination, domestic violence support, disability services, and social welfare programs funded from the regional budget.",
    policyDomain: "social",
    budgetCategory: "social",
    subCategory: "Regional social services",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "socialCohesion",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "socialCohesion" }, [
      { category: "publicSafety", metric: "crimeRate", weight: 0.3 },
      { category: "healthcare", metric: "mentalHealthAccess", weight: 0.3 },
    ]),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_social_services",
        [
          {
            name: "Maximum Regional Social Services Act",
            explanation:
              "Fund comprehensive community centers in every neighborhood, guarantee domestic violence shelters, provide universal disability support, and establish prefectural social workers in every school",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Regional Social Services Expansion Act",
            explanation:
              "Significantly expand community support centers, increase domestic violence and child protection staffing, and fund disability employment programs",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Social Services Investment Act",
            explanation:
              "Modestly increase regional social spending on community centers, family support services, and disability access improvements",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Social Services Framework Act",
            explanation:
              "A moderate level of social services funding supporting basic community centers, statutory welfare obligations, and minimal disability support",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Social Services Efficiency Act",
            explanation:
              "Reduce regional social spending through service consolidation, tighter eligibility criteria, and encouraging volunteer and nonprofit alternatives",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Social Services Act",
            explanation:
              "Cut social services to mandatory statutory welfare only, eliminating community centers and discretionary support programs",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Social Services Withdrawal Act",
            explanation:
              "Eliminate all prefectural social services beyond statutory minimums, leaving community support to nonprofits and voluntary organizations",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [20000, 16000, 12000, 9000, 5500, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  IMMIGRATION (3 — all national)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B8.1. Foreign Worker Policy ──────────────────────────────────────────
  {
    _id: "jp_foreign_worker_policy",
    countryScope: "jp",
    name: "Foreign Worker and Immigration Policy Act",
    description:
      "The core immigration debate: how many foreign workers to admit, under what conditions, and with what path to residency.",
    policyDomain: "immigration",
    budgetCategory: "immigration",
    subCategory: "Immigration policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foreignWorkerIntegration",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "social", metric: "foreignWorkerIntegration" },
      [
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
        // Foreign-worker inflow is the migration driver → migrationRate (§4.6);
        // demographicDecline readout emerges from the migration flow (§4.7).
        { category: "population", metric: "migrationRate", weight: 0.4 },
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_foreign_worker_policy",
        [
          {
            name: "Open Immigration Act",
            explanation:
              "Dramatically expand immigration pathways, create universal work visa access, provide fast-track permanent residency, and fund comprehensive settlement support for all immigrants",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Immigration Expansion Act",
            explanation:
              "Significantly increase visa quotas across all skilled worker categories, create new family reunification pathways, and fund language and cultural integration programs",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Workforce Immigration Enhancement Act",
            explanation:
              "Modestly expand the Specified Skilled Worker program, broaden eligible job categories, and increase funding for workplace Japanese language training",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Immigration Policy Framework Act",
            explanation:
              "A moderate immigration approach balancing labor market needs with social cohesion through controlled visa programs and basic integration support",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Selective Immigration Act",
            explanation:
              "Tighten visa requirements to prioritize high-skilled workers only, reduce family reunification pathways, and strengthen enforcement against overstays",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Immigration Restriction Act",
            explanation:
              "Substantially reduce visa quotas, limit foreign workers to acute shortage sectors only, and increase deportation enforcement funding",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Immigration Moratorium Act",
            explanation:
              "Halt new work visa issuance, end family reunification programs, and dedicate all immigration spending to border enforcement and overstay removal",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [6000, 4500, 3000, 2000, 1200, 600, 200]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B8.2. Visa and Residency Standards ───────────────────────────────────
  {
    _id: "jp_visa_residency",
    countryScope: "jp",
    name: "Visa and Residency Standards Act",
    description:
      "The legal framework for visa categories, residency requirements, and the path to permanent residency or citizenship.",
    policyDomain: "immigration",
    budgetCategory: "immigration",
    subCategory: "Visa and residency",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foreignWorkerIntegration",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "social", metric: "foreignWorkerIntegration" },
      [
        { category: "social", metric: "socialCohesion", weight: 0.3 },
        // Visa/residency volume is a migration inflow → migrationRate driver (§4.6);
        // demographicDecline readout emerges from the flow (§4.7 sweep).
        { category: "population", metric: "migrationRate", weight: 0.4 },
        { category: "economic", metric: "economicFreedom", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_visa_residency",
        [
          {
            name: "Inclusive Residency Act",
            explanation:
              "Create a clear path to citizenship for all long-term residents, reduce permanent residency requirements, grant local voting rights to permanent residents, and recognize dual nationality",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Residency Reform Act",
            explanation:
              "Simplify permanent residency applications, reduce required years of continuous residence, and expand visa categories with residency pathways",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Residency Enhancement Act",
            explanation:
              "Modestly ease permanent residency requirements for skilled workers and long-term residents, and streamline visa renewal processes",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Residency Standards Framework Act",
            explanation:
              "A moderate residency system with clear requirements for permanent residency and defined visa categories balancing accessibility with control",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Residency Standards Tightening Act",
            explanation:
              "Increase years of residence required for permanent residency, add Japanese language proficiency requirements, and restrict visa category switching",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Strict Residency Standards Act",
            explanation:
              "Substantially tighten permanent residency criteria, require advanced language proficiency, and limit visa renewals to discourage long-term settlement",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Maximum Residency Restriction Act",
            explanation:
              "Make permanent residency nearly unattainable, eliminate citizenship pathways for most visa holders, and enforce strict temporary-stay-only visa conditions",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [4000, 3000, 2000, 1200, 800, 400, 200]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B8.3. Immigrant Integration Programs ─────────────────────────────────
  {
    _id: "jp_integration_programs",
    countryScope: "jp",
    name: "Immigrant Integration and Support Act",
    description:
      "How the government supports foreign residents already in Japan — language education, cultural programs, anti-discrimination enforcement, and community integration.",
    policyDomain: "immigration",
    budgetCategory: "immigration",
    subCategory: "Integration programs",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foreignWorkerIntegration",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "social", metric: "foreignWorkerIntegration" },
      [
        { category: "social", metric: "socialCohesion", weight: 0.5 },
        { category: "publicSafety", metric: "crimeRate", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_integration_programs",
        [
          {
            name: "Comprehensive Integration Act",
            explanation:
              "Fund universal free Japanese language education for all foreign residents, establish multicultural community centers in every city, mandate anti-discrimination enforcement, and provide housing and employment assistance",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Integration Investment Act",
            explanation:
              "Significantly expand Japanese language programs, fund community integration coordinators in every prefecture, and strengthen workplace anti-discrimination protections",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Integration Enhancement Act",
            explanation:
              "Modestly increase integration funding for language classes, cultural orientation programs, and local government multicultural support services",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Integration Framework Act",
            explanation:
              "A moderate level of integration support through basic language assistance, translated government services, and voluntary community programs",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Integration Efficiency Act",
            explanation:
              "Reduce government integration spending, encouraging employer-provided language training and community-based voluntary integration efforts",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Integration Provision Act",
            explanation:
              "Cut integration programs to essential translated government notices only, leaving language education and cultural adjustment to immigrants themselves",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Integration Program Elimination Act",
            explanation:
              "Eliminate all government integration programs, expecting foreign residents to adapt independently without state support",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [2000, 1400, 900, 550, 300, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  AGRICULTURE & FOOD (4 — 3 national + 1 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B9.1. Agricultural Subsidies ─────────────────────────────────────────
  {
    _id: "jp_agricultural_subsidies",
    countryScope: "jp",
    name: "Agricultural Subsidies and Farming Support Act",
    description:
      "Farm subsidies, rice production support, agricultural cooperatives (JA), and the debate over protecting Japan's farming sector vs. market liberalization.",
    policyDomain: "agriculture",
    budgetCategory: "agriculture",
    subCategory: "Agricultural subsidies",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "foodSecurity",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "foodSecurity" }, [
      { category: "economic", metric: "ruralRevitalization", weight: 0.5 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
      { category: "economic", metric: "gdpGrowth", weight: -0.2 },
    ]),
    positions: standardJPCommitteePositions("Agriculture"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_agricultural_subsidies",
        [
          {
            name: "Maximum Agricultural Investment Act",
            explanation:
              "Massively expand farm subsidies, guarantee minimum incomes for all farmers, fund agricultural technology adoption, and provide free farmland to new entrants",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Agricultural Revitalization Act",
            explanation:
              "Significantly increase farming subsidies, expand crop insurance programs, fund irrigation modernization, and invest in agricultural export promotion",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Farm Support Enhancement Act",
            explanation:
              "Modestly increase agricultural spending on direct payments, young farmer recruitment programs, and organic farming transition subsidies",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Agricultural Policy Framework Act",
            explanation:
              "A moderate level of farm support through rice production subsidies, basic crop insurance, and agricultural cooperative support",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Agricultural Reform Act",
            explanation:
              "Reduce direct farm subsidies, encourage farm consolidation and corporate farming, and open agricultural markets to greater competition",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Agricultural Liberalization Act",
            explanation:
              "Substantially cut farm subsidies, dismantle JA cooperative protections, and let market prices determine agricultural production patterns",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Agricultural Subsidy Elimination Act",
            explanation:
              "Eliminate all agricultural subsidies and market protections, leaving farming to compete on global market terms without state support",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [15000, 11000, 9000, 7000, 4000, 1500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B9.2. Food Security ───────────────────────────────────────────────────
  {
    _id: "jp_food_security",
    countryScope: "jp",
    name: "Food Security and Self-Sufficiency Act",
    description:
      "Japan's food self-sufficiency strategy — strategic grain reserves, domestic production targets, food supply chain resilience, and emergency food security planning.",
    policyDomain: "agriculture",
    budgetCategory: "agriculture",
    subCategory: "Food security",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "foodSecurity",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "foodSecurity" }, [
      { category: "environment", metric: "naturalDisasterPreparedness", weight: 0.3 },
      { category: "healthcare", metric: "publicHealthPreparedness", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Agriculture"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_food_security",
        [
          {
            name: "Maximum Food Sovereignty Act",
            explanation:
              "Mandate dramatic increases in domestic food production, build massive strategic reserves, fund vertical farming and aquaculture expansion, and ban export of staple crops",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Food Security Expansion Act",
            explanation:
              "Significantly increase food self-sufficiency targets, expand strategic grain and protein reserves, and fund domestic aquaculture and greenhouse agriculture",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Food Resilience Investment Act",
            explanation:
              "Modestly increase food security spending on strategic reserves, supply chain diversification, and domestic production incentives for key staples",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Food Security Framework Act",
            explanation:
              "A moderate approach to food security through basic strategic reserves, import diversification, and targeted domestic production support",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Market-Based Food Security Act",
            explanation:
              "Reduce direct food security spending, relying on trade agreements and import diversification rather than domestic production mandates",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Food Security Act",
            explanation:
              "Cut food security programs to emergency reserves only, leaving food supply management to market forces and international trade",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Food Security Withdrawal Act",
            explanation:
              "Eliminate dedicated food security programs, relying entirely on global trade for food supply with no strategic reserves or production targets",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [6000, 4500, 3200, 2200, 1200, 500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B9.3. Rural Development ───────────────────────────────────────────────
  {
    _id: "jp_rural_development",
    countryScope: "jp",
    name: "Rural Development and Revitalization Act",
    description:
      "The urban-rural divide — depopulating countryside, shuttered rural economies, and government programs to attract residents and investment back to rural Japan.",
    policyDomain: "agriculture",
    budgetCategory: "agriculture",
    subCategory: "Rural development",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "ruralRevitalization" },
      [
        // Rural revitalization slows urban concentration → urbanizationRate (§4.6,
        // negative). demographicDecline readout removed (§4.7 sweep).
        { category: "population", metric: "urbanizationRate", weight: -0.4 },
        { category: "infrastructure", metric: "transportEfficiency", weight: 0.3 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      ]
    ),
    positions: standardJPCommitteePositions("Agriculture"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_rural_development",
        [
          {
            name: "Comprehensive Rural Revival Act",
            explanation:
              "Fund massive relocation incentives, guarantee broadband and healthcare access in every rural community, establish government offices in rural areas, and create rural enterprise zones with zero taxation",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Rural Investment Act",
            explanation:
              "Significantly increase rural development funding for infrastructure, telecommuting centers, tourism development, and young farmer recruitment programs",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Rural Support Enhancement Act",
            explanation:
              "Modestly increase rural revitalization spending on community maintenance, small business support, and regional tourism promotion",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Rural Development Framework Act",
            explanation:
              "A moderate level of rural support through basic infrastructure maintenance, community preservation grants, and targeted revitalization programs",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Rural Efficiency Act",
            explanation:
              "Reduce rural development spending, focusing on consolidating services into regional hubs rather than supporting all scattered communities",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Rural Support Act",
            explanation:
              "Cut rural programs to essential infrastructure maintenance only, accepting managed decline of unviable communities",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Rural Program Elimination Act",
            explanation:
              "Eliminate all rural development programs, allowing market forces and demographic trends to determine which communities survive",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [8000, 6000, 4500, 3200, 1800, 700, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B9.4. Regional Agriculture ────────────────────────────────────────────
  {
    _id: "jp_regional_agriculture",
    countryScope: "jp",
    name: "Regional Agriculture Act",
    description:
      "Prefectural agricultural support — local farm extension services, regional crop promotion, farmers' markets, and agricultural land use planning funded from the regional budget.",
    policyDomain: "agriculture",
    budgetCategory: "agriculture",
    subCategory: "Regional agriculture",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "foodSecurity",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "foodSecurity" }, [
      { category: "economic", metric: "ruralRevitalization", weight: 0.3 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Agriculture"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_agriculture",
        [
          {
            name: "Maximum Regional Agriculture Act",
            explanation:
              "Fund comprehensive agricultural extension in every municipality, establish prefectural food processing centers, guarantee local procurement for all public institutions, and subsidize organic farming transitions",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Regional Agriculture Expansion Act",
            explanation:
              "Significantly expand farm advisory services, fund regional brand development and export promotion, and invest in agricultural technology demonstration farms",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Agricultural Support Investment Act",
            explanation:
              "Modestly increase regional agriculture spending on extension services, farmers' market infrastructure, and local food promotion campaigns",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Agriculture Framework Act",
            explanation:
              "A moderate level of agricultural support through basic extension services, land use planning, and seasonal crop promotion",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Agricultural Efficiency Act",
            explanation:
              "Reduce prefectural agricultural spending, consolidating extension services and focusing on high-value export crops only",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Regional Agriculture Act",
            explanation:
              "Cut agricultural services to essential land use regulation and pest control only",
            stance: "right",
            economic: 3,
            social: 2,
          },
          {
            name: "Regional Agriculture Withdrawal Act",
            explanation:
              "Eliminate all prefectural agricultural programs, leaving farming support to JA cooperatives and the national government",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [11000, 8500, 6500, 5000, 3000, 1200, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  GOVERNANCE (4 — 3 national + 1 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B10.1. Constitutional Reform ─────────────────────────────────────────
  {
    _id: "jp_constitutional_reform",
    countryScope: "jp",
    name: "Constitutional Reform Act",
    description:
      "The long-running debate over revising Japan's postwar constitution — covers emergency powers, human rights provisions, amendment thresholds, and the Emperor's role beyond just the Article 9 defense question.",
    policyDomain: "governance",
    budgetCategory: "governance",
    subCategory: "Constitutional reform",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "publicTrust",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "social", metric: "socialCohesion", weight: -0.3 },
    ]),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_constitutional_reform",
        [
          {
            name: "Constitutional Preservation Act",
            explanation:
              "Permanently entrench the postwar constitution against amendment, strengthen judicial review powers, and expand civil liberties protections",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Constitutional Defense Act",
            explanation:
              "Oppose all constitutional amendments, strengthen the amendment threshold, and fund civic education programs on constitutional values",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Cautious Reform Act",
            explanation:
              "Allow only narrow, consensus-based amendments on technical governance matters while preserving core constitutional principles",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Constitutional Review Framework Act",
            explanation:
              "A moderate approach enabling structured constitutional review through bipartisan commissions while protecting fundamental rights",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Constitutional Modernization Act",
            explanation:
              "Lower the amendment threshold, enable revision of outdated provisions, and establish a formal constitutional convention process",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Broad Constitutional Reform Act",
            explanation:
              "Pursue comprehensive constitutional revision including emergency powers, regional governance restructuring, and modern rights provisions",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Full Constitutional Rewrite Act",
            explanation:
              "Draft an entirely new constitution replacing the postwar framework, establishing expanded executive powers, explicit military rights, and restructured governance",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [2000, 1500, 1000, 800, 1200, 2000, 3000]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B10.2. Regional Autonomy ──────────────────────────────────────────────
  {
    _id: "jp_regional_autonomy",
    countryScope: "jp",
    name: "Regional Autonomy and Decentralization Act",
    description:
      "The balance of power between Tokyo and the prefectures — how much fiscal and regulatory authority to devolve to regional governments.",
    policyDomain: "governance",
    budgetCategory: "governance",
    subCategory: "Regional autonomy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "ruralRevitalization" },
      [
        { category: "governance", metric: "governmentTransparency", weight: 0.4 },
        { category: "governance", metric: "publicTrust", weight: 0.3 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_autonomy",
        [
          {
            name: "Maximum Devolution Act",
            explanation:
              "Devolve all domestic policy to prefectural governments, grant full tax-raising powers, and create a federal structure with the Diet handling only defense and foreign affairs",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Regional Empowerment Act",
            explanation:
              "Significantly expand prefectural authority over education, healthcare, and infrastructure, devolve new tax powers, and reduce central government mandates",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Decentralization Enhancement Act",
            explanation:
              "Modestly increase prefectural autonomy over service delivery, expand local regulatory discretion, and simplify central government reporting requirements",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Regional Governance Framework Act",
            explanation:
              "A moderate balance between central coordination and regional autonomy, with clear division of responsibilities and shared revenue arrangements",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Central Coordination Act",
            explanation:
              "Strengthen central government oversight of prefectural spending, standardize service delivery across regions, and reduce regulatory variation between prefectures",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Centralization Act",
            explanation:
              "Substantially reduce prefectural authority, centralizing major policy decisions in Tokyo and converting prefectures to administrative delivery units",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Full Centralization Act",
            explanation:
              "Abolish meaningful prefectural autonomy, centralizing all policy, taxation, and service delivery decisions in the national government",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [8000, 6000, 4000, 2500, 1500, 800, 500]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B10.3. Electoral Reform ───────────────────────────────────────────────
  {
    _id: "jp_electoral_reform",
    countryScope: "jp",
    name: "Electoral Reform Act",
    description:
      "Electoral system reform — the debate over FPTP vs. proportional representation, campaign finance, voting age, and political participation.",
    policyDomain: "governance",
    budgetCategory: "governance",
    subCategory: "Electoral reform",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "publicTrust",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "social", metric: "socialCohesion", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_electoral_reform",
        [
          {
            name: "Full Proportional Representation Act",
            explanation:
              "Replace all FPTP seats with proportional representation, implement public campaign financing, lower voting age to 16, and mandate automatic voter registration",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Electoral Democratization Act",
            explanation:
              "Significantly increase proportional representation seats, strengthen campaign finance limits, and fund civic engagement and voter education programs",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Electoral Fairness Act",
            explanation:
              "Modestly increase proportional seats, address malapportionment between urban and rural districts, and strengthen political donation transparency",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Electoral System Framework Act",
            explanation:
              "A moderate electoral system balancing single-member districts with proportional representation and basic campaign finance regulation",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Electoral Stability Act",
            explanation:
              "Reduce proportional representation seats in favor of single-member districts, relax campaign spending limits, and preserve existing electoral boundaries",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Majoritarian Electoral Act",
            explanation:
              "Substantially reduce or eliminate proportional seats, move toward a fully FPTP system, and deregulate campaign finance",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Full Majoritarian Act",
            explanation:
              "Eliminate proportional representation entirely, implement pure FPTP elections, and remove campaign spending limits",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "both"
      ),
      [3000, 2200, 1500, 1000, 700, 400, 200]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B10.4. Regional Governance ────────────────────────────────────────────
  {
    _id: "jp_regional_governance",
    countryScope: "jp",
    name: "Regional Governance Act",
    description:
      "Prefectural governance — local government transparency, public participation mechanisms, and administrative efficiency funded from the regional budget.",
    policyDomain: "governance",
    budgetCategory: "governance",
    subCategory: "Regional governance",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "publicTrust",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "governance", metric: "governmentTransparency", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_governance",
        [
          {
            name: "Maximum Regional Democracy Act",
            explanation:
              "Fund participatory budgeting in every municipality, establish citizen assemblies, mandate open data for all government operations, and create community ombudsman offices",
            stance: "left",
            economic: -3,
            social: -5,
          },
          {
            name: "Regional Transparency Expansion Act",
            explanation:
              "Significantly expand public participation mechanisms, fund community engagement programs, and strengthen local government transparency requirements",
            stance: "left",
            economic: -2,
            social: -3,
          },
          {
            name: "Governance Enhancement Act",
            explanation:
              "Modestly increase funding for public consultation processes, local government websites, and community feedback mechanisms",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Regional Governance Framework Act",
            explanation:
              "A moderate level of governance funding supporting basic transparency requirements, public meetings, and administrative oversight",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Governance Efficiency Act",
            explanation:
              "Reduce governance spending through administrative streamlining, consolidated public meetings, and digital-first citizen engagement",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Minimal Governance Act",
            explanation:
              "Cut governance spending to mandatory disclosure requirements only, eliminating participatory programs and public engagement initiatives",
            stance: "right",
            economic: 2,
            social: 3,
          },
          {
            name: "Governance Spending Withdrawal Act",
            explanation:
              "Eliminate all discretionary governance spending, limiting prefectural administration to basic statutory functions",
            stance: "right",
            economic: 3,
            social: 5,
          },
        ],
        "both"
      ),
      [8000, 6000, 4000, 2500, 1500, 700, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  FOREIGN POLICY (2 — all national)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B11.1. Foreign Aid and Diplomacy ─────────────────────────────────────
  {
    _id: "jp_foreign_aid_diplomacy",
    countryScope: "jp",
    name: "Foreign Aid and Diplomacy Act",
    description:
      "Japan's ODA (Official Development Assistance) and diplomatic engagement — Japan is historically one of the world's largest aid donors, with a focus on Asia-Pacific development.",
    policyDomain: "foreign_policy",
    budgetCategory: "foreign_policy",
    subCategory: "Foreign aid and diplomacy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "publicTrust",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "social", metric: "foreignWorkerIntegration", weight: 0.2 },
      { category: "economic", metric: "gdpGrowth", weight: -0.1 },
    ]),
    positions: standardJPCommitteePositions("Foreign Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_foreign_aid_diplomacy",
        [
          {
            name: "Maximum Global Engagement Act",
            explanation:
              "Dramatically increase ODA to lead global development, expand embassy networks worldwide, fund multilateral peacekeeping contributions, and establish Japan as the premier diplomatic voice in Asia",
            stance: "left",
            economic: -5,
            social: -5,
          },
          {
            name: "Diplomatic Leadership Act",
            explanation:
              "Significantly increase foreign aid budgets, expand JICA operations, strengthen multilateral institution contributions, and fund climate adaptation aid for developing nations",
            stance: "left",
            economic: -3,
            social: -3,
          },
          {
            name: "Aid and Diplomacy Enhancement Act",
            explanation:
              "Modestly increase ODA focused on Asia-Pacific development, expand cultural diplomacy programs, and strengthen bilateral aid relationships",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Foreign Affairs Framework Act",
            explanation:
              "A moderate level of foreign aid and diplomatic engagement supporting existing JICA programs, embassy operations, and multilateral contributions",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Strategic Aid Reform Act",
            explanation:
              "Reduce ODA to strategically significant recipients only, consolidate embassy operations, and tie aid more tightly to trade and security interests",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Aid Reduction Act",
            explanation:
              "Substantially cut foreign aid budgets, close underperforming embassy offices, and redirect diplomatic spending toward trade negotiation capacity",
            stance: "right",
            economic: 3,
            social: 3,
          },
          {
            name: "Foreign Aid Elimination Act",
            explanation:
              "Eliminate ODA entirely, close non-essential embassies, and redirect all foreign affairs spending toward domestic priorities",
            stance: "right",
            economic: 5,
            social: 5,
          },
        ],
        "both"
      ),
      [28000, 20000, 14000, 10000, 6000, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B11.2. Trade Agreements ───────────────────────────────────────────────
  {
    _id: "jp_trade_agreements",
    countryScope: "jp",
    name: "Trade Agreements and Economic Partnership Act",
    description:
      "Japan's trade policy framework — CPTPP, RCEP, bilateral EPAs, and the broader approach to free trade vs. protectionism. Separate from tariff rates — this is about the diplomatic framework.",
    policyDomain: "foreign_policy",
    budgetCategory: "foreign_policy",
    subCategory: "Trade agreements",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      { category: "economic", metric: "foodSecurity", weight: -0.3 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.2 },
      { category: "social", metric: "foreignWorkerIntegration", weight: 0.2 },
    ]),
    positions: standardJPCommitteePositions("Foreign Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_trade_agreements",
        [
          {
            name: "Maximum Free Trade Act",
            explanation:
              "Pursue free trade agreements with every willing partner, eliminate all non-tariff barriers, harmonize regulations with trading partners, and fund trade adjustment assistance for affected industries",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Trade Liberalization Act",
            explanation:
              "Significantly expand trade agreement coverage, reduce non-tariff barriers, and fund export promotion programs for SMEs and agricultural products",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Trade Partnership Enhancement Act",
            explanation:
              "Modestly expand bilateral trade agreements, reduce regulatory barriers in key sectors, and fund trade facilitation infrastructure",
            stance: "left",
            economic: -1,
            social: 0,
          },
          {
            name: "Trade Policy Framework Act",
            explanation:
              "A moderate approach supporting existing trade agreements while carefully evaluating new partnerships and protecting sensitive sectors",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Strategic Trade Act",
            explanation:
              "Prioritize trade agreements with security allies only, keep protections for sensitive industries, and require reciprocity in all trade relationships",
            stance: "right",
            economic: 1,
            social: 0,
          },
          {
            name: "Trade Skepticism Act",
            explanation:
              "Pause new trade agreement negotiations, review existing commitments for renegotiation, and strengthen domestic industry protections",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Trade Agreement Withdrawal Act",
            explanation:
              "Withdraw from multilateral trade agreements, reject new trade partnerships, and pursue full economic self-reliance",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "both"
      ),
      [3000, 2200, 1500, 1000, 600, 300, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  TECHNOLOGY & INNOVATION (3 — all national)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B12.1. Robotics and AI Policy ────────────────────────────────────────
  {
    _id: "jp_robotics_ai",
    countryScope: "jp",
    name: "Robotics and Artificial Intelligence Policy Act",
    description:
      "Japan's robotics leadership and the growing AI debate — regulation vs. promotion, automation in eldercare and agriculture, workforce displacement, and ethical AI frameworks.",
    policyDomain: "technology",
    budgetCategory: "technology",
    subCategory: "Robotics and AI",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "roboticsAdoption",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "roboticsAdoption" }, [
      { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      { category: "healthcare", metric: "elderCareQuality", weight: 0.3 },
      { category: "economic", metric: "gdpGrowth", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.1 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_robotics_ai",
        [
          {
            name: "Comprehensive AI Governance Act",
            explanation:
              "Establish strict AI regulation, mandate algorithmic transparency, create a national AI ethics board, fund AI safety research, and guarantee retraining programs for workers displaced by automation",
            stance: "left",
            economic: -3,
            social: -5,
          },
          {
            name: "Responsible AI Development Act",
            explanation:
              "Significantly strengthen AI oversight, require impact assessments for high-risk AI systems, fund robotics ethics research, and expand workforce retraining programs",
            stance: "left",
            economic: -2,
            social: -3,
          },
          {
            name: "AI and Robotics Enhancement Act",
            explanation:
              "Modestly increase funding for AI safety standards, support responsible robotics deployment in eldercare and agriculture, and fund digital skills education",
            stance: "left",
            economic: -1,
            social: -1,
          },
          {
            name: "Technology Policy Framework Act",
            explanation:
              "A moderate approach balancing AI innovation promotion with basic safety standards and workforce transition support",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Innovation Acceleration Act",
            explanation:
              "Reduce AI regulation to promote rapid deployment, fund robotics commercialization programs, and incentivize corporate AI research investment",
            stance: "right",
            economic: 1,
            social: 1,
          },
          {
            name: "Technology Deregulation Act",
            explanation:
              "Substantially reduce AI oversight, eliminate mandatory impact assessments, and let industry self-regulate robotics and automation deployment",
            stance: "right",
            economic: 2,
            social: 3,
          },
          {
            name: "Full Technology Liberalization Act",
            explanation:
              "Eliminate all AI and robotics regulation, leaving development, deployment, and workforce impact management entirely to the private sector",
            stance: "right",
            economic: 3,
            social: 5,
          },
        ],
        "both"
      ),
      [6000, 4500, 3200, 2200, 1400, 600, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B12.2. National R&D Investment ───────────────────────────────────────
  {
    _id: "jp_rd_investment",
    countryScope: "jp",
    name: "National R&D Investment Strategy Act",
    description:
      "Government R&D investment strategy — applied research, technology commercialization, innovation hubs, and public-private research partnerships. Distinct from basic science/JSPS/JAXA funding.",
    policyDomain: "technology",
    budgetCategory: "technology",
    subCategory: "R&D investment",
    nationalOnly: true,
    // RETARGET (Spec B, ex-Spec A): R&D funding drives R&D intensity (the TFP
    // input), not roboticsAdoption (a windowed 1980 downstream proxy).
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "rdIntensity",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "rdIntensity" }, [
      { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.1 },
    ]),
    positions: standardJPCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_rd_investment",
        [
          {
            name: "Maximum Innovation Investment Act",
            explanation:
              "Fund a national network of innovation hubs in every region, provide massive R&D tax credits, establish government venture capital funds, and guarantee research positions for all STEM graduates",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Innovation Expansion Act",
            explanation:
              "Significantly increase applied R&D funding, expand public-private research partnerships, and fund technology transfer programs from universities to industry",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "R&D Enhancement Act",
            explanation:
              "Modestly increase government R&D spending on applied technology, startup incubation programs, and industry-university collaboration incentives",
            stance: "left",
            economic: -1,
            social: 0,
          },
          {
            name: "R&D Investment Framework Act",
            explanation:
              "A moderate level of government R&D investment supporting technology commercialization, basic innovation infrastructure, and targeted sector partnerships",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Market-Led Innovation Act",
            explanation:
              "Reduce direct government R&D spending, relying on enhanced R&D tax credits and corporate investment to drive applied research",
            stance: "right",
            economic: 1,
            social: 0,
          },
          {
            name: "Minimal R&D Support Act",
            explanation:
              "Cut government applied R&D to critical national priorities only, leaving technology development to corporate research budgets",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "R&D Spending Elimination Act",
            explanation:
              "Eliminate all government applied R&D programs, leaving innovation investment entirely to the private sector",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "both"
      ),
      [18000, 14000, 12000, 10000, 6000, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B12.3. Digital Governance ─────────────────────────────────────────────
  {
    _id: "jp_digital_governance",
    countryScope: "jp",
    name: "Digital Governance and e-Government Act",
    description:
      "Government digitization — the Digital Agency's mission to modernize Japan's famously paper-heavy bureaucracy. My Number system, digital IDs, paperless administration, and government data platforms.",
    policyDomain: "technology",
    budgetCategory: "technology",
    subCategory: "Digital governance",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "broadbandAccess" },
      [
        { category: "governance", metric: "governmentTransparency", weight: 0.3 },
        { category: "governance", metric: "publicTrust", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_digital_governance",
        [
          {
            name: "Complete Digital Government Act",
            explanation:
              "Mandate fully paperless government by a fixed date, digitize all citizen interactions, establish a universal digital identity system, and fund digital literacy programs for all demographics",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Digital Government Acceleration Act",
            explanation:
              "Significantly expand the Digital Agency's mandate, fund rapid digitization of all major government services, and establish nationwide digital access points",
            stance: "left",
            economic: 0,
            social: -2,
          },
          {
            name: "e-Government Enhancement Act",
            explanation:
              "Modestly increase digitization funding for priority government services, expand My Number system integration, and improve government website accessibility",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Digital Governance Framework Act",
            explanation:
              "A moderate level of e-government investment supporting gradual service digitization and Digital Agency operations",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Digitization Act",
            explanation:
              "Reduce e-government spending to high-impact services only, allowing continued paper processes where digital adoption is low",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Minimal Digitization Act",
            explanation:
              "Cut Digital Agency funding to essential systems maintenance, pausing new digitization initiatives and allowing paper-based alternatives to continue",
            stance: "right",
            economic: 0,
            social: 2,
          },
          {
            name: "Digital Agency Elimination Act",
            explanation:
              "Abolish the Digital Agency, halt mandatory digitization, and let individual ministries manage their own technology at their own pace",
            stance: "right",
            economic: 0,
            social: 3,
          },
        ],
        "social"
      ),
      [8000, 6000, 5000, 3800, 2200, 900, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═════════════════════════════════════════════════════════════════════════════
  //  LAW & JUSTICE (3 — 2 national + 1 regional)
  // ═════════════════════════════════════════════════════════════════════════════

  // ── B13.1. Policing and Public Safety ────────────────────────────────────
  {
    _id: "jp_policing_public_safety",
    countryScope: "jp",
    name: "Policing and Public Safety Act",
    description:
      "Police funding, the koban (police box) neighborhood system, surveillance infrastructure, organized crime enforcement, and the balance between public safety and civil liberties.",
    policyDomain: "law_justice",
    budgetCategory: "publicSafety",
    subCategory: "Policing",
    nationalOnly: true,
    // §4.7 (P3b): pure police FUNDING law — crime is engine-derived from the
    // publicSafety spending channel (police capacity → crime), so the direct
    // crimeRate target double-counted. The koban community-policing doctrine
    // keeps its cohesion mechanism; the civil-liberties tension keeps the
    // mentalHealthAccess secondary.
    effectTarget: {
      metricCategoryId: "social",
      metricId: "socialCohesion",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "healthcare", metricId: "mentalHealthAccess", weight: -0.1 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_policing_public_safety",
        [
          {
            name: "Maximum Public Safety Investment Act",
            explanation:
              "Massively expand police recruitment, deploy comprehensive surveillance networks, fund a koban in every neighborhood, and establish dedicated units for cybercrime, organized crime, and domestic violence",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Public Safety Expansion Act",
            explanation:
              "Significantly increase police budgets to hire more officers, modernize forensic capabilities, expand koban coverage, and fund victim support services",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Public Safety Enhancement Act",
            explanation:
              "Modestly increase policing funding for community outreach, koban maintenance, cybercrime investigation, and officer training programs",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Public Safety Framework Act",
            explanation:
              "A moderate level of police funding supporting existing operations, koban staffing, basic forensic capability, and community policing programs",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Policing Efficiency Act",
            explanation:
              "Reduce police budgets through technology-driven efficiency, consolidating koban locations, and focusing resources on high-crime areas only",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Minimal Policing Act",
            explanation:
              "Substantially cut police funding, closing underused koban, reducing officer numbers, and relying on community self-policing and private security",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Policing Reduction Act",
            explanation:
              "Reduce policing to essential emergency response and serious crime investigation only, eliminating community policing and preventive programs",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "social"
      ),
      [10000, 7500, 5500, 4000, 2500, 1200, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B13.2. Criminal Justice and Rehabilitation ────────────────────────────
  {
    _id: "jp_criminal_justice",
    countryScope: "jp",
    name: "Criminal Justice and Rehabilitation Act",
    description:
      "Prison system reform, rehabilitation vs. punishment, the death penalty debate, juvenile justice, and reintegration programs. Japan faces criticism over harsh detention conditions and the daiyo kangoku (substitute prison) system.",
    policyDomain: "law_justice",
    budgetCategory: "publicSafety",
    subCategory: "Criminal justice",
    nationalOnly: true,
    // §4.7 (P3b): KEEP-LISTED justice-STRUCTURE mechanism (rehabilitation vs
    // punishment, death penalty, daiyo kangoku) — the channel can't express a
    // sentencing regime. Primary re-pointed crimeRate → incarcerationRate (the
    // structure's actual subject; crime is channel/engine-derived).
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "incarcerationRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "incarcerationRate" },
      [
        { category: "social", metric: "socialCohesion", weight: 0.5 },
        { category: "healthcare", metric: "mentalHealthAccess", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_criminal_justice",
        [
          {
            name: "Comprehensive Justice Reform Act",
            explanation:
              "Abolish the death penalty, end the daiyo kangoku system, mandate rehabilitation-focused sentencing, fund universal reintegration programs, and establish independent prison oversight",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Rehabilitation Investment Act",
            explanation:
              "Significantly expand prison rehabilitation programs, fund job training and education for inmates, strengthen juvenile diversion programs, and improve detention conditions",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Justice Enhancement Act",
            explanation:
              "Modestly increase funding for prisoner education, expand parole support services, and strengthen mental health treatment in detention facilities",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Criminal Justice Framework Act",
            explanation:
              "A moderate approach balancing punishment with rehabilitation, supporting basic reintegration programs and upholding existing detention standards",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Public Safety Priority Act",
            explanation:
              "Strengthen sentencing guidelines, expand detention capacity, and reduce early release programs in favor of longer incarceration for repeat offenders",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Strict Justice Act",
            explanation:
              "Substantially increase criminal penalties, expand the scope of the death penalty, streamline prosecution processes, and reduce rehabilitation spending",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Maximum Deterrence Act",
            explanation:
              "Impose the harshest possible criminal penalties, expand death penalty application, minimize rehabilitation programs, and prioritize incarceration over reintegration",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "social"
      ),
      [16000, 12000, 9000, 6400, 4200, 2000, 1000]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── B13.3. Regional Policing ──────────────────────────────────────────────
  {
    _id: "jp_regional_policing",
    countryScope: "jp",
    name: "Regional Policing Act",
    description:
      "Prefectural police funding — community safety programs, local koban staffing, traffic enforcement, and crime prevention initiatives funded from the regional budget.",
    policyDomain: "law_justice",
    budgetCategory: "publicSafety",
    subCategory: "Regional policing",
    nationalOnly: false,
    // §4.7 (P3b): pure prefectural police FUNDING law — crime is engine-derived
    // from the publicSafety spending channel, so the direct crimeRate target
    // double-counted. Community-safety/koban-staffing mechanisms remain.
    effectTarget: {
      metricCategoryId: "social",
      metricId: "socialCohesion",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.2 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.1 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_regional_policing",
        [
          {
            name: "Maximum Regional Policing Act",
            explanation:
              "Fund a koban in every neighborhood, establish community safety patrols in all districts, deploy comprehensive local surveillance, and guarantee rapid emergency response across the entire prefecture",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Regional Policing Expansion Act",
            explanation:
              "Significantly expand prefectural police staffing, fund community safety centers, and invest in local crime prevention technology and victim support services",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Community Safety Investment Act",
            explanation:
              "Modestly increase regional policing spending on koban maintenance, neighborhood watch programs, and traffic safety infrastructure",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Regional Policing Framework Act",
            explanation:
              "A moderate level of prefectural police funding supporting basic koban operations, community liaison officers, and local crime prevention",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Policing Services Efficiency Act",
            explanation:
              "Reduce prefectural police spending through koban consolidation, technology-driven patrol optimization, and focusing on high-priority areas only",
            stance: "right",
            economic: 0,
            social: 1,
          },
          {
            name: "Minimal Regional Policing Act",
            explanation:
              "Cut prefectural police funding to essential emergency response and serious crime investigation, closing most koban and community programs",
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Regional Policing Withdrawal Act",
            explanation:
              "Eliminate prefectural police discretionary spending, relying entirely on national police agency funding and community volunteers for local safety",
            stance: "right",
            economic: 0,
            social: 5,
          },
        ],
        "social"
      ),
      [16000, 13000, 11000, 8500, 5500, 2500, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── P6a: Recruitment / National Service (militaryReadiness + conscription axis home) ──
  {
    _id: "jp_jsdf_recruitment",
    countryScope: "jp",
    name: "JSDF Recruitment and Service Act",
    description:
      "Self-Defense Forces recruitment amid demographic decline - within the Article 9 framework",
    policyDomain: "defense",
    subCategory: "Recruitment / service model",
    budgetCategory: "defense",
    nationalOnly: true,
    // §4.7 KEEP (countryIndicesSweep): the SERVICE MODEL (volunteer vs
    // conscription) is manpower STRUCTURE the defense spending channel cannot
    // express; compulsion trades civilLiberties for readiness/pride.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "militaryReadiness",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "militaryReadiness" },
      [
        { category: "governance", metric: "nationalPride", weight: 0.4 },
        { category: "governance", metric: "civilLiberties", weight: -0.4 },
        { category: "economic", metric: "smallBusinessFormation", weight: 0.1 },
      ]
    ),
    positions: standardJPCommitteePositions("Security"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_jsdf_recruitment",
        [
          { name: "Minimal Self-Defense Act", stance: "left", effectDirection: -1 },
          { name: "Volunteer JSDF Act", stance: "left", effectDirection: -1 },
          { name: "Professional Forces Act", stance: "left", effectDirection: -1 },
          { name: "Recruitment Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Recruitment Incentive Expansion Act", stance: "right", effectDirection: 1 },
          { name: "National Service Framework Act", stance: "right", effectDirection: 1 },
          { name: "Universal Service Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Reduce the JSDF to a minimal defensive establishment with a strict Article 9 reading",
          "Maintain volunteer recruitment with improved pay against private-sector competition",
          "Professionalize with technical specialist tracks and extended service contracts",
          "Continue current recruitment campaigns adjusted for the shrinking cohort",
          "Expand recruitment incentives, reserve programs, and university partnerships substantially",
          "Establish a national service framework with civil-protection and defense tracks",
          "Institute universal service obligations - a constitutional confrontation with Article 9",
        ][i],
      })),
      [3, 6, 10, 15, 25, 40, 58]
    ),
    source: "seed",
    isPermanent: true,
  },
  // ── P6a: media/press wiring home (pressFreedom + stateMediaControl) ──
  {
    _id: "jp_media_press",
    countryScope: "jp",
    name: "Media and Press Freedom Act",
    description:
      "Press club (_kisha kurabu_) reform, NHK governance, broadcast neutrality rules, and journalist access",
    policyDomain: "mediaInformation",
    subCategory: "Media / press",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "mediaInformation", metric: "pressFreedom" },
      [
        // negative weight: a press-restrictive direction raises state control.
        { category: "mediaInformation", metric: "stateMediaControl", weight: -0.5 },
        { category: "governance", metric: "governmentTransparency", weight: 0.3 },
      ]
    ),
    positions: standardJPCommitteePositions("Internal Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "jp_media_press",
        [
          { name: "Press Freedom Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Press Club Reform Act", stance: "left", effectDirection: 1 },
          { name: "NHK Independence Act", stance: "left", effectDirection: 1 },
          { name: "Broadcast Framework Act", stance: "center", effectDirection: 0 },
          { name: "Broadcast Neutrality Enforcement Act", stance: "right", effectDirection: -1 },
          { name: "Media Standards Authority Act", stance: "right", effectDirection: -1 },
          { name: "State Broadcasting Direction Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish press club access restrictions, protect sources absolutely, and bar political interference in licensing",
          "Open the kisha kurabu system to independent and foreign journalists with statutory access rights",
          "Insulate NHK governance from political appointment and end broadcast license intimidation",
          "Maintain the broadcast law framework with the existing neutrality doctrine",
          "Enforce broadcast political-neutrality rules with license review powers",
          "Establish a media standards authority with sanction powers over editorial balance",
          "Direct state oversight of broadcast content with political compliance review",
        ][i],
      })),
      [3, 2, 2, 1, 1, 1, 1]
    ),
    source: "seed",
    isPermanent: true,
  },
];
