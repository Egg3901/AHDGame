import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withPerCapitaCosts,
} from "../reference/policyOptionHelpers";

function npcCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "npc_chair",
      name: `Chair, NPC Committee on ${domainLabel}`,
      chamber: "npc",
    },
    {
      positionId: "npc_vice",
      name: `Vice-Chair, NPC Committee on ${domainLabel}`,
      chamber: "npc",
    },
  ];
}

function peoplesCongressCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "pc_chair",
      name: `Chair, People's Congress Committee on ${domainLabel}`,
      chamber: "peoplesCongress",
    },
    {
      positionId: "pc_vice",
      name: `Vice-Chair, People's Congress Committee on ${domainLabel}`,
      chamber: "peoplesCongress",
    },
  ];
}

export const cnLegislationTypes: LegislationType[] = [
  // ── Enterprise Income Tax (企业所得税) — 11-bracket headline corporate-tax rate ───────
  {
    _id: "cn_enterprise_income_tax",
    countryScope: "cn",
    name: "Statutory Enterprise Income Tax Law",
    description: "Sets the headline enterprise income tax rate on corporate profits",
    explanation:
      "China's statutory enterprise income tax (EIT) rate is 25%. Preferential 15% rates apply to high-tech enterprises (HTEs) and Western development regions. A reduced 5% rate applies to small low-profit enterprises on the first ¥3M of taxable income. This law sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("cn_enterprise_income_tax", [
      {
        rate: 0,
        name: "Enterprise Income Tax Abolition Law",
        description:
          "_企业所得税废止法_ — Abolish EIT entirely, replacing all corporate revenue with VAT and Customs receipts to maximize private-sector capital formation",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Universal Small-Business Preferential Law",
        description:
          "_普惠性小企业优惠法_ — Extend the 5% preferential rate to all enterprises regardless of size, treating EIT as a token revenue line",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "High-Tech Enterprise Unified Rate Law",
        description:
          "_高新技术企业统一法_ — Set the headline rate to the 15% HTE preferential rate for all enterprises",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Western Development Unified Rate Law",
        description:
          "_西部开发统一标准法_ — Adopt the 15% Western Development zone rate as the national headline rate to incentivize private capital",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 20,
        name: "Small and Medium Enterprise Relief Law",
        description:
          "_中小企业减负法_ — Cut the EIT to 20% to support SME formation and shrink the formal-informal economy gap",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "Statutory Enterprise Income Tax Law",
        description:
          "_企业所得税基本法_ — The statutory EIT rate paired with retained HTE / Western Development preferences",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 28,
        name: "Strategic Industry Profit Recapture Law",
        description:
          "_战略产业利润回收法_ — Modestly raise EIT to claw back outsized profits from state-designated strategic industries",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 32,
        name: "Common Prosperity Corporate Contribution Law",
        description:
          "_共同富裕企业贡献法_ — Raise EIT to fund 共同富裕 (Common Prosperity) redistribution programs and rural revitalization",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 35,
        name: "Windfall Profit Tax Law",
        description:
          "_暴利所得税法_ — A windfall tax targeting excess profits in real-estate, internet platforms, and finance",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 38,
        name: "Capital Return Limitation Law",
        description:
          "_资本回报限制法_ — Near-punitive EIT extracting capital from corporate retained earnings into public investment",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Enterprise Extraction Law",
        description:
          "_最大企业征收法_ — The highest peacetime EIT, designed to fund a comprehensive socialist welfare state",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Individual Income Tax (个人所得税) — 11-bracket top-bracket rate ──────────────────
  {
    _id: "cn_individual_income_tax",
    countryScope: "cn",
    name: "Statutory Individual Income Tax Law",
    description: "Sets the top-bracket personal income tax rate",
    explanation:
      "China's statutory IIT top-bracket rate is 45%, with progressive brackets running from 3% to 45%. Most income falls in lower brackets — effective rate on median earners is ~10%. This law sets the headline top-bracket rate.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("cn_individual_income_tax", [
      {
        rate: 0,
        name: "Individual Income Tax Abolition Law",
        description:
          "_个人所得税废止法_ — Eliminate IIT entirely, funding household-relevant services through VAT alone",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 10,
        name: "Flat-Tax Modernization Law",
        description: "_单一税率现代化法_ — A radical low flat IIT replacing progressive brackets",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 15,
        name: "High-Income Threshold Liberalization Law",
        description:
          "_高收入门槛自由化法_ — Cut top-bracket rate sharply and raise the high-income threshold",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 25,
        name: "Middle-Class Relief Law",
        description:
          "_中产阶级减负法_ — Substantial cut to top-bracket rate, easing burden on coastal urban professionals",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 30,
        name: "Tax Reform Modernization Law",
        description:
          "_税制改革现代化法_ — Modest reduction with broader brackets aligned to OECD norms",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 35,
        name: "Statutory Individual Income Tax Law",
        description:
          "_个人所得税基本法_ — The statutory top-bracket rate at the canonical baseline",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 40,
        name: "Wealth Recapture Law",
        description:
          "_财富回收法_ — Modest above-statutory rate funding 共同富裕 (Common Prosperity) social investment",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 45,
        name: "High-Earner Contribution Law",
        description:
          "_高收入贡献法_ — Top-bracket rate at the long-standing statutory maximum, captures coastal wealth concentration",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 47,
        name: "Common Prosperity Income Law",
        description:
          "_共同富裕收入法_ — Above-statutory rate explicitly funding 共同富裕 (Common Prosperity) rural revitalization",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 48,
        name: "Wealth Redistribution Law",
        description:
          "_财富再分配法_ — Near-historic top-bracket rate aggressively reducing post-tax inequality",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Redistribution Law",
        description:
          "_最大再分配法_ — The highest peacetime IIT top-bracket rate, designed to fund a Nordic-scale welfare state in a Chinese socialist framework",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Value-Added Tax (增值税) — 11-bracket headline VAT rate ───────────────────────────
  {
    _id: "cn_value_added_tax",
    countryScope: "cn",
    name: "Statutory Value-Added Tax Law",
    description: "Sets the headline value-added tax rate",
    explanation:
      "VAT (增值税) is China's largest single tax revenue line. Statutory 13% headline rate, 9% reduced rate on agriculture/transport, 6% on financial services. This law sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    // Consumption tax on an INVERTED axis (high rate = right): higher VAT must
    // RAISE cost of living and poverty, so both carry negative weights.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.25 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("cn_value_added_tax", [
      {
        rate: 0,
        name: "VAT Abolition Law",
        description:
          "_增值税废止法_ — Eliminate VAT entirely, restructuring federal revenue around income and corporate tax only",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 3,
        name: "Consumer Stimulus Maximum Law",
        description: "_消费刺激最大法_ — A token VAT dramatically reducing consumer cost of living",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 6,
        name: "Reduced Single-Rate Law",
        description:
          "_简化低税率法_ — Apply only the 6% reduced rate across all goods, abolishing higher brackets",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 9,
        name: "Agricultural Equivalence Law",
        description:
          "_农业平等税率法_ — Set the headline rate to the 9% reduced bracket, eliminating differential treatment",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 11,
        name: "Consumer Relief Law",
        description: "_消费者减负法_ — Below-statutory VAT to support household purchasing power",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 13,
        name: "Statutory VAT Law",
        description: "_增值税基本法_ — The statutory rate (13% headline, 9% reduced)",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "Revenue Consolidation Law",
        description:
          "_财政整合法_ — Modest increase to fund central-government 财政整合 (fiscal consolidation)",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 17,
        name: "Heightened Revenue VAT Law",
        description:
          "_增值税增收法_ — Raise VAT to an above-statutory level to support fiscal capacity",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 19,
        name: "European-Level VAT Law",
        description:
          "_欧洲水准增值税法_ — Anglo-Continental level VAT replacing portions of income tax",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 22,
        name: "Consumption-Shift Tax Law",
        description:
          "_消费转移税法_ — High VAT, sharply reduced income tax — shift toward consumption taxation",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum Consumption Tax Law",
        description:
          "_最大消费税法_ — Highest VAT, funding government primarily through consumption",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
  },

  // ── Land Value-Added Tax (土地增值税) — 11-bracket real-estate-gains rate ───────────
  {
    _id: "cn_land_value_added_tax",
    countryScope: "cn",
    name: "Statutory Land Value-Added Tax Law",
    description: "Sets the headline tax rate on capital gains from real-estate transactions",
    explanation:
      "LVAT (土地增值税) is China's capital-gains tax on real-estate transactions. Statutory progressive rate 30-60% on land-value appreciation. Politically central in 共同富裕 (Common Prosperity) and housing-affordability framing.",
    policyDomain: "tax",
    subCategory: "Real-estate taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingAffordability",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.5 },
      { metricCategoryId: "social", metricId: "wohnungsBauRate", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Land and Resources"),
    taxRateChange: { scope: "federal", taxType: "landValueAddedTax" },
    policyOptions: taxRateOptions("cn_land_value_added_tax", [
      {
        rate: 0,
        name: "Real Estate Liberalization Law",
        description:
          "_房地产自由化法_ — Eliminate LVAT entirely, ending fiscal restraint on real-estate development",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 10,
        name: "Construction Industry Relief Law",
        description:
          "_建筑业减负法_ — A token LVAT only on extreme speculation gains, unleashing development",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Property Market Reform Law",
        description:
          "_房地产市场改革法_ — Cut LVAT to a flat low rate, ending the progressive scale",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 25,
        name: "Below-Statutory Development Law",
        description:
          "_低标准开发法_ — Modest below-statutory LVAT supporting housing supply growth",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 30,
        name: "Statutory Lower-Bracket Law",
        description: "_基本最低档法_ — The statutory lower-bracket LVAT (30%) applied uniformly",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 40,
        name: "Statutory LVAT Law",
        description:
          "_土地增值税基本法_ — The statutory progressive-bracket midpoint applied to all transactions",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 50,
        name: "Property Speculation Disincentive Law",
        description:
          "_房产投机抑制法_ — Above-statutory LVAT specifically targeting speculative transactions",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 60,
        name: "Statutory Upper-Bracket Law",
        description: "_基本最高档法_ — Apply the statutory progressive top bracket (60%) uniformly",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 68,
        name: "Real Estate Cooling Law",
        description:
          "_房地产降温法_ — Sharp above-statutory LVAT cooling speculation and reining in property prices",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 75,
        name: "Common Prosperity Property Law",
        description:
          "_共同富裕房产法_ — Near-punitive LVAT explicitly funding 共同富裕 (Common Prosperity) affordable-housing programs",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 80,
        name: "Maximum Property Recapture Law",
        description:
          "_最大房产征收法_ — The highest LVAT, designed to redirect virtually all property speculation gains into public housing investment",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Urban Maintenance & Construction Tax (城市维护建设税) — 11-bracket urban-surcharge ─
  {
    _id: "cn_urban_maintenance_construction_tax",
    countryScope: "cn",
    name: "Statutory Urban Maintenance & Construction Tax Law",
    description: "Sets the surcharge rate on VAT funding municipal infrastructure",
    explanation:
      "UMCT (城市维护建设税) is a surcharge on VAT and Consumption Tax revenue, funding municipal infrastructure (urban roads, water/sewer, lighting). Real-world rate 7% urban / 5% county / 1% rural. This law sets the urban headline rate.",
    policyDomain: "tax",
    subCategory: "Urban surcharge",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "transportEfficiency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "transportEfficiency", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.2 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Urban Construction and Environment"),
    taxRateChange: { scope: "federal", taxType: "urbanMaintenanceTax" },
    policyOptions: taxRateOptions("cn_urban_maintenance_construction_tax", [
      {
        rate: 0,
        name: "UMCT Abolition Law",
        description:
          "_城建税废止法_ — Abolish UMCT entirely, leaving municipal infrastructure to be funded through general fiscal grants",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 1,
        name: "Symbolic Construction Surcharge Law",
        description:
          "_象征性建设附加法_ — A token UMCT preserving the legal instrument without significant revenue",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 2,
        name: "Rural-Level Construction Surcharge Law",
        description:
          "_农村级建设附加法_ — Apply the rural 1% rate everywhere, ending urban-rural differential",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 3,
        name: "County-Level Construction Surcharge Law",
        description: "_县级建设附加法_ — Reduce all rates to the 5% county-level baseline halved",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 5,
        name: "County Standard UMCT Law",
        description:
          "_县级标准城建税法_ — Apply the 5% county-level rate uniformly across urban and rural",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 7,
        name: "Statutory Urban UMCT Law",
        description:
          "_城建税基本法_ — The statutory 7% urban rate with retained rural / county differential",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 9,
        name: "Urban Infrastructure Investment Law",
        description:
          "_城市基建投资法_ — Modestly higher UMCT funding accelerated municipal infrastructure investment",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 11,
        name: "Smart City Infrastructure Law",
        description:
          "_智慧城市基建法_ — Above-statutory UMCT funding smart-city deployment in Tier-1 and Tier-2 cities",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 12,
        name: "Megacity Investment Law",
        description:
          "_特大城市投资法_ — Substantially higher UMCT funding subway, water-treatment, and 5G infrastructure",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 14,
        name: "Urban Modernization Maximum Law",
        description:
          "_城市现代化最大法_ — Near-maximum UMCT funding comprehensive urban-rural infrastructure equalization",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 15,
        name: "Maximum Urban Maintenance Law",
        description:
          "_最大城建税法_ — The highest UMCT rate, designed to fully fund comprehensive Chinese urban modernization",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Stamp Duty (印花税) — 11-bracket documented-transaction levy ──────────────────────
  {
    _id: "cn_stamp_duty",
    countryScope: "cn",
    name: "Statutory Stamp Duty Law",
    description: "Sets the documented-transaction tax rate on contracts and securities trades",
    explanation:
      "Stamp Duty (印花税) is a small-rate tax on documented transactions (securities trades, contracts, property transfers). Statutory 0.05% on most transactions, 0.1% on securities. This law sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Documented-transaction levy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      // A lower transaction tax (right) eases business formation, so a higher
      // stamp duty must SUPPRESS it: positive weight (matches ie_stamp_duty).
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.2 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    taxRateChange: { scope: "federal", taxType: "stampDuty" },
    policyOptions: taxRateOptions("cn_stamp_duty", [
      {
        rate: 0,
        name: "Stamp Duty Abolition Law",
        description: "_印花税废止法_ — Abolish Stamp Duty entirely, removing transaction friction",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 0.01,
        name: "Token Documentation Levy Law",
        description: "_象征性印花税法_ — A near-zero rate preserving the legal instrument",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 0.02,
        name: "Securities Liberalization Law",
        description:
          "_证券自由化法_ — Sharply reduced Stamp Duty on securities trades to boost capital-market liquidity",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 0.03,
        name: "Below-Standard Stamp Law",
        description:
          "_低标准印花税法_ — Modest below-statutory rate supporting financial-market activity",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 0.04,
        name: "Minimal Standard Stamp Law",
        description: "_最低标准印花税法_ — Slight below-statutory rate easing transaction costs",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 0.05,
        name: "Statutory Stamp Duty Law",
        description: "_印花税基本法_ — The statutory documented-transaction rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 0.1,
        name: "Securities Trade Surcharge Law",
        description:
          "_证券交易附加税法_ — Apply the historical 0.1% securities-trade rate across all documented transactions",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 0.3,
        name: "Speculative Trading Limitation Law",
        description:
          "_投机交易限制法_ — Above-statutory rate targeting high-frequency and speculative securities activity",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 0.5,
        name: "Capital Market Cooling Law",
        description:
          "_资本市场降温法_ — Substantially higher rate cooling overheated capital markets",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 1,
        name: "Financial Speculation Tax Law",
        description:
          "_金融投机税法_ — Near-Tobin-tax level Stamp Duty discouraging short-term capital activity",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 2,
        name: "Maximum Transaction Tax Law",
        description:
          "_最大交易税法_ — The highest Stamp Duty rate, designed to suppress speculative finance and redirect capital toward productive investment",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Social Insurance Contribution (社会保险) — 11-bracket combined-rate ──────────────
  {
    _id: "cn_social_insurance_contribution",
    countryScope: "cn",
    name: "Statutory Social Insurance Contribution Law",
    description: "Sets the combined employer + employee social-insurance contribution rate",
    explanation:
      "Social Insurance (社会保险) is the combined employer + employee contribution for the five-line social insurance system: pension (养老), medical (医疗), unemployment (失业), work-injury (工伤), maternity (生育). Statutory combined rate ~40% (employer ~28% + employee ~12%). This law sets the employer-side rate.",
    policyDomain: "tax",
    subCategory: "Payroll taxation",
    nationalOnly: true,
    // RETARGET considered + REVERTED (Spec B audit): pairs with cn_pension_system on
    // the structural rentenStabilitaet (name-only smell; no CN structural metric).
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "rentenStabilitaet",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "rentenStabilitaet", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.3 },
    ],
    positions: npcCommitteePositions("Social Affairs"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("cn_social_insurance_contribution", [
      {
        rate: 0,
        name: "Social Insurance Privatization Law",
        description:
          "_社会保险私有化法_ — Abolish compulsory social insurance entirely, privatizing pension/medical/unemployment funding",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Employer Relief Maximum Law",
        description:
          "_最大雇主减负法_ — A token social-insurance rate paired with private pension/medical accounts",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "SOE-Standard Privatization Law",
        description:
          "_国企标准私有化法_ — Cut combined employer-side rate sharply, shifting retirement and medical costs to individuals",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Wage Side-Cost Reduction Law",
        description:
          "_工资附加成本降低法_ — Significantly lowered Beitragssatz-equivalent to relieve employer hiring costs",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 22,
        name: "Employment Promotion Law",
        description: "_就业促进法_ — Below-statutory rates aimed at small-business hiring",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 28,
        name: "Statutory Social Insurance Law",
        description:
          "_社会保险基本法_ — Combined contributions matching the statutory employer + employee share",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 32,
        name: "Pension Stabilization Law",
        description:
          "_养老金稳定法_ — Higher contributions to shore up the national pension fund against demographic decline",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 36,
        name: "Universal Medical Insurance Expansion Law",
        description:
          "_普惠医保扩展法_ — Higher rates funding 医保 (medical insurance) coverage extension to rural and migrant populations",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 40,
        name: "Common Prosperity Social Insurance Law",
        description:
          "_共同富裕社保法_ — Substantially higher rates funding 共同富裕 (Common Prosperity) social-insurance expansion",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 43,
        name: "Scandinavian Social Model Law",
        description:
          "_北欧社会模式法_ — Near-Nordic combined contribution rate for full cradle-to-grave coverage",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 45,
        name: "Maximum Social Insurance Law",
        description:
          "_最大社会保险法_ — The highest combined contribution, funding a comprehensive socialist welfare state",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Customs Tariff (海关关税) — 11-bracket average-applied rate ───────────────────────
  {
    _id: "cn_customs_tariff",
    countryScope: "cn",
    name: "Statutory Customs Tariff Law",
    description: "Sets the average applied tariff rate on imports",
    explanation:
      "Customs Tariff (海关关税) is the duty on imports. WTO-bound at ~9.8% MFN. This law sets the average applied tariff position.",
    policyDomain: "tax",
    subCategory: "Trade taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "manufacturingCompetitiveness",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
    ],
    positions: npcCommitteePositions("Foreign Affairs and Trade"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("cn_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Maximum Law",
        description:
          "_自由贸易最大法_ — Eliminate all tariffs unilaterally, pursuing maximum trade openness",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 1,
        name: "Open Markets Law",
        description:
          "_开放市场法_ — Minimal revenue tariffs only, maximizing trade openness with token rate",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 2,
        name: "WTO-Plus Liberalization Law",
        description: "_世贸组织优于法_ — Tariffs below WTO MFN bindings to demonstrate openness",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 3,
        name: "Belt and Road Reciprocity Law",
        description:
          "_一带一路对等法_ — Tariffs calibrated to match partner rates under 一带一路 (Belt and Road) agreements",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 5,
        name: "Competitive Trade Law",
        description:
          "_竞争性贸易法_ — Below-MFN tariffs supporting Chinese exporter access to partner markets",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 7,
        name: "Statutory Customs Tariff Law",
        description: "_海关关税基本法_ — The statutory average tariff at WTO MFN-bound level",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 10,
        name: "Strategic Industry Protection Law",
        description:
          "_战略产业保护法_ — Elevated tariffs protecting key strategic industries (semiconductors, aerospace, automotive)",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 13,
        name: "Reshoring Priority Law",
        description:
          "_制造业回流法_ — Broad tariffs designed to reshore production from Southeast Asia and India",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 17,
        name: "Agricultural Self-Reliance Law",
        description:
          "_农业自给法_ — High tariffs on agricultural imports protecting domestic farmers under 粮食安全 (food security) framing",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 21,
        name: "Economic Sovereignty Law",
        description:
          "_经济主权法_ — Sweeping tariffs walling off domestic economy from global competition",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum Protectionism Law",
        description:
          "_最大保护主义法_ — The highest peacetime average tariff, designed to achieve near-total self-sufficiency",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
  },

  // ── Provincial Resource Tax (资源税) — 11-bracket regional extraction levy ────────────
  {
    _id: "cn_provincial_resource_tax",
    countryScope: "cn",
    name: "Provincial Resource Tax Law",
    description: "Sets the provincial-level ad-valorem rate on natural-resource extraction",
    explanation:
      "Resource Tax (资源税) is a provincial-level levy on extraction of minerals, oil/gas, coal, water, and salt. Statutory ad-valorem rate ~6%, ranging from 1-12% by resource type. This law sets the headline provincial rate.",
    policyDomain: "tax",
    subCategory: "Resource extraction",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
    ],
    positions: peoplesCongressCommitteePositions("Natural Resources"),
    taxRateChange: { scope: "state", taxType: "salesTax" },
    policyOptions: taxRateOptions("cn_provincial_resource_tax", [
      {
        rate: 0,
        name: "Resource Tax Abolition Law",
        description:
          "_资源税废止法_ — Eliminate Resource Tax entirely, removing extraction friction",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 1,
        name: "Symbolic Extraction Levy Law",
        description: "_象征性开采税法_ — A token rate preserving the legal instrument",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 2,
        name: "Mineral Industry Liberalization Law",
        description:
          "_矿业自由化法_ — Cut Resource Tax to coal-only minimum rate (~1.5%) for all resources",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 4,
        name: "Reduced Standard Rate Law",
        description:
          "_低标准统一税率法_ — Below-statutory Resource Tax supporting industrial-raw-material affordability",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 5,
        name: "Near-Statutory Resource Tax Law",
        description: "_近基本资源税法_ — Slight below-statutory rate easing energy-sector costs",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 6,
        name: "Statutory Resource Tax Law",
        description: "_资源税基本法_ — The statutory ad-valorem rate across mining, oil/gas, water",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 8,
        name: "Resource Conservation Law",
        description:
          "_资源节约法_ — Above-statutory rate funding provincial environmental remediation",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 10,
        name: "Dual Carbon Resource Law",
        description:
          "_双碳资源税法_ — Higher rate aligned with 双碳 (Dual Carbon) emissions-reduction commitments",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 12,
        name: "Resource Restraint Law",
        description:
          "_资源限制法_ — Substantially higher rate to discourage fossil and high-emission extraction",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 16,
        name: "Common Prosperity Resource Law",
        description:
          "_共同富裕资源法_ — Near-maximum rate, revenue routed to provincial 共同富裕 (Common Prosperity) redistribution",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 20,
        name: "Maximum Resource Extraction Tax Law",
        description:
          "_最大资源开采税法_ — The highest provincial Resource Tax, designed to fully internalize environmental costs of extraction",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §15 Healthcare (PR2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 15.1 cn_medical_insurance — Statutory Medical Insurance Law (基本医疗保险法) ─────
  {
    _id: "cn_medical_insurance",
    countryScope: "cn",
    name: "Statutory Medical Insurance Law",
    description: "Sets central funding levels for China's three-tier medical insurance system",
    explanation:
      "China runs a unified three-tier medical insurance covering urban employees (UEBMI), urban residents (URBMI), and rural residents (NRCMS, merged into URBMI in many provinces). Combined coverage reaches ~95% of the population but with significant copay gaps, deep provincial variation, and large urban-rural reimbursement-rate divergence. Reform debates center on 共同富裕 (Common Prosperity) expansion to migrant workers, equalization of urban-rural reimbursement, and 集采 (centralized drug procurement) to lower costs.",
    policyDomain: "healthcare",
    subCategory: "Health insurance",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "preventableMortality",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.6 },
      { metricCategoryId: "healthcare", metricId: "physicianRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Health and Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_medical_insurance",
        [
          {
            name: "Universal Free Healthcare Law",
            explanation:
              "_全民免费医疗法_ — Single-payer universal coverage with zero patient copays, fully funded by central transfers and 共同富裕 (Common Prosperity) redistribution. Eliminates the UEBMI/URBMI tiered structure.",
            stance: "left",
            economic: -5,
            social: -3,
          },
          {
            name: "Common Prosperity Medical Expansion Law",
            explanation:
              "_共同富裕医保扩展法_ — Equalize urban-rural reimbursement rates, extend full UEBMI benefits to migrant workers, expand 集采 (centralized drug procurement) to all chronic-disease drugs.",
            stance: "left",
            economic: -3,
            social: -2,
          },
          {
            name: "Migrant Worker Coverage Law",
            explanation:
              "_农民工医保法_ — Extend UEBMI-tier reimbursement to migrant workers without 户口 (Hukou) transfer, raise URBMI ceiling, add portable enrollment across provinces.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Medical Insurance Law",
            explanation:
              "_基本医疗保险法_ — Maintain the three-tier UEBMI/URBMI/NRCMS structure with incremental 集采 (centralized drug procurement) expansion and coverage growth.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Cost Containment Law",
            explanation:
              "_医保费用控制法_ — Tighter reimbursement caps, reduced 集采 (centralized drug procurement) catalogue, more individual savings-account responsibility within UEBMI.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Mixed Insurance Reform Law",
            explanation:
              "_混合保险改革法_ — Encourage commercial supplementary insurance to cover gaps, reduce state share of healthcare financing, expand HSA-style accounts.",
            stance: "right",
            economic: 3,
            social: 1,
          },
          {
            name: "Healthcare Privatization Law",
            explanation:
              "_医疗私有化法_ — Phase out compulsory medical insurance for higher earners, redirect funding to private market; preserve URBMI only for vulnerable populations.",
            stance: "right",
            economic: 5,
            social: 2,
          },
        ],
        "both"
      ),
      [6000, 4500, 3200, 1800, 900, 400, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 15.2 cn_elder_care — Statutory Elder Care Services Law (养老服务法) ───────────────
  {
    _id: "cn_elder_care",
    countryScope: "cn",
    name: "Statutory Elder Care Services Law",
    description: "Sets central funding for China's elder-care system under the 9073 framework",
    explanation:
      "China is aging rapidly under one-child demographic momentum, headed toward roughly a third of the population over 65 within a generation. Traditional family-based elder care is breaking down under urban migration. The 9073 framework (90% home / 7% community / 3% institutional) shapes delivery, and 长期护理保险 (long-term care insurance) is piloted in major cities. 共同富裕 (Common Prosperity) framing emphasizes universalization; conservative framing emphasizes 孝 (filial duty) restoration.",
    policyDomain: "healthcare",
    subCategory: "Elder care",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "elderCareQuality",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "elderCareQuality", weight: 1.0 },
      // Elder-care quality lifts the mortality driver (lifeExpectancy); old
      // demographicDecline readout removed (§4.7 sweep → §4.2/§4.6 driver).
      { metricCategoryId: "healthcare", metricId: "lifeExpectancy", weight: 0.3 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Health and Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_elder_care",
        [
          {
            name: "Universal Long-Term Care Insurance Law",
            explanation:
              "_全民长期护理保险法_ — Mandatory LTC insurance fully funded by central transfers, free state nursing-home places, cradle-to-grave 共同富裕 (Common Prosperity) elder support eliminating family-pay obligations.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Community Elder Care Expansion Law",
            explanation:
              "_社区养老扩展法_ — Public funding for 9073-model community elder-care centers, subsidized home aides, LTC insurance pilot expanded nationwide.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Migrant Worker Pension Bridge Law",
            explanation:
              "_农民工养老桥接法_ — Portable pension entitlements across provinces, eliminate 户口 (Hukou)-tied pension forfeiture, extend Rural Pension to migrant workers.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Elder Care Services Law",
            explanation:
              "_养老服务基本法_ — Maintain 9073 model with incremental LTC insurance pilots and subsidies for community elder-care centers in urban districts.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Family Responsibility Reinforcement Law",
            explanation:
              "_家庭责任强化法_ — Tax credits for multi-generational households, reduce state share of elder-care funding, reinforce 孝 (filial duty) framing in policy communications.",
            stance: "right",
            economic: 2,
            social: 2,
          },
          {
            name: "Private Elder Care Market Law",
            explanation:
              "_养老市场化法_ — Liberalize private nursing-home market, preferential tax treatment for elder-care REITs, voucher system for state-funded beds.",
            stance: "right",
            economic: 3,
            social: 1,
          },
          {
            name: "Family-Based Elder Care Restoration Law",
            explanation:
              "_家庭养老恢复法_ — Phase out state elder-care subsidies, restore 孝 (filial duty) obligation through tax incentives only, market-led nursing-home growth with no public subsidy.",
            stance: "right",
            economic: 5,
            social: 3,
          },
        ],
        "both"
      ),
      [2000, 1500, 1000, 600, 250, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 15.3 cn_mental_health — Statutory Mental Health Services Law (精神卫生服务法) ────
  {
    _id: "cn_mental_health",
    countryScope: "cn",
    name: "Statutory Mental Health Services Law",
    description: "Sets the framework for mental-health-services delivery and stigma policy",
    explanation:
      "Mental health was historically stigmatized and underfunded; the 精神卫生法 (Mental Health Law) established a framework but staffing remains thin (~2.6 psychiatrists per 100k vs OECD ~16). Youth depression rates and demand for school-based services have risen sharply under educational and graduate-employment pressures. Reform debates focus on 基层医疗 (primary care) integration vs specialist-hospital model, and on destigmatization vs behavioral-conformity framing.",
    policyDomain: "healthcare",
    subCategory: "Mental health",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "mentalHealthAccess",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "mentalHealthAccess", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: -0.3 },
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Health and Welfare"),
    policyOptions: policyOptions(
      "cn_mental_health",
      [
        {
          name: "Universal Mental Health Access Law",
          explanation:
            "_全民精神卫生法_ — Mental-health services free at point of use, primary-care psychiatric staffing in every township clinic, public destigmatization campaigns at scale.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "Youth Mental Health Expansion Law",
          explanation:
            "_青少年精神卫生扩展法_ — Mandatory school counselors, expanded youth services under 双减 (education burden reduction) framing, university mental-health centers fully funded under UEBMI.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Primary Care Integration Law",
          explanation:
            "_基层医疗精神卫生整合法_ — Embed mental-health screening into primary-care visits, expand psychiatrist training subsidies, integrate mental-health treatment with UEBMI reimbursement.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Mental Health Services Law",
          explanation:
            "_精神卫生服务基本法_ — Maintain specialist-hospital model with incremental primary-care integration and modest destigmatization campaigns.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Behavioral Conformity Framework Law",
          explanation:
            "_行为规范法_ — Frame mental health as behavioral compliance, expand 社会信用 (social credit) indicators to capture mental-health-related conduct, limit independent NGO mental-health services.",
          stance: "right",
          economic: 1,
          social: 3,
        },
        {
          name: "Family-First Mental Health Law",
          explanation:
            "_家庭优先精神卫生法_ — Emphasize family-based mental-health care, reduce state psychiatric-hospital subsidies, expand 中医 (traditional Chinese medicine) alternatives.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "Traditional Values Mental Health Law",
          explanation:
            "_传统价值观精神卫生法_ — Frame depression and anxiety as moral/cultural failings to be addressed through 思想政治 (ideological-political) education rather than clinical care.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 15.4 cn_public_health — Statutory Public Health Preparedness Law (公共卫生应急法) ─
  {
    _id: "cn_public_health",
    countryScope: "cn",
    name: "Statutory Public Health Preparedness Law",
    description: "Sets the framework for CDC capacity and public-health emergency response",
    explanation:
      "China has built out public-health infrastructure significantly — Chinese CDC funding, district-level fever clinics, contact-tracing capability, domestic vaccine production capacity. 健康中国 (Healthy China) and 公共卫生应急管理体系改革 (public-health emergency management reform) frame debates. Tensions exist between maintaining maximal state response capacity vs operating with a light-touch commercial-led model.",
    policyDomain: "healthcare",
    subCategory: "Public health",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Health and Welfare"),
    policyOptions: policyOptions(
      "cn_public_health",
      [
        {
          name: "Comprehensive Public Health State Law",
          explanation:
            "_综合公共卫生国家法_ — Permanent zero-tolerance epidemic-suppression capacity, fully-staffed fever clinics in every district, mandatory annual health screening, full Chinese CDC autonomy from market pressure.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Healthy China Expansion Law",
          explanation:
            "_健康中国扩展法_ — Accelerate Healthy China targets, expand CDC funding, strengthen contact-tracing infrastructure, fund domestic vaccine R&D pipelines.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Pandemic Preparedness Standing Law",
          explanation:
            "_大流行常备法_ — Maintain expanded fever-clinic network, vaccine stockpiles, and contact-tracing capability — but de-mobilize for non-emergency use.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Public Health Preparedness Law",
          explanation:
            "_公共卫生应急基本法_ — Maintain expanded CDC capacity with incremental Healthy China implementation.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Lean Public Health Law",
          explanation:
            "_精简公共卫生法_ — Wind down emergency-response infrastructure, shift to commercial vaccine procurement, reduce CDC field-staff funding.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Light-Touch Public Health Law",
          explanation:
            "_轻接触公共卫生法_ — Roll back state public-health funding to baseline levels, decommission contact-tracing infrastructure, return to commercial-led epidemic response.",
          stance: "right",
          economic: 3,
          social: -1,
        },
        {
          name: "Minimal Public Health Law",
          explanation:
            "_最低限度公共卫生法_ — Eliminate non-essential public-health functions, privatize fever clinics, hand epidemic response to commercial insurance + market mechanisms.",
          stance: "right",
          economic: 5,
          social: -2,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §16 Education (PR2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 16.1 cn_education_funding — Statutory Education Funding Law (教育经费法) ────────
  {
    _id: "cn_education_funding",
    countryScope: "cn",
    name: "Statutory Education Funding Law",
    description: "Sets central funding for compulsory and higher education programs",
    explanation:
      "China's education funding flows through a mix of central and provincial budgets, anchored by the 9-year 义务教育 (compulsory education) guarantee. Higher education has expanded massively but tuition costs and 高校扩招 (university expansion) tensions persist. Reform debates focus on equalizing rural-urban school resources, 双减 (education burden reduction) framing for compulsory education, and tuition affordability in 高校 (universities).",
    policyDomain: "education",
    subCategory: "Education funding",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    // §4.7 (P2a): workforceSkill/literacyRate secondaries dropped — this funding
    // law's education spend now drives them via the engine's spending channel.
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "educationSpending", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: npcCommitteePositions("Education, Science, and Technology"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_education_funding",
        [
          {
            name: "Universal Free Education Law",
            explanation:
              "_全民免费教育法_ — Free K-12 including private-school equivalent vouchers, universal free higher-education tuition for all 高校 (universities), full state funding of rural-urban resource equalization.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Common Prosperity Education Expansion Law",
            explanation:
              "_共同富裕教育扩展法_ — Substantially raise per-pupil compulsory-education funding, expand higher-education tuition subsidies, fully fund rural school teacher placement.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Rural School Equalization Law",
            explanation:
              "_乡村学校均等化法_ — Direct transfers to equalize rural-urban per-pupil spending, expand free meals and 寄宿制 (boarding) for rural schools.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Education Funding Law",
            explanation:
              "_教育经费基本法_ — Maintain the 9-year 义务教育 (compulsory education) guarantee with incremental rural-urban equalization and selective higher-ed tuition subsidies.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Subsidy Reform Law",
            explanation:
              "_定向补贴改革法_ — Replace blanket subsidies with means-tested tuition support, encourage private-school growth through vouchers.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Education Expansion Law",
            explanation:
              "_民办教育扩展法_ — Liberalize 民办 (private) school regulations, expand 教育产业 (education industry) market, reduce state share of higher-ed funding.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Education Privatization Law",
            explanation:
              "_教育私有化法_ — Phase out central education subsidies above the 9-year compulsory floor, route all higher ed through market financing, end rural-urban transfer programs.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [3500, 2800, 2000, 1200, 600, 250, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 16.2 cn_gaokao_reform — Statutory Gaokao Reform Law (高考改革法) ──────────────────
  {
    _id: "cn_gaokao_reform",
    countryScope: "cn",
    name: "Statutory Gaokao Reform Law",
    description: "Sets the framework for college admissions criteria and the 高考 (Gaokao) system",
    explanation:
      "The 高考 (Gaokao) college entrance exam dominates the K-12 education system, channeling students into 高校 (universities) through a single high-stakes test. Reform debates center on whether to maintain the 高考 as the primary admissions gateway, integrate 综合评价 (holistic assessment) factors, expand 自主招生 (independent admissions), or move toward a multi-pathway system. Sensitive to rural-urban equity and 减负 (burden reduction) considerations.",
    policyDomain: "education",
    subCategory: "Admissions reform",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "academicPressure",
      scope: "national",
    },
    // §4.7 (P2a): testPerformance secondary dropped — academicPressure (the
    // primary root) is now an ENGINE input to testPerformance, so the secondary
    // double-counted the exam-pressure mechanism via the root pass-through.
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "academicPressure", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "social", metricId: "hukouMobility", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: npcCommitteePositions("Education, Science, and Technology"),
    policyOptions: policyOptions(
      "cn_gaokao_reform",
      [
        {
          name: "Multi-Pathway Admissions Law",
          explanation:
            "_多元升学法_ — Abolish 高考 (Gaokao) as primary gateway, replace with multi-track admissions (vocational tracks, holistic assessment, talent-track programs), eliminate single-exam pressure.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "Comprehensive Evaluation Reform Law",
          explanation:
            "_综合评价改革法_ — Substantially weight 综合评价 (holistic assessment — community service, extracurriculars, portfolio) alongside 高考 (Gaokao) score in admissions.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Rural Admissions Equity Law",
          explanation:
            "_乡村招生公平法_ — Reserve admissions quotas for rural and 户口 (Hukou)-mismatch students, expand 国家专项 (national special) admission programs.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Gaokao Reform Law",
          explanation:
            "_高考改革基本法_ — Maintain 高考 (Gaokao) as primary admissions gateway with incremental 综合评价 (holistic assessment) weighting and 自主招生 (independent admissions) expansion.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Examination Discipline Reinforcement Law",
          explanation:
            "_考试纪律强化法_ — Tighten 高考 (Gaokao) administration, reduce 综合评价 (holistic assessment) weight, restore strict ranking-based admissions.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Single-Exam Restoration Law",
          explanation:
            "_单一考试恢复法_ — Eliminate alternative admissions tracks, restore the 高考 (Gaokao) as sole admissions criterion.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Pure Meritocratic Exam Law",
          explanation:
            "_纯粹应试录取法_ — 高考 (Gaokao) score as sole admissions criterion with no exceptions, abolish all 自主招生 (independent admissions) and rural quotas.",
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

  // ── 16.3 cn_academic_pressure_reform — Statutory Academic Pressure Reform Law (学业减负法) ─
  {
    _id: "cn_academic_pressure_reform",
    countryScope: "cn",
    name: "Statutory Academic Pressure Reform Law",
    description: "Sets the framework for student-burden reduction and tutoring-industry regulation",
    explanation:
      "Intense academic pressure on K-12 students has been a focus of central policy. The 双减 (Double Reduction) policy curtailed for-profit tutoring 校外培训 (out-of-school tutoring) and shortened school homework. Debates continue between Tiger-Mom-style intensification and 减负 (burden reduction) liberalization. Affects mental health, demographic decline (couples deferring children due to education costs), and 共同富裕 (Common Prosperity) framing.",
    policyDomain: "education",
    subCategory: "Burden reduction",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "academicPressure",
      scope: "national",
    },
    // §4.7 (P2a): testPerformance secondary dropped — academicPressure (the
    // primary root) is now an ENGINE input to testPerformance (root pass-through).
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "academicPressure", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "mentalHealthAccess", weight: 0.5 },
      // "Double-reduction" exam-burden relief → fertility (birthRate driver, §4.6).
      // Positive weight: reducing pressure (left) lifts births; the demographicDecline
      // readout it replaces (§4.7 sweep) emerged from this same fertility channel.
      { metricCategoryId: "population", metricId: "birthRate", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: npcCommitteePositions("Education, Science, and Technology"),
    policyOptions: policyOptions(
      "cn_academic_pressure_reform",
      [
        {
          name: "Maximum Burden Reduction Law",
          explanation:
            "_最大减负法_ — Cap daily homework to one hour or less, abolish 高考 (Gaokao)-prep cram schools entirely, mandate minimum-sleep enforcement, dramatically scale back exam pressure system-wide.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "Comprehensive Education Liberalization Law",
          explanation:
            "_全面教育自由化法_ — Substantially expand 双减 (Double Reduction) to higher grades, end all for-profit subject tutoring, mandate evening-and-weekend protection of student family time.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Mental Health Priority Law",
          explanation:
            "_心理健康优先法_ — Cap homework hours, expand school counseling, route weekend hours to physical-and-mental-health activities.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Academic Pressure Reform Law",
          explanation:
            "_学业减负基本法_ — Maintain 双减 (Double Reduction) enforcement with incremental refinement, balanced homework caps, retained 高考 (Gaokao)-prep flexibility.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Academic Discipline Restoration Law",
          explanation:
            "_学业纪律恢复法_ — Roll back 双减 (Double Reduction) restrictions on 校外培训 (out-of-school tutoring), restore parental discretion over tutoring intensity.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "High-Performance Education Law",
          explanation:
            "_高质量教育法_ — Liberalize tutoring industry, eliminate homework caps, restore intensive exam preparation in 高考 (Gaokao)-prep grades.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Tiger-Mom Restoration Law",
          explanation:
            "_虎妈复兴法_ — Repeal 双减 (Double Reduction) in full, fully liberalize private 校外培训 (out-of-school tutoring) market, reframe academic discipline as parental-virtue restoration.",
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

  // ── 16.4 cn_research_science — Statutory Research and Science Law (科研基本法) ────────
  {
    _id: "cn_research_science",
    countryScope: "cn",
    name: "Statutory Research and Science Law",
    description: "Sets central funding for state-led R&D and talent-attraction programs",
    explanation:
      "科研 (research and science) policy is central to Made in China industrial-strategy framing, semiconductor self-sufficiency push, and 双碳 (Dual Carbon) climate commitments. State funds flow through 自然科学基金 (Natural Science Foundation), 重点研发计划 (Key R&D programs), and 千人计划 (Thousand Talents). Reform debates focus on basic-research vs applied-research balance, foreign-talent attraction vs national-security restrictions, and university-vs-state-lab structure.",
    policyDomain: "education",
    subCategory: "Research and science",
    nationalOnly: true,
    // §4.7 (P2a): research FUNDING — workforceSkill is a spend-driven readout
    // now (education spending channel), so the primary double-counted.
    // Re-pointed to rdIntensity (R&D root, TFP input), matching US/UK/JP.
    effectTarget: { metricCategoryId: "economic", metricId: "rdIntensity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "rdIntensity", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.7 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: npcCommitteePositions("Education, Science, and Technology"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_research_science",
        [
          {
            name: "Maximal State Research Law",
            explanation:
              "_最大国家科研法_ — Dramatically expand state R&D funding to Soviet-scale levels, full state lab system, mandatory technology-transfer 引进消化吸收 (introduce-digest-absorb) from foreign firms.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Made in China Acceleration Law",
            explanation:
              "_中国制造加速法_ — Surge R&D funding for semiconductor self-sufficiency, AI, biotech, advanced manufacturing under Made in China and Five-Year Plan flagship programs.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Basic Research Expansion Law",
            explanation:
              "_基础研究扩展法_ — Substantially raise 自然科学基金 (Natural Science Foundation) funding, expand 千人计划 (Thousand Talents) talent-attraction programs, fully fund 双碳 (Dual Carbon)-relevant climate research.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Research and Science Law",
            explanation:
              "_科研基本法_ — Maintain 重点研发计划 (Key R&D programs) priorities with incremental basic-research and applied-research balance.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Applied Research Priority Law",
            explanation:
              "_应用科研优先法_ — Shift R&D funding toward commercial applications, encourage private-sector R&D matching grants, reduce basic-research share.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Market-Driven Research Law",
            explanation:
              "_市场主导科研法_ — Phase out state R&D grants, channel funding through tax credits for private R&D, end 千人计划 (Thousand Talents) talent-attraction state subsidies.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "R&D Privatization Law",
            explanation:
              "_科研私有化法_ — Eliminate state R&D funding entirely, hand basic and applied research to commercial actors and private universities.",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "economic"
      ),
      [1500, 1200, 900, 600, 300, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §21 Social Policy (PR2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 21.1 cn_pension_system — Statutory Pension System Law (养老金制度法) ──────────────
  {
    _id: "cn_pension_system",
    countryScope: "cn",
    name: "Statutory Pension System Law",
    description: "Sets the framework for China's three-pillar pension system",
    explanation:
      "China runs a three-pillar pension system: 城镇职工基本养老保险 (Urban Employee Basic Pension Insurance, mandatory), 城乡居民养老保险 (Urban-Rural Resident Pension, voluntary), and supplementary commercial pensions through 个人养老金 (individual pension accounts). The system faces severe demographic pressure under one-child legacy. Reform debates focus on retirement-age extension, benefit equalization between Urban Employee and Urban-Rural pensions, and Three-Pillar diversification toward commercial coverage.",
    policyDomain: "social",
    subCategory: "Pension",
    nationalOnly: true,
    // RETARGET considered + REVERTED (Spec B audit): rentenStabilitaet is the DE-
    // named but functionally-correct STRUCTURAL pension metric — any income/poverty
    // cluster target (poverty/cohesion) double-counts the spending channel (§4.7),
    // and no CN-specific structural pension metric exists. Name-only smell; kept.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "rentenStabilitaet",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "rentenStabilitaet", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "elderCareQuality", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.7 },
      // Pension-age lever → older-worker laborParticipation → labor force L (§5.1).
      // Negative weight: expanding pensions / lower retirement age (left) cuts
      // participation; raising it (right) lifts it. Replaces the removed
      // demographicDecline readout (§4.7 sweep → §4.6 driver).
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: -0.3 },
    ],
    positions: npcCommitteePositions("Social Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_pension_system",
        [
          {
            name: "Universal Pension Law",
            explanation:
              "_全民养老金法_ — Single-payer universal pension covering all residents at urban-employee benefit level regardless of work history, full state funding from central budget, eliminate Urban-Rural differential entirely.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Common Prosperity Pension Expansion Law",
            explanation:
              "_共同富裕养老金扩展法_ — Substantially equalize urban-employee and urban-rural pension benefits, raise rural-pension floor to a meaningful share of urban-employee average, fund expansion via 共同富裕 (Common Prosperity) reallocation.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Migrant Worker Pension Bridge Law",
            explanation:
              "_农民工养老金桥接法_ — Portable urban-employee pension entitlements across provinces, eliminate 户口 (Hukou)-tied pension forfeiture, raise central-government pension-fund subsidy.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Pension System Law",
            explanation:
              "_养老金制度基本法_ — Maintain three-pillar structure with incremental urban-rural equalization, gradual retirement-age extension, expanded 个人养老金 (individual pension) account growth.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Pension Reform Restraint Law",
            explanation:
              "_养老金改革节制法_ — Accelerate retirement-age extension, freeze pension-benefit growth, expand individual-account share, reduce state liability for urban-rural pension subsidies.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Three-Pillar Market Reform Law",
            explanation:
              "_三支柱市场改革法_ — Substantially shift pension burden to 个人养老金 (individual pension) and commercial pensions, scale back state-funded urban-employee benefits, end rural-pension state subsidy.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Pension Privatization Law",
            explanation:
              "_养老金私有化法_ — Phase out state pension funding entirely, transition all pensions to individual-account and commercial-market provision, end mandatory contribution scheme.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [9000, 7000, 5500, 4000, 2000, 800, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 21.2 cn_family_policy — Statutory Family Policy Law (家庭政策法) ──────────────────
  {
    _id: "cn_family_policy",
    countryScope: "cn",
    name: "Statutory Family Policy Law",
    description: "Sets the framework for birth incentives and childcare-infrastructure programs",
    explanation:
      "China's family policy has shifted from strict one-child enforcement to the 三胎 (three-child) policy with pro-natalist incentives. Reform debates focus on the scale and design of birth-incentive subsidies, childcare-infrastructure expansion, housing-cost relief for young families, and gender-balance-in-workplace measures to enable female labor-force participation alongside higher birth rates. Sensitive to 共同富裕 (Common Prosperity) framing.",
    policyDomain: "social",
    subCategory: "Family policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "population", metricId: "birthRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "population", metricId: "birthRate", weight: 1.0 },
      // demographicDecline removed (§4.7 sweep) — birthRate is already the primary
      // driver; decline emerges from the fertility flow. (The SRB→sexRatio
      // sex-selection lever is NOT wired: the cohort birth sex-split is a fixed
      // curve, so a direct sexRatio effect would be cosmetic — deferred to the
      // engine work that makes the birth split metric-driven.)
      { metricCategoryId: "social", metricId: "genderEquality", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: npcCommitteePositions("Social Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_family_policy",
        [
          {
            name: "Comprehensive Natalist State Law",
            explanation:
              "_全面促生育国家法_ — Massive direct cash payments per child (~¥30,000/year through age 18), universal free childcare and preschool, mandatory paid parental leave for both parents, public housing priority for multi-child families.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Common Prosperity Family Expansion Law",
            explanation:
              "_共同富裕家庭扩展法_ — Substantial 共同富裕 (Common Prosperity)-aligned birth-incentive payments, expanded subsidized childcare, mortgage-subsidy program for young families with multiple children.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Childcare Infrastructure Law",
            explanation:
              "_托育基础设施法_ — Substantially expand state-funded daycare network, raise birth-incentive payments, mandate workplace lactation rooms and flexible scheduling.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Family Policy Law",
            explanation:
              "_家庭政策基本法_ — Maintain 三胎 (three-child) policy with moderate birth-incentive subsidies and incremental childcare-infrastructure expansion.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Birth Incentive Law",
            explanation:
              "_定向生育激励法_ — Narrow birth incentives to targeted high-priority groups, reduce universal childcare subsidies, encourage market-led childcare provision.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Family Responsibility Law",
            explanation:
              "_家庭责任法_ — Roll back state birth-incentive programs, frame childbearing as personal-family responsibility, reduce state share of childcare funding.",
            stance: "right",
            economic: 3,
            social: 1,
          },
          {
            name: "Family Privatization Law",
            explanation:
              "_家庭私有化法_ — Eliminate all state birth-incentive subsidies and childcare programs, restore traditional family-responsibility framing, leave childcare entirely to private market.",
            stance: "right",
            economic: 5,
            social: 2,
          },
        ],
        "both"
      ),
      [1200, 950, 700, 450, 250, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 21.3 cn_gender_equality — Statutory Gender Equality Law (性别平等法) ──────────────
  {
    _id: "cn_gender_equality",
    countryScope: "cn",
    name: "Statutory Gender Equality Law",
    description: "Sets the framework for workplace-discrimination and family-role policy",
    explanation:
      "Gender-equality policy in China balances 男女平等 (gender equality) framing — embedded in foundational law — with persistent gaps in workplace participation, leadership representation, and pay equity. Reform debates focus on workplace anti-discrimination enforcement, anti-domestic-violence legislation, female political representation, and 三胎 (three-child) policy interaction with female labor-force outcomes.",
    policyDomain: "social",
    subCategory: "Gender equality",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "genderEquality", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "genderEquality", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.3 },
      { metricCategoryId: "population", metricId: "birthRate", weight: -0.3 },
    ],
    positions: npcCommitteePositions("Social Affairs"),
    policyOptions: policyOptions(
      "cn_gender_equality",
      [
        {
          name: "Comprehensive Gender Equity Law",
          explanation:
            "_全面性别平等法_ — Mandatory gender quotas for NPC and SOE leadership, strict workplace anti-discrimination enforcement with criminal penalties, full anti-domestic-violence legislation with state shelters in every prefecture.",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Workplace Equity Expansion Law",
          explanation:
            "_职场平等扩展法_ — Substantial workplace anti-discrimination enforcement, mandatory paid maternity leave parity with paternity leave, expanded leadership-pipeline programs for female cadres.",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "Anti-Domestic-Violence Law",
          explanation:
            "_反家暴法_ — Strengthen domestic-violence enforcement framework, expand state-funded shelter network, raise penalties for workplace harassment.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Gender Equality Law",
          explanation:
            "_性别平等基本法_ — Maintain 男女平等 (gender equality) framework with incremental workplace anti-discrimination enforcement and balanced traditional-family framing.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Traditional Family Reinforcement Law",
          explanation:
            "_传统家庭强化法_ — Emphasize traditional family roles in public communications, deemphasize gender-equality enforcement in workplace, frame female employment as secondary to family.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Gender Role Restoration Law",
          explanation:
            "_性别角色恢复法_ — Roll back workplace anti-discrimination enforcement, frame women's primary role as childbearing and home-making, scale back female political-leadership pipelines.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Patriarchal Restoration Law",
          explanation:
            "_父权恢复法_ — Repeal anti-domestic-violence enforcement framework, dismantle workplace anti-discrimination law, frame gender roles as fixed cultural-traditional categories.",
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

  // ── 21.4 cn_common_prosperity — Statutory Common Prosperity Law (共同富裕法) ──────────
  {
    _id: "cn_common_prosperity",
    countryScope: "cn",
    name: "Statutory Common Prosperity Law",
    description:
      "Sets the 共同富裕 (Common Prosperity) framework for wealth-redistribution and anti-monopoly enforcement",
    explanation:
      "共同富裕 (Common Prosperity) is the framework introduced under Xi for rebalancing income and wealth distribution. It frames anti-monopoly enforcement, third-distribution philanthropy expectations on private wealth, 乡村振兴 (rural revitalization), and 反不正当竞争 (anti-unfair-competition) action against platform tech. Reform debates focus on framework scope — whether it implies aggressive wealth redistribution or moderate equalization. The framework itself is posture-only; actual fiscal flows happen through cn_state_enterprises, cn_pension_system, cn_medical_insurance, and tax types.",
    policyDomain: "social",
    subCategory: "Common Prosperity framework",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "commonProsperityIndex",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 1.0 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    policyOptions: policyOptions(
      "cn_common_prosperity",
      [
        {
          name: "Maximum Common Prosperity Law",
          explanation:
            "_最大共同富裕法_ — Comprehensive wealth-redistribution framework with aggressive anti-monopoly enforcement, mandatory third-distribution philanthropy quotas on top earners, full 乡村振兴 (rural revitalization) program at unified national scale.",
          stance: "left",
          economic: -5,
          social: 2,
        },
        {
          name: "Wealth Redistribution Expansion Law",
          explanation:
            "_财富再分配扩展法_ — Substantially raise third-distribution philanthropy expectations, expand 反不正当竞争 (anti-unfair-competition) enforcement against platform monopolies, accelerate 乡村振兴 (rural revitalization) funding.",
          stance: "left",
          economic: -3,
          social: 1,
        },
        {
          name: "Platform Tech Regulation Law",
          explanation:
            "_平台经济规范法_ — Concentrate 共同富裕 (Common Prosperity) enforcement on platform-economy giants, tighten anti-monopoly review of mergers, expand worker-protection mandates in gig economy.",
          stance: "left",
          economic: -2,
          social: 1,
        },
        {
          name: "Statutory Common Prosperity Law",
          explanation:
            "_共同富裕基本法_ — Maintain 共同富裕 (Common Prosperity) framing with steady anti-monopoly enforcement and balanced rural-urban resource redistribution.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Moderate Common Prosperity Law",
          explanation:
            "_温和共同富裕法_ — Soften third-distribution expectations, narrow anti-monopoly enforcement to most egregious cases, slow 乡村振兴 (rural revitalization) program expansion.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Private Capital Restoration Law",
          explanation:
            "_民营资本恢复法_ — Roll back anti-monopoly enforcement against platform tech, end third-distribution philanthropy framing, scale back 共同富裕 (Common Prosperity) framework.",
          stance: "right",
          economic: 3,
          social: -1,
        },
        {
          name: "Free Market Restoration Law",
          explanation:
            "_自由市场恢复法_ — Eliminate 共同富裕 (Common Prosperity) framework entirely, deregulate platform-tech sector fully, frame inequality as growth-natural outcome.",
          stance: "right",
          economic: 5,
          social: -1,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §17 Defense & Security (PR3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 17.1 cn_pla_modernization — Statutory PLA Modernization Law (中国人民解放军现代化法) ─
  {
    _id: "cn_pla_modernization",
    countryScope: "cn",
    name: "Statutory PLA Modernization Law",
    description: "Sets the framework for PLA modernization, force structure, and budget growth",
    explanation:
      "The 中国人民解放军 (People's Liberation Army) is undergoing modernization with focus on naval expansion (Type 003/004 carrier programs), 火箭军 (Rocket Force) buildup, 联合作战 (joint operations) reform, and overseas-power projection capabilities. Reform debates focus on 强军 (military strengthening) framing and Taiwan-contingency preparedness. Civil-military fusion 军民融合 (civil-military fusion) has both economic-stimulus and security dimensions.",
    policyDomain: "defense",
    subCategory: "Military modernization",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "taiwanStraitTension",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "taiwanStraitTension", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.2 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: npcCommitteePositions("National Defense"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_pla_modernization",
        [
          {
            name: "Maximum Military State Law",
            explanation:
              "_最大军事国家法_ — Triple the PLA budget toward 强军 (military strengthening) wartime levels, full carrier-fleet expansion, 火箭军 (Rocket Force) buildup, 联合作战 (joint operations) reform completion, full overseas-base network.",
            stance: "left",
            economic: -5,
            social: 1,
          },
          {
            name: "PLA Acceleration Law",
            explanation:
              "_解放军加速法_ — Significantly raise the PLA budget to expand naval and air capabilities, full 军民融合 (civil-military fusion) industrial integration, Taiwan-contingency readiness expansion.",
            stance: "left",
            economic: -3,
            social: 1,
          },
          {
            name: "Modernization Expansion Law",
            explanation:
              "_现代化扩展法_ — Substantially raise the PLA budget targeting Type 003/004 carrier programs, expanded amphibious capability, increased overseas-power projection.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory PLA Modernization Law",
            explanation:
              "_解放军现代化基本法_ — Maintain modernization trajectory with steady budget growth, balanced 联合作战 (joint operations) and 军民融合 (civil-military fusion) priorities.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Defense Restraint Law",
            explanation:
              "_国防节制法_ — Pause major procurement programs, freeze PLA budget growth, redirect funds to civilian-modernization priorities.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Demobilization Reform Law",
            explanation:
              "_裁军改革法_ — Reduce PLA active personnel substantially, scale back carrier programs, prioritize quality over quantity in force structure.",
            stance: "right",
            economic: 3,
            social: -1,
          },
          {
            name: "Minimal Defense Law",
            explanation:
              "_最低国防法_ — Cut the PLA budget to a bare territorial-defense floor, end overseas-power projection, abandon 强军 (military strengthening) framing.",
            stance: "right",
            economic: 5,
            social: -1,
          },
        ],
        "both"
      ),
      [3200, 2500, 1800, 1200, 700, 350, 150]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 17.2 cn_taiwan_strait_doctrine — Statutory Taiwan Strait Doctrine Law (台海政策法) ─
  {
    _id: "cn_taiwan_strait_doctrine",
    countryScope: "cn",
    name: "Statutory Taiwan Strait Doctrine Law",
    description: "Sets the framework for Taiwan Strait policy and unification doctrine",
    explanation:
      "台海 (Taiwan Strait) policy is one of the most politically charged framings in CN governance. The 一个中国 (One China) principle anchors official policy, with the legal framework set by 反分裂国家法 (Anti-Secession Law). Reform debates run from 和平统一 (peaceful unification) framing through military-readiness escalation toward 武统 (forced unification) doctrine. Sensitive intersection with 港澳 (Hong Kong-Macao) precedent and US-China relations.",
    policyDomain: "defense",
    subCategory: "Taiwan policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "taiwanStraitTension",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "taiwanStraitTension", weight: -1.0 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "beltAndRoadEngagement", weight: -0.2 },
      { metricCategoryId: "governance" as const, metricId: "militaryReadiness", weight: -0.4 },
    ],
    positions: npcCommitteePositions("National Defense"),
    policyOptions: policyOptions(
      "cn_taiwan_strait_doctrine",
      [
        {
          name: "Forced Unification Law",
          explanation:
            "_武力统一法_ — Codify 武统 (forced unification) doctrine in legal framework, expand 反分裂国家法 (Anti-Secession Law) triggers, accelerate amphibious-warfare capability deployment toward operational readiness.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Coercive Pressure Law",
          explanation:
            "_压力施加法_ — Expand military exercises around 台海 (Taiwan Strait), economic-coercion measures against pro-independence businesses, intensify 反分裂国家法 (Anti-Secession Law) enforcement framework.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Strategic Patience Law",
          explanation:
            "_战略耐心法_ — Maintain assertive 一个中国 (One China) posture with regular military signaling but no immediate unification timetable.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Taiwan Strait Doctrine Law",
          explanation:
            "_台海政策基本法_ — Maintain 一个中国 (One China) doctrine with steady military readiness levels and peaceful-unification rhetorical primacy.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Peaceful Unification Priority Law",
          explanation:
            "_和平统一优先法_ — Emphasize 和平统一 (peaceful unification) framing, reduce military exercises near 台海 (Taiwan Strait), expand economic-engagement programs with Taiwan.",
          stance: "right",
          economic: 1,
          social: -1,
        },
        {
          name: "Cross-Strait Engagement Law",
          explanation:
            "_两岸接触法_ — Substantially expand cross-strait economic, cultural, and educational exchange, reduce political-pressure tactics, frame Taiwan as integral economic partner.",
          stance: "right",
          economic: 2,
          social: -3,
        },
        {
          name: "Cross-Strait Equilibrium Law",
          explanation:
            "_现状接受法_ — Quietly accept the de facto cross-strait equilibrium, deprioritize unification framing in policy communications, focus on economic integration only.",
          stance: "right",
          economic: 3,
          social: -5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 17.3 cn_cybersecurity — Statutory Cybersecurity Law (网络安全法) ───────────────────
  {
    _id: "cn_cybersecurity",
    countryScope: "cn",
    name: "Statutory Cybersecurity Law",
    description: "Sets the framework for data-security and tech-platform regulation",
    explanation:
      "网信办 (Cyberspace Administration of China — CAC) regulates internet content, data security, and tech-platform compliance. Reform debates focus on 数据安全 (data security) law strictness, foreign-platform restrictions (Great Firewall scope), and 网络安全法 (Cybersecurity Law) enforcement intensity. Sensitive to 数字主权 (digital sovereignty) framing vs commercial-internet openness.",
    policyDomain: "defense",
    subCategory: "Cybersecurity",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "socialCreditCoverage",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "mediaInformation", metricId: "disinformationRisk", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: npcCommitteePositions("National Defense"),
    policyOptions: policyOptions(
      "cn_cybersecurity",
      [
        {
          name: "Maximum Digital Sovereignty Law",
          explanation:
            "_最大数字主权法_ — Full domestic alternatives for all major foreign platforms, mandatory data-localization for all firms operating in China, full 网信办 (Cyberspace Administration) enforcement authority over all internet content.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Cybersecurity Expansion Law",
          explanation:
            "_网络安全扩展法_ — Significantly tighten 数据安全 (data security) law, expand 网络安全法 (Cybersecurity Law) enforcement targeting foreign tech platforms, strengthen 数字主权 (digital sovereignty).",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Data Sovereignty Reinforcement Law",
          explanation:
            "_数据主权强化法_ — Substantially expand data-localization requirements, mandate domestic-cloud usage for sensitive sectors, raise scrutiny on foreign tech-platform operations.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Cybersecurity Law",
          explanation:
            "_网络安全基本法_ — Maintain steady 网络安全法 (Cybersecurity Law) enforcement with incremental 数据安全 (data security) framework updates.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Internet Openness Pilot Law",
          explanation:
            "_互联网开放试点法_ — Pilot relaxed data-localization in select cities, reduce foreign-platform restrictions for non-sensitive sectors.",
          stance: "right",
          economic: 1,
          social: -1,
        },
        {
          name: "Commercial Internet Liberalization Law",
          explanation:
            "_商业互联网自由化法_ — Substantially reduce 网信办 (Cyberspace Administration) enforcement on commercial platforms, relax data-localization requirements broadly, expand foreign-platform allowable operations.",
          stance: "right",
          economic: 2,
          social: -2,
        },
        {
          name: "Open Internet Law",
          explanation:
            "_开放互联网法_ — Roll back Great Firewall to minimal content-filtering only, eliminate broad data-localization mandates, permit foreign-platform free operation under standard commercial regulation.",
          stance: "right",
          economic: 3,
          social: -5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §25 Foreign Policy (PR3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 25.1 cn_belt_and_road — Statutory Belt and Road Initiative Law (一带一路法) ───────
  {
    _id: "cn_belt_and_road",
    countryScope: "cn",
    name: "Statutory Belt and Road Initiative Law",
    description: "Sets central funding for the 一带一路 (Belt and Road) overseas-lending program",
    explanation:
      "The 一带一路 (Belt and Road Initiative) is China's flagship foreign-economic policy, deploying state-bank loans (China Development Bank, Export-Import Bank) and SOE infrastructure expertise to ~140 partner countries. The 丝路基金 (Silk Road Fund) supports project finance. Reform debates focus on BRI scale, debt-sustainability concerns for partner countries, green-BRI framing, and BRI-2.0 (smaller, smarter projects) recalibration.",
    policyDomain: "foreign_policy",
    subCategory: "Belt and Road",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "beltAndRoadEngagement",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "beltAndRoadEngagement", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.3 },
    ],
    positions: npcCommitteePositions("Foreign Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_belt_and_road",
        [
          {
            name: "Maximum BRI Mobilization Law",
            explanation:
              "_最大一带一路动员法_ — Massive expansion of 一带一路 (Belt and Road) loan-and-investment program covering all developing-region partners, full 丝路基金 (Silk Road Fund) capitalization, comprehensive SOE infrastructure-export pipeline activation.",
            stance: "left",
            economic: -5,
            social: 2,
          },
          {
            name: "BRI Acceleration Law",
            explanation:
              "_一带一路加速法_ — Substantially raise 一带一路 (Belt and Road) project pipeline, expand China Development Bank and Export-Import Bank lending capacity, accelerate green-BRI investment scaling.",
            stance: "left",
            economic: -3,
            social: 1,
          },
          {
            name: "Strategic BRI Expansion Law",
            explanation:
              "_战略一带一路扩展法_ — Concentrate 一带一路 (Belt and Road) expansion on strategic partner countries, raise SOE infrastructure-bidding subsidies, expand RMB-denominated lending share.",
            stance: "left",
            economic: -2,
            social: 1,
          },
          {
            name: "Statutory Belt and Road Initiative Law",
            explanation:
              "_一带一路基本法_ — Maintain 一带一路 (Belt and Road) framework with steady project pipeline, balanced debt-sustainability review, and green-BRI integration.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "BRI Recalibration Law",
            explanation:
              "_一带一路再校准法_ — Narrow 一带一路 (Belt and Road) project scope to smaller, smarter investments, raise debt-sustainability screening, scale back broad lending commitments.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "BRI Restraint Law",
            explanation:
              "_一带一路节制法_ — Substantially scale back 一带一路 (Belt and Road) lending, freeze new large-scale project commitments, refocus on existing-project completion.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "BRI Withdrawal Law",
            explanation:
              "_一带一路退出法_ — End 一带一路 (Belt and Road) framework as state-led foreign-economic policy, restrict overseas lending to commercial-bank discretion, dissolve 丝路基金 (Silk Road Fund).",
            stance: "right",
            economic: 5,
            social: -1,
          },
        ],
        "both"
      ),
      [1200, 950, 700, 450, 250, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 25.2 cn_us_china_relations — Statutory US-China Relations Law (中美关系法) ────────
  {
    _id: "cn_us_china_relations",
    countryScope: "cn",
    name: "Statutory US-China Relations Law",
    description: "Sets the posture for US-China bilateral diplomatic and economic relations",
    explanation:
      "中美关系 (US-China relations) frames China's most consequential bilateral foreign policy. The relationship runs through trade, technology (semiconductor decoupling, AI competition), Taiwan, South China Sea, and climate diplomacy channels. Reform debates focus on posture toward US — from cooperative engagement through managed competition to confrontational decoupling. Sensitive intersection with 反外国制裁法 (Anti-Foreign-Sanctions Law) and 双循环 (dual circulation) framing.",
    policyDomain: "foreign_policy",
    subCategory: "US relations",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "taiwanStraitTension", weight: -0.6 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.4 },
    ],
    positions: npcCommitteePositions("Foreign Affairs"),
    policyOptions: policyOptions(
      "cn_us_china_relations",
      [
        {
          name: "Maximum Confrontation Law",
          explanation:
            "_最大对抗法_ — Comprehensive decoupling from US economic, technological, and academic exchange, full 反外国制裁法 (Anti-Foreign-Sanctions Law) enforcement, accelerate 双循环 (dual circulation) self-sufficiency drive.",
          stance: "left",
          economic: 0,
          social: 5,
        },
        {
          name: "Strategic Decoupling Law",
          explanation:
            "_战略脱钩法_ — Substantially expand decoupling from US in strategic technology sectors, intensify 反外国制裁法 (Anti-Foreign-Sanctions Law) enforcement, expand 双循环 (dual circulation) framework.",
          stance: "left",
          economic: 0,
          social: 3,
        },
        {
          name: "Managed Competition Reinforcement Law",
          explanation:
            "_管控竞争强化法_ — Strengthen self-sufficiency posture in priority sectors while maintaining trade-engagement channels, raise tactical-coordination capabilities against US measures.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory US-China Relations Law",
          explanation:
            "_中美关系基本法_ — Maintain managed-competition framework with steady trade-engagement, balanced strategic-friction management, incremental decoupling in priority sectors.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Engagement Restoration Law",
          explanation:
            "_接触恢复法_ — Soften decoupling posture in non-strategic sectors, restore academic-and-business exchange channels, narrow 反外国制裁法 (Anti-Foreign-Sanctions Law) enforcement to high-priority cases.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Cooperative Framework Law",
          explanation:
            "_合作框架法_ — Substantially expand engagement channels with US in climate, public-health, and trade, deprioritize 双循环 (dual circulation) self-sufficiency framing, restore broader academic exchange.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Full Engagement Restoration Law",
          explanation:
            "_全面接触恢复法_ — Restore comprehensive US-China engagement framework, abandon 双循环 (dual circulation) self-sufficiency posture, end 反外国制裁法 (Anti-Foreign-Sanctions Law) tit-for-tat framing.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 25.3 cn_un_security_council_posture — Statutory UN Security Council Posture Law (联合国安理会立场法) ─
  {
    _id: "cn_un_security_council_posture",
    countryScope: "cn",
    name: "Statutory UN Security Council Posture Law",
    description: "Sets China's posture and voting framework at the UN Security Council",
    explanation:
      "As a permanent member of the UN Security Council, China's posture frames its global-governance influence. The 反对干涉内政 (non-interference in internal affairs) doctrine shapes voting patterns. Reform debates focus on UNSC reform proposals, peacekeeping-contribution scale, voting alignment with Russia, and willingness to deploy veto for partner-country protection.",
    policyDomain: "foreign_policy",
    subCategory: "UN Security Council",
    nationalOnly: true,
    // RETARGET (Spec B, ex-Spec A): UNSC posture projects national prestige, not
    // beltAndRoadEngagement (windowed 2013); kept as a weak posture lever.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "nationalPride",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "nationalPride", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "taiwanStraitTension", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.2 },
    ],
    positions: npcCommitteePositions("Foreign Affairs"),
    policyOptions: policyOptions(
      "cn_un_security_council_posture",
      [
        {
          name: "Maximum UNSC Assertion Law",
          explanation:
            "_最大安理会主张法_ — Comprehensive 反对干涉内政 (non-interference) doctrine application, full P5 veto-deployment willingness for partner-country protection, expanded UN peacekeeping contributions in 一带一路 (Belt and Road) partner regions.",
          stance: "left",
          economic: 0,
          social: 5,
        },
        {
          name: "Strategic UNSC Coordination Law",
          explanation:
            "_战略安理会协调法_ — Substantially expand Russia-China voting coordination at UNSC, intensify counter-Western coalition-building among non-aligned members.",
          stance: "left",
          economic: 0,
          social: 3,
        },
        {
          name: "Multilateral Reform Push Law",
          explanation:
            "_多边改革推动法_ — Push for UNSC reform expanding non-aligned representation, raise peacekeeping-contribution scale in 一带一路 (Belt and Road) regions, expand counter-sanctions framework.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory UN Security Council Posture Law",
          explanation:
            "_联合国安理会立场基本法_ — Maintain 反对干涉内政 (non-interference) doctrine with steady veto-deployment and balanced peacekeeping contributions.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Cautious Engagement Law",
          explanation:
            "_谨慎接触法_ — Narrow UNSC veto-deployment to highest-priority partner-country cases, raise peacekeeping-contribution emphasis as constructive multilateral actor.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Constructive Multilateral Law",
          explanation:
            "_建设性多边法_ — Substantially raise peacekeeping contributions, soften 反对干涉内政 (non-interference) doctrine where atrocity prevention is at stake, expand cooperation with Western P5 members.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Full Multilateral Engagement Law",
          explanation:
            "_全面多边接触法_ — Comprehensive cooperation with Western P5 members, abandon strict 反对干涉内政 (non-interference) doctrine, frame China as constructive global-governance partner.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §26 Technology (PR3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 26.1 cn_ai_strategy — Statutory AI Strategy Law (人工智能战略法) ──────────────────
  {
    _id: "cn_ai_strategy",
    countryScope: "cn",
    name: "Statutory AI Strategy Law",
    description: "Sets the framework for state-led AI development and content regulation",
    explanation:
      "人工智能 (AI) policy is anchored by the 新一代人工智能发展规划 (Next-Generation AI Development Plan) and Made in China priorities. Reform debates focus on AI training compute investment, generative-AI content regulation, AI safety/alignment frameworks, surveillance-AI deployment, and balance with US AI competition under tech-decoupling pressures.",
    policyDomain: "technology",
    subCategory: "AI strategy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "industrialPolicyExecution",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "roboticsAdoption", weight: 0.5 },
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.1 },
    ],
    positions: npcCommitteePositions("Science and Technology"),
    policyOptions: policyOptions(
      "cn_ai_strategy",
      [
        {
          name: "Maximum AI Mobilization Law",
          explanation:
            "_最大人工智能动员法_ — Comprehensive state-led 人工智能 (AI) development program, full Made in China priority budget allocation, mandatory generative-AI content licensing, fully-funded compute-infrastructure buildout, surveillance-AI integration across 社会信用 (social credit) framework.",
          stance: "left",
          economic: -5,
          social: 2,
        },
        {
          name: "AI Acceleration Law",
          explanation:
            "_人工智能加速法_ — Substantially expand 新一代人工智能发展规划 (Next-Generation AI Development Plan) funding, raise SOE AI deployment mandates, expand state-funded AI training compute clusters.",
          stance: "left",
          economic: -3,
          social: 1,
        },
        {
          name: "AI Industrial Coordination Law",
          explanation:
            "_人工智能产业协调法_ — Concentrate state-led AI strategy on priority sectors (semiconductors, biotech, advanced manufacturing), expand 网信办 (Cyberspace Administration) generative-AI content licensing.",
          stance: "left",
          economic: -2,
          social: 1,
        },
        {
          name: "Statutory AI Strategy Law",
          explanation:
            "_人工智能战略基本法_ — Maintain 新一代人工智能发展规划 (Next-Generation AI Development Plan) framework with steady state-funded compute expansion and balanced content-licensing enforcement.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Market AI Reform Law",
          explanation:
            "_市场人工智能改革法_ — Narrow state-led AI strategy scope to priority-only sectors, raise market-led commercial AI development, soften generative-AI content licensing.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Private AI Investment Law",
          explanation:
            "_民营人工智能投资法_ — Phase out broad state AI subsidies, hand AI development to private capital, restrict 网信办 (Cyberspace Administration) generative-AI content licensing to most-egregious cases.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "AI Liberalization Law",
          explanation:
            "_人工智能自由化法_ — Eliminate state-led AI strategy framework, abolish generative-AI content licensing, deregulate AI compute and model deployment fully.",
          stance: "right",
          economic: 5,
          social: -1,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 26.2 cn_semiconductor_strategy — Statutory Semiconductor Strategy Law (半导体战略法) ─
  {
    _id: "cn_semiconductor_strategy",
    countryScope: "cn",
    name: "Statutory Semiconductor Strategy Law",
    description:
      "Sets the framework for semiconductor self-sufficiency and 大基金 (National IC Fund) capitalization",
    explanation:
      "半导体战略 (semiconductor strategy) is central to Made in China priorities. The state-backed 大基金 (National IC Fund) provides equity capital to semiconductor manufacturing and design firms. US tech-export controls have intensified self-sufficiency push, with focus on advanced-node fabrication, EDA tooling, and IP-licensing alternatives. Reform debates focus on state-investment scale, partner-country supply-chain coordination, and balance between self-sufficiency and globally-integrated semiconductor production.",
    policyDomain: "technology",
    subCategory: "Semiconductor strategy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "industrialPolicyExecution",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.8 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.1 },
    ],
    positions: npcCommitteePositions("Science and Technology"),
    policyOptions: policyOptions(
      "cn_semiconductor_strategy",
      [
        {
          name: "Maximum Semiconductor State Law",
          explanation:
            "_最大半导体国家法_ — Massive state-led semiconductor self-sufficiency mobilization, full 大基金 (National IC Fund) expansion, mandatory technology-transfer requirements on foreign-headquartered firms, comprehensive EDA-tooling and IP-licensing replacement programs.",
          stance: "left",
          economic: -5,
          social: 2,
        },
        {
          name: "Self-Sufficiency Acceleration Law",
          explanation:
            "_自给加速法_ — Substantially raise 大基金 (National IC Fund) capitalization, expand state subsidies for advanced-node fabrication, accelerate domestic-EDA tooling deployment.",
          stance: "left",
          economic: -3,
          social: 1,
        },
        {
          name: "Strategic Semiconductor Reinforcement Law",
          explanation:
            "_战略半导体强化法_ — Concentrate semiconductor funding on advanced-node and AI-relevant chip categories, expand SOE foundry capacity, raise Made in China semiconductor mandate.",
          stance: "left",
          economic: -2,
          social: 1,
        },
        {
          name: "Statutory Semiconductor Strategy Law",
          explanation:
            "_半导体战略基本法_ — Maintain 大基金 (National IC Fund) framework with steady advanced-node capacity expansion and balanced state-and-private investment mix.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Mixed Investment Reform Law",
          explanation:
            "_混合投资改革法_ — Narrow 大基金 (National IC Fund) scope to highest-priority advanced-node projects, raise private-investment matching requirements, soften technology-transfer mandates.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market Semiconductor Law",
          explanation:
            "_半导体市场化法_ — Phase out 大基金 (National IC Fund) capitalization growth, hand semiconductor development to market competition, end mandatory technology-transfer requirements.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Semiconductor Liberalization Law",
          explanation:
            "_半导体自由化法_ — Eliminate state-led semiconductor strategy, dissolve 大基金 (National IC Fund), accept global-supply-chain integration risks under market-led production framework.",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §27 Public Safety (PR3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 27.1 cn_public_security — Statutory Public Security Law (公共安全法) ──────────────
  {
    _id: "cn_public_security",
    countryScope: "cn",
    name: "Statutory Public Security Law",
    description:
      "Sets the framework for 公安部 (Ministry of Public Security) authority and surveillance",
    explanation:
      "公安 (Public Security) framework runs through 公安部 (Ministry of Public Security) at the national level, with operational delivery through provincial 公安厅 (Public Security Bureaus) — funded separately via cn_provincial_public_security. National policy sets framework direction. Reform debates focus on technology adoption (facial recognition, AI surveillance), 反恐 (counter-terrorism) framing, mass-incident response doctrine, and 社会信用 (social credit) framework integration.",
    policyDomain: "law_justice",
    subCategory: "Public security",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.7 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Public Security and Law"),
    policyOptions: policyOptions(
      "cn_public_security",
      [
        {
          name: "Maximum Surveillance State Law",
          explanation:
            "_最大监控国家法_ — Comprehensive surveillance-technology deployment under 公安部 (Ministry of Public Security) coordination, full facial-recognition integration in all urban areas, mandatory 社会信用 (social credit) framework participation for all residents, expanded 反恐 (counter-terrorism) framing scope.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Public Security Acceleration Law",
          explanation:
            "_公共安全加速法_ — Substantially raise national 公安 (Public Security) coordination authority, expand surveillance-technology mandates, intensify 反恐 (counter-terrorism) enforcement framework.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Technology Surveillance Reinforcement Law",
          explanation:
            "_科技监控强化法_ — Concentrate surveillance-technology deployment in tier-1 cities and border regions, expand 公安部 (Ministry of Public Security) data-sharing across provincial PSB networks.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Public Security Law",
          explanation:
            "_公共安全基本法_ — Maintain 公安 (Public Security) framework with steady technology-deployment growth and balanced 反恐 (counter-terrorism) enforcement framework.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Privacy Reform Law",
          explanation:
            "_隐私改革法_ — Narrow surveillance-technology deployment to highest-priority public-safety needs, raise privacy-protection standards in 公安部 (Ministry of Public Security) data collection.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Civil Liberties Restoration Law",
          explanation:
            "_公民自由恢复法_ — Substantially scale back facial-recognition deployment, end mass 社会信用 (social credit) framework participation requirements, restore independent oversight of 公安部 (Ministry of Public Security) surveillance operations.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Minimal Surveillance Law",
          explanation:
            "_最低监控法_ — Roll back comprehensive surveillance framework, restrict 公安部 (Ministry of Public Security) surveillance authority to targeted court-warranted operations only.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 27.2 cn_criminal_justice — Statutory Criminal Justice Law (刑事司法法) ────────────
  {
    _id: "cn_criminal_justice",
    countryScope: "cn",
    name: "Statutory Criminal Justice Law",
    description:
      "Sets the framework for sentencing severity, 严打 (strike-hard) campaigns, and due process",
    explanation:
      "刑事司法 (criminal justice) operates through 最高人民法院 (Supreme People's Court) and 最高人民检察院 (Supreme People's Procuratorate). 死刑 (death penalty) remains in use; 缓刑 (suspended sentencing) is available. Reform debates focus on death-penalty scope, defendant-rights framework, 刑事和解 (criminal mediation), and balance between 严打 (strike-hard) campaigns and rule-of-law institutionalization.",
    policyDomain: "law_justice",
    subCategory: "Criminal justice",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "incarcerationRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "incarcerationRate", weight: -0.6 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "publicSafety", metricId: "violentCrimeRate", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Public Security and Law"),
    policyOptions: policyOptions(
      "cn_criminal_justice",
      [
        {
          name: "Strike-Hard Maximum Law",
          explanation:
            "_最大严打法_ — Comprehensive 严打 (strike-hard) campaign with expanded 死刑 (death penalty) application, mandatory minimum sentences for major crime categories, restrict 缓刑 (suspended sentencing) eligibility, suspend 刑事和解 (criminal mediation) for serious offenses.",
          stance: "left",
          economic: 0,
          social: 5,
        },
        {
          name: "Strike-Hard Expansion Law",
          explanation:
            "_严打扩展法_ — Substantially expand 严打 (strike-hard) campaign scope, raise sentencing severity for major crime categories, intensify 公安部 (Ministry of Public Security) and 最高人民检察院 (Supreme People's Procuratorate) coordination.",
          stance: "left",
          economic: 0,
          social: 3,
        },
        {
          name: "Sentencing Severity Reinforcement Law",
          explanation:
            "_量刑加重强化法_ — Concentrate criminal-justice enforcement on serious crime categories, raise mandatory-minimum thresholds, expand 死刑 (death penalty) appeal-review acceleration.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Criminal Justice Law",
          explanation:
            "_刑事司法基本法_ — Maintain criminal-justice framework with steady 严打 (strike-hard) campaign cadence and balanced 缓刑 (suspended sentencing) availability.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Due Process Reform Law",
          explanation:
            "_正当程序改革法_ — Substantially expand defendant due-process rights, raise 刑事和解 (criminal mediation) availability, narrow 死刑 (death penalty) application scope.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Civil Rights Expansion Law",
          explanation:
            "_公民权利扩展法_ — Substantially expand defendant rights framework, narrow 严打 (strike-hard) framing to most-serious-only cases, expand independent-counsel access.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Restorative Justice Law",
          explanation:
            "_恢复性司法法_ — Comprehensive 刑事和解 (criminal mediation) framework, abolish 死刑 (death penalty) in non-violent cases, restore robust due-process protections throughout criminal-justice system.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 27.3 cn_internet_governance — Statutory Internet Governance Law (网络治理法) ──────
  {
    _id: "cn_internet_governance",
    countryScope: "cn",
    name: "Statutory Internet Governance Law",
    description:
      "Sets the framework for 防火长城 (Great Firewall) scope and 网信办 (Cyberspace Administration) content moderation",
    explanation:
      "网络治理 (internet governance) covers content moderation, 防火长城 (Great Firewall) scope, platform-tech regulation, and 网信办 (Cyberspace Administration) enforcement authority. The 网络主权 (network sovereignty) doctrine frames China's position in international internet-governance bodies. Reform debates focus on content-moderation enforcement intensity, foreign-platform-access scope, and balance between cybersecurity and commercial-internet openness.",
    policyDomain: "law_justice",
    subCategory: "Internet governance",
    nationalOnly: true,
    // RETARGET considered + REVERTED (Spec B audit): the design intends internet
    // governance to co-drive socialCreditCoverage with cn_cybersecurity (countryIndices
    // sweep invariant); its 1998<2014 window is already handled by Spec A's WAIVER.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "socialCreditCoverage",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.5 },
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: -0.5 },
      { metricCategoryId: "mediaInformation", metricId: "mediaPolarization", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Public Security and Law"),
    policyOptions: policyOptions(
      "cn_internet_governance",
      [
        {
          name: "Maximum Network Sovereignty Law",
          explanation:
            "_最大网络主权法_ — Comprehensive 防火长城 (Great Firewall) extension to all internet traffic, full domestic-platform-only mandate, mandatory state ID verification for all internet usage, full 网络主权 (network sovereignty) doctrine enforcement in international internet-governance bodies.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Cyber Governance Acceleration Law",
          explanation:
            "_网络治理加速法_ — Substantially expand 网信办 (Cyberspace Administration) content-moderation authority, intensify 防火长城 (Great Firewall) filtering of foreign content, raise platform-tech compliance enforcement.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Content Moderation Reinforcement Law",
          explanation:
            "_内容审核强化法_ — Concentrate 网信办 (Cyberspace Administration) content-moderation on political/social-stability content, raise mandatory platform-licensing requirements.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Internet Governance Law",
          explanation:
            "_网络治理基本法_ — Maintain 防火长城 (Great Firewall) framework with steady 网信办 (Cyberspace Administration) content-moderation enforcement and balanced platform-licensing requirements.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Content Openness Pilot Law",
          explanation:
            "_内容开放试点法_ — Pilot relaxed content-moderation for specific domains (academic, scientific, business), narrow 防火长城 (Great Firewall) filtering scope.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Internet Liberalization Law",
          explanation:
            "_互联网自由化法_ — Substantially reduce 防火长城 (Great Firewall) filtering, expand foreign-platform allowable access, narrow 网信办 (Cyberspace Administration) content-moderation to highest-priority cases.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Open Internet Restoration Law",
          explanation:
            "_开放互联网恢复法_ — Roll back 防火长城 (Great Firewall) framework, end mandatory state ID verification, restore broad foreign-platform access under standard commercial regulation.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      // P5 mis-tag fix (classification P6.2b): censorship/surveillance powers
      // are social-axis (auth↔lib), not economic.
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §18 Economic (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 18.1 cn_state_enterprises — Statutory State Enterprises Law (国有企业法) ──────────
  {
    _id: "cn_state_enterprises",
    countryScope: "cn",
    name: "Statutory State Enterprises Law",
    description:
      "Sets the framework for SOE ownership, governance, and 党的领导 (Party leadership)",
    explanation:
      "国有企业 (state-owned enterprises — SOEs) form roughly 30% of GDP and dominate strategic sectors including energy, banking, telecoms, aerospace, and defense. Reform debates focus on whether to deepen 混合所有制 (mixed-ownership reform) to introduce private capital and market discipline, maintain 强强联合 (state-led consolidation) for strategic capacity, or restore comprehensive state direction under expanded 党的领导 (Party leadership) committees.",
    policyDomain: "economic",
    subCategory: "State enterprises",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "industrialPolicyExecution",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.7 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: 0.4 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    policyOptions: policyOptions(
      "cn_state_enterprises",
      [
        {
          name: "Full State Ownership Law",
          explanation:
            "_全面国有化法_ — Renationalize strategic sectors fully, dissolve 混合所有制 (mixed-ownership reform) pilots, expand 党的领导 (Party leadership) committees to all SOE boards, treat SOEs as primary industrial-policy lever.",
          stance: "left",
          economic: -5,
          social: 2,
        },
        {
          name: "SOE Consolidation Law",
          explanation:
            "_国企整合法_ — Substantially expand SOE scope into adjacent strategic sectors, reverse 混合所有制 (mixed-ownership reform) pilots in priority industries, strengthen 强强联合 (state-led consolidation) merger doctrine.",
          stance: "left",
          economic: -3,
          social: 1,
        },
        {
          name: "Strategic SOE Reinforcement Law",
          explanation:
            "_战略国企强化法_ — Deepen 党的领导 (Party leadership) control over SOE governance, expand SOE role in semiconductor, biotech, and green energy sectors, retain mixed-ownership only at non-strategic margins.",
          stance: "left",
          economic: -2,
          social: 1,
        },
        {
          name: "Statutory State Enterprises Law",
          explanation:
            "_国有企业基本法_ — Maintain SOE dominance in strategic sectors with selective 混合所有制 (mixed-ownership reform) pilots and incremental Party-governance expansion.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Mixed-Ownership Expansion Law",
          explanation:
            "_混合所有制扩展法_ — Substantially expand 混合所有制 (mixed-ownership reform) pilots beyond priority sectors, raise private-investor seat allocations on SOE boards, increase return-on-capital benchmarks.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "SOE Liberalization Law",
          explanation:
            "_国企自由化法_ — Privatize non-strategic SOEs (consumer-goods, light manufacturing, services), retain state ownership only in defense, energy, and finance core.",
          stance: "right",
          economic: 3,
          social: -1,
        },
        {
          name: "SOE Privatization Law",
          explanation:
            "_国企私有化法_ — Privatize all SOEs except defense, abolish 党的领导 (Party leadership) governance committees in corporate management, transition to fully market-led industrial structure.",
          stance: "right",
          economic: 5,
          social: -1,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 18.2 cn_industrial_strategy — Statutory Industrial Strategy Law (工业战略法) ──────
  {
    _id: "cn_industrial_strategy",
    countryScope: "cn",
    name: "Statutory Industrial Strategy Law",
    description: "Sets the framework for industrial-policy targeting and Five-Year Plan priorities",
    explanation:
      "工业战略 (industrial strategy) is the central economic-planning instrument anchored by the Five-Year Plan cycle. Made in China sets sector-specific self-sufficiency targets, while 双碳 (Dual Carbon) commitments shape energy-industry direction. Reform debates focus on the balance between state-directed industrial targeting, 产业政策 (industrial policy) subsidies, and market-led sector growth.",
    policyDomain: "economic",
    subCategory: "Industrial strategy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "industrialPolicyExecution",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    policyOptions: policyOptions(
      "cn_industrial_strategy",
      [
        {
          name: "Total Industrial Direction Law",
          explanation:
            "_全面工业指导法_ — State-directed targets for all major industries, mandatory technology-transfer requirements, comprehensive 产业政策 (industrial policy) subsidies routed via SOEs and central planning organs.",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Made in China Expansion Law",
          explanation:
            "_中国制造扩展法_ — Substantially expand Made in China sector targets, increase state R&D and subsidy intensity for semiconductors, biotech, advanced manufacturing under Five-Year Plan flagship programs.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Strategic Sector Targeting Law",
          explanation:
            "_战略产业定向法_ — Concentrate industrial policy on priority sectors (semiconductors, AI, EVs, biotech) with expanded subsidy intensity and 产业政策 (industrial policy) backstops.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Industrial Strategy Law",
          explanation:
            "_工业战略基本法_ — Maintain Five-Year Plan industrial-strategy direction with steady Made in China sector targeting and balanced subsidy intensity.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Industrial Targeting Reform Law",
          explanation:
            "_工业定向改革法_ — Narrow industrial-policy scope to a smaller set of priority sectors, reduce subsidy intensity, raise market-competition emphasis.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market-Led Industrial Law",
          explanation:
            "_市场主导工业法_ — Phase out broad-sector subsidies, retain only minimal strategic-defense-relevant industrial policy, hand sector growth to market competition.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Industrial Policy Abolition Law",
          explanation:
            "_产业政策废止法_ — Eliminate all sector-specific industrial subsidies and tariffs, dissolve Made in China framework, return to fully market-led industrial development.",
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

  // ── 18.3 cn_minimum_wage — Statutory Minimum Wage Law (最低工资法) ────────────────────
  {
    _id: "cn_minimum_wage",
    countryScope: "cn",
    name: "Statutory Minimum Wage Law",
    description: "Sets the federal minimum-wage floor and provincial-discretion framework",
    explanation:
      "Provincial-level minimum wages range widely under a federal minimum-wage law framework (最低工资法). Reform debates focus on whether to set a federal floor that overrides provincial discretion, whether to peg automatic adjustments to inflation/GDP growth, and whether to differentiate by urban/rural and industrial sector. Sensitive to 共同富裕 (Common Prosperity) framing and migrant-worker integration via 户口 (Hukou) policy.",
    policyDomain: "economic",
    subCategory: "Minimum wage",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
    ],
    positions: npcCommitteePositions("Labor and Social Affairs"),
    policyOptions: policyOptions(
      "cn_minimum_wage",
      [
        {
          name: "Maximum Federal Floor Law",
          explanation:
            "_最高联邦底薪法_ — Federal minimum wage set at the high-coastal floor (~¥2,700/mo) applied uniformly across all provinces, with automatic inflation-plus indexing.",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Living-Wage Federal Law",
          explanation:
            "_生活工资联邦法_ — Federal minimum wage substantially above coastal Tier-2 city level (~¥2,200/mo), automatic GDP-growth indexing, eliminate rural-urban differential.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Common Prosperity Wage Floor Law",
          explanation:
            "_共同富裕薪资法_ — Substantially raise the federal minimum-wage floor (~¥1,900/mo), retain modest provincial variation, fund a 共同富裕 (Common Prosperity) wage-adjustment transfer for low-income provinces.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Minimum Wage Law",
          explanation:
            "_最低工资基本法_ — Maintain provincial-level minimum-wage authority with a moderate federal floor (~¥1,600/mo) and biannual review cycle.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Provincial Discretion Reinforcement Law",
          explanation:
            "_省级自主强化法_ — Eliminate the federal floor, return minimum-wage setting entirely to provincial discretion under their own legislative frameworks.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market Wage Reform Law",
          explanation:
            "_市场工资改革法_ — Reduce or eliminate provincial-level minimum wages in non-coastal regions, retain only urban-coastal regional floors for migrant-worker protection.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Minimum Wage Repeal Law",
          explanation:
            "_最低工资废除法_ — Repeal all federal and provincial minimum-wage statutes, return wage-setting fully to labor-market dynamics.",
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

  // ── 18.4 cn_fiscal_stimulus — Statutory Fiscal Stimulus Law (财政刺激法) ───────────────
  {
    _id: "cn_fiscal_stimulus",
    countryScope: "cn",
    name: "Statutory Fiscal Stimulus Law",
    description:
      "Sets the framework for central-government cyclical stimulus and 专项债 (special bonds) issuance",
    explanation:
      "财政刺激 (fiscal stimulus) is deployed via 专项债 (special bonds), central-government infrastructure spending, and provincial transfer increases. Used periodically to counteract growth shocks (real-estate downturns, export collapses). Reform debates focus on stimulus scale and target sectors. Sensitive to local-government debt overhang and 双碳 (Dual Carbon) framing for green-investment-led stimulus.",
    policyDomain: "economic",
    subCategory: "Fiscal stimulus",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.7 },
      { metricCategoryId: "governance", metricId: "debtToGdp", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Finance and Economics"),
    policyOptions: policyOptions(
      "cn_fiscal_stimulus",
      [
        {
          name: "Maximum Stimulus Law",
          explanation:
            "_最大刺激法_ — Massive central-government deficit-spending program funding infrastructure, public housing, green energy, and provincial transfers via expanded 专项债 (special bond) issuance.",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Green Investment Surge Law",
          explanation:
            "_绿色投资增长法_ — Substantial fiscal expansion concentrated on 双碳 (Dual Carbon)-aligned investments: renewable energy infrastructure, EV manufacturing capacity, urban transit upgrades.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Infrastructure Stimulus Law",
          explanation:
            "_基建刺激法_ — Substantially raise central-government infrastructure spending via 专项债 (special bonds), accelerate high-speed rail and 5G expansion, retain provincial-debt management discipline.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Fiscal Stimulus Law",
          explanation:
            "_财政刺激基本法_ — Maintain cyclical-adjustment authority with moderate 专项债 (special bond) issuance and balanced infrastructure-vs-debt-management priorities.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Fiscal Restraint Law",
          explanation:
            "_财政节制法_ — Reduce central-government deficit-spending ambition, restrict 专项债 (special bond) issuance growth, prioritize provincial-debt reduction over new stimulus.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Sound Money Law",
          explanation:
            "_稳健货币法_ — Tighten fiscal discipline, end deficit-funded infrastructure expansion, hand growth concerns to monetary-policy lever.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Austerity Law",
          explanation:
            "_紧缩法_ — Eliminate counter-cyclical fiscal stimulus entirely, prioritize debt-paydown, accept slower short-term growth in exchange for debt-burden reduction.",
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

  // ═══════════════════════════════════════════════════════════════════════════
  //   §19 Infrastructure (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 19.1 cn_rail_transport — Statutory Rail Transport Law (铁路法) ─────────────────────
  {
    _id: "cn_rail_transport",
    countryScope: "cn",
    name: "Statutory Rail Transport Law",
    description:
      "Sets central funding for HSR network expansion and 中国国铁 (China Railway Corporation) operations",
    explanation:
      "China operates the world's largest high-speed rail network (~45,000 km) under 中国国铁 (China Railway Corporation). The network connects most cities with populations above 500k. Reform debates focus on continued network expansion vs route-saturation, urban metro expansion, freight-rail modernization, and 一带一路 (Belt and Road) cross-border rail integration. Sensitive to local-government rail debt overhang.",
    policyDomain: "infrastructure",
    subCategory: "Rail transport",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "transportEfficiency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "transportEfficiency", weight: 1.0 },
      { metricCategoryId: "infrastructure", metricId: "publicTransit", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Transportation and Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_rail_transport",
        [
          {
            name: "Maximum Rail Network Law",
            explanation:
              "_最大铁路网络法_ — Double the high-speed rail network to all county-seat cities, full urban-metro expansion in Tier-3 cities, dedicated freight-rail corridors, full 一带一路 (Belt and Road) cross-border integration.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Rail Expansion Acceleration Law",
            explanation:
              "_铁路扩张加速法_ — Substantially expand HSR network to all prefecture-level cities, urban metro to Tier-2 cities, freight-rail electrification across major corridors.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Western Rail Equalization Law",
            explanation:
              "_西部铁路均等化法_ — Direct infrastructure transfers to Western and interior provinces, build HSR connectivity to underserved Northwest cities, expand urban transit in interior centers.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Rail Transport Law",
            explanation:
              "_铁路基本法_ — Maintain HSR network growth at steady pace with selective Tier-3 city additions and balanced freight-rail modernization.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Rail Consolidation Reform Law",
            explanation:
              "_铁路整合改革法_ — Slow HSR expansion, focus capital on existing-network maintenance and freight-rail modernization, halt expansion to low-density routes.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Rail Investment Law",
            explanation:
              "_民营铁路投资法_ — Open passenger rail to private capital, liberalize ticket pricing, reduce 中国国铁 (China Railway Corporation) operational subsidies.",
            stance: "right",
            economic: 3,
            social: 1,
          },
          {
            name: "Rail Privatization Law",
            explanation:
              "_铁路私有化法_ — Privatize passenger rail operations, end state HSR construction subsidies, transition freight rail to market-based pricing and private investment.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [1500, 1200, 900, 600, 300, 150, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 19.2 cn_digital_infrastructure — Statutory Digital Infrastructure Law (数字基础设施法) ─
  {
    _id: "cn_digital_infrastructure",
    countryScope: "cn",
    name: "Statutory Digital Infrastructure Law",
    description:
      "Sets central funding for 5G, fiber, data centers, and 智慧城市 (smart city) programs",
    explanation:
      "数字基础设施 (digital infrastructure) covers 5G networks, broadband fiber, data centers, and smart-city deployment. China leads globally in 5G base-station deployment and IPv6 adoption. Reform debates focus on continued investment intensity, urban-rural digital-divide bridging, 智慧城市 (smart city) program expansion, and 6G research funding. Strategic-industrial intersection with semiconductor-self-sufficiency framing.",
    policyDomain: "infrastructure",
    subCategory: "Digital infrastructure",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "broadbandAccess", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Transportation and Infrastructure"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_digital_infrastructure",
        [
          {
            name: "Total Digital Infrastructure Law",
            explanation:
              "_全面数字基建法_ — Full 5G coverage to all rural townships, gigabit fiber to every household, fully-funded 6G research program, comprehensive 智慧城市 (smart city) deployment across all prefecture-level cities.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Smart Cities Expansion Law",
            explanation:
              "_智慧城市扩展法_ — Substantially expand 智慧城市 (smart city) deployment to Tier-2 and Tier-3 cities, accelerate 5G coverage in rural areas, expand IPv6 transition mandates.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Rural Connectivity Bridge Law",
            explanation:
              "_农村互联互通桥接法_ — Direct subsidies for rural broadband fiber deployment, eliminate urban-rural connectivity gap in interior provinces, expand 5G to all township seats.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Digital Infrastructure Law",
            explanation:
              "_数字基础设施基本法_ — Maintain 5G network growth at steady pace with balanced urban/rural deployment and selective 智慧城市 (smart city) program expansion.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Targeted Investment Law",
            explanation:
              "_定向投资法_ — Narrow digital-infrastructure investment to commercial-priority sectors, slow rural-coverage expansion, raise commercial-deployment cost-recovery requirements.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Telecom Liberalization Law",
            explanation:
              "_电信民营化法_ — Liberalize private telecom operator entry, end state telecom-operator subsidies, transition 5G expansion to market-led deployment.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Digital Infrastructure Privatization Law",
            explanation:
              "_数字基建私有化法_ — Privatize state telecom carriers, end public-investment digital-infrastructure programs, hand all deployment to market dynamics.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [800, 650, 500, 350, 200, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 19.3 cn_housing — Statutory Housing Policy Law (住房政策法) ───────────────────────
  {
    _id: "cn_housing",
    countryScope: "cn",
    name: "Statutory Housing Policy Law",
    description:
      "Sets the framework for 保障房 (affordable housing) construction and 房住不炒 (houses are for living, not speculation) enforcement",
    explanation:
      "China's housing market underwent decades of state-led development followed by recurring affordability crises. The 保障房 (affordable housing) program targets middle and lower-income households, while 房住不炒 (houses are for living, not speculation) framing shapes recent policy direction. Reform debates focus on the balance between 保障房 expansion, 共有产权 (shared ownership) pilot programs, real-estate-sector deleveraging, and market-led private-housing recovery. Politically central to 共同富裕 (Common Prosperity).",
    policyDomain: "infrastructure",
    subCategory: "Housing",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingAffordability",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 1.0 },
      { metricCategoryId: "social", metricId: "wohnungsBauRate", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Housing and Urban-Rural Development"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_housing",
        [
          {
            name: "Universal Public Housing Law",
            explanation:
              "_全民公共住房法_ — Single-payer public-housing system with state-built 保障房 (affordable housing) for the majority of urban households, eliminate private real-estate speculation entirely, rents capped at income share.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Common Prosperity Housing Expansion Law",
            explanation:
              "_共同富裕住房扩展法_ — Substantially expand 保障房 (affordable housing) construction targets, expand 共有产权 (shared ownership) pilots, tighten anti-speculation enforcement under 房住不炒 (houses are for living, not speculation) framing.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Migrant Worker Housing Bridge Law",
            explanation:
              "_农民工住房桥接法_ — Expand 保障房 (affordable housing) eligibility to migrant workers without 户口 (Hukou) transfer, raise public-rental housing supply in coastal cities.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Housing Policy Law",
            explanation:
              "_住房政策基本法_ — Maintain 房住不炒 (houses are for living, not speculation) framing with balanced 保障房 (affordable housing) construction and private-market real-estate recovery support.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Real Estate Deleveraging Law",
            explanation:
              "_房地产去杠杆法_ — Tighten developer financing rules, accelerate real-estate-sector deleveraging, reduce state 保障房 (affordable housing) construction subsidies.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Housing Recovery Law",
            explanation:
              "_民营住房复苏法_ — Relax 房住不炒 (houses are for living, not speculation) enforcement, ease developer financing restrictions, scale back 保障房 (affordable housing) targets, focus on private-market growth.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Free Housing Market Law",
            explanation:
              "_自由住房市场法_ — End all 保障房 (affordable housing) state programs, abolish purchase restrictions, hand real-estate-sector growth fully to market dynamics.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [1800, 1400, 1000, 600, 300, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §20 Environment & Energy (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 20.1 cn_renewable_energy_target — Statutory Renewable Energy Target Law (可再生能源目标法) ─
  {
    _id: "cn_renewable_energy_target",
    countryScope: "cn",
    name: "Statutory Renewable Energy Target Law",
    description:
      "Sets central funding and targets for renewable-energy deployment and coal phaseout",
    explanation:
      "China leads the world in renewable energy capacity installation — solar PV, onshore wind, and hydropower deployed at scale. The 双碳 (Dual Carbon) framework sets the strategic direction: emissions peak followed by carbon neutrality. Reform debates focus on the pace of renewable deployment, coal-fired generation retirement schedule, and the cost balance between green-energy subsidies and grid stability. Sensitive to provincial economic interests in coal regions.",
    policyDomain: "environment",
    subCategory: "Renewable energy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: 1.0 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.8 },
      { metricCategoryId: "environment", metricId: "energyTransitionProgress", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Environment and Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_renewable_energy_target",
        [
          {
            name: "Maximum Green Transition Law",
            explanation:
              "_最大绿色转型法_ — Total fossil-fuel phaseout within a generation, full state subsidies for renewable deployment to all sectors, mandatory EV adoption targets, fully-funded grid-storage infrastructure under 双碳 (Dual Carbon) framework.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Common Prosperity Green Law",
            explanation:
              "_共同富裕绿色法_ — Substantially raise renewable-deployment subsidies, expand 共同富裕 (Common Prosperity)-aligned green-job transition programs for coal-region workers, accelerate offshore-wind expansion.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Renewable Acceleration Law",
            explanation:
              "_可再生能源加速法_ — Substantially raise renewable-energy capacity targets, expand state subsidies for solar/wind manufacturing and deployment, accelerate coal-plant retirement schedules.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Renewable Energy Target Law",
            explanation:
              "_可再生能源目标基本法_ — Maintain 双碳 (Dual Carbon) trajectory with balanced renewable expansion and coal-plant retirement pacing.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Energy Security Reform Law",
            explanation:
              "_能源安全改革法_ — Slow renewable deployment to prioritize grid stability and coal-fired generation reliability, reduce state subsidies for solar/wind manufacturing.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Market-Led Energy Law",
            explanation:
              "_市场主导能源法_ — Phase out state renewable subsidies, hand green-energy deployment to market price signals, retain only minimal 双碳 (Dual Carbon) targets.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Energy Liberalization Law",
            explanation:
              "_能源自由化法_ — Eliminate all renewable-energy mandates and subsidies, abolish 双碳 (Dual Carbon) framework, allow coal generation to operate without retirement pressure.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "economic"
      ),
      [1400, 1100, 800, 500, 250, 100, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 20.2 cn_nuclear_energy — Statutory Nuclear Energy Law (核能法) ────────────────────
  {
    _id: "cn_nuclear_energy",
    countryScope: "cn",
    name: "Statutory Nuclear Energy Law",
    description:
      "Sets the framework for commercial-nuclear fleet expansion and 华龙一号 deployment",
    explanation:
      "China operates a growing fleet of commercial nuclear reactors and is actively building Generation III/III+ reactors. 华龙一号 (Hualong One) is the indigenously-designed flagship reactor. Reform debates focus on nuclear-deployment pace, location of new plants (coastal vs inland), public-acceptance considerations, and the balance between nuclear and renewable in the low-carbon mix. Strategic-industrial intersection with nuclear-export potential under 一带一路 (Belt and Road).",
    policyDomain: "environment",
    subCategory: "Nuclear energy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.7 },
      { metricCategoryId: "environment", metricId: "nuclearSafety", weight: 0.4 },
      { metricCategoryId: "environment", metricId: "energyTransitionProgress", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Environment and Energy"),
    policyOptions: policyOptions(
      "cn_nuclear_energy",
      [
        {
          name: "Maximum Nuclear State Law",
          explanation:
            "_最大核能国家法_ — Aggressive nuclear-fleet expansion, double the 华龙一号 (Hualong One) reactor deployment rate, build inland nuclear plants beyond coastal sites, fast-track Generation-IV reactor R&D.",
          stance: "left",
          economic: -5,
          social: 1,
        },
        {
          name: "Nuclear Expansion Surge Law",
          explanation:
            "_核能扩张增长法_ — Substantially raise commercial nuclear capacity targets, expand domestic-uranium fuel-cycle investment, accelerate Generation III+ deployment.",
          stance: "left",
          economic: -3,
          social: 1,
        },
        {
          name: "Indigenous Nuclear Reinforcement Law",
          explanation:
            "_自主核能强化法_ — Concentrate nuclear deployment on 华龙一号 (Hualong One) indigenous design, expand state subsidies for Hualong-Two development, raise nuclear-export pipeline under 一带一路 (Belt and Road).",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Nuclear Energy Law",
          explanation:
            "_核能基本法_ — Maintain commercial nuclear-fleet expansion at steady pace with coastal-site priority and incremental indigenous-design substitution.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Cautious Nuclear Law",
          explanation:
            "_谨慎核能法_ — Slow new-plant approvals, prioritize existing-reactor safety and refurbishment, reduce state subsidies for nuclear-export financing.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Nuclear Restraint Law",
          explanation:
            "_核能限制法_ — Pause new nuclear-plant construction approvals, focus on safety review of existing fleet, redirect funds to renewable-grid infrastructure.",
          stance: "right",
          economic: 3,
          social: -1,
        },
        {
          name: "Nuclear Phaseout Law",
          explanation:
            "_核电淘汰法_ — Halt all new nuclear construction, accelerate fleet retirement, transition fully to renewable-and-storage low-carbon mix.",
          stance: "right",
          economic: 5,
          social: -2,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 20.3 cn_emissions_trading_scheme — Statutory ETS Law (碳排放交易法) ────────────────
  {
    _id: "cn_emissions_trading_scheme",
    countryScope: "cn",
    name: "Statutory Emissions Trading Scheme Law",
    description: "Sets the framework for national ETS cap-tightening and sector coverage",
    explanation:
      "China's national 碳排放交易体系 (Emissions Trading Scheme — ETS) covers power-sector emissions and is being expanded to industrials. Carbon prices have remained low relative to EU-ETS benchmark. Reform debates focus on cap-tightening pace, sector-coverage expansion (cement, steel, aluminum), price-floor mechanisms, and integration with 双碳 (Dual Carbon) commitments.",
    policyDomain: "environment",
    subCategory: "Carbon market",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.4 },
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Environment and Energy"),
    policyOptions: policyOptions(
      "cn_emissions_trading_scheme",
      [
        {
          name: "Maximum Carbon Pricing Law",
          explanation:
            "_最大碳定价法_ — High carbon price floor (~¥500/ton), full sector coverage from day one, mandatory ETS participation for all major emitters, aggressive cap-tightening trajectory aligned with peak-emissions timing.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Common Prosperity Carbon Law",
          explanation:
            "_共同富裕碳排放法_ — Substantially raise carbon-price floor (~¥200/ton), expand ETS coverage to cement, steel, aluminum, route revenues to 共同富裕 (Common Prosperity)-aligned regional just-transition fund.",
          stance: "left",
          economic: -1,
          social: 0,
        },
        {
          name: "ETS Expansion Law",
          explanation:
            "_碳排放交易扩展法_ — Expand ETS coverage beyond power sector, raise carbon-price floor moderately, tighten cap trajectory in line with 双碳 (Dual Carbon) targets.",
          stance: "left",
          economic: 0,
          social: 0,
        },
        {
          name: "Statutory Emissions Trading Scheme Law",
          explanation:
            "_碳排放交易基本法_ — Maintain power-sector ETS with incremental coverage expansion to selected industrial subsectors and moderate cap trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Industry Competitiveness Reform Law",
          explanation:
            "_产业竞争力改革法_ — Slow ETS coverage expansion, exempt manufacturing-export sectors from carbon-pricing pressure, reduce cap-tightening pace.",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          name: "Voluntary Carbon Market Law",
          explanation:
            "_自愿碳市场法_ — Transition mandatory ETS to voluntary-market participation, eliminate compulsory caps, restrict scope to power-sector only.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "ETS Abolition Law",
          explanation:
            "_碳交易废止法_ — Eliminate national ETS entirely, abandon carbon-pricing mechanism, route 双碳 (Dual Carbon) compliance through direct regulatory standards only.",
          stance: "right",
          economic: 3,
          social: 1,
        },
      ],
      "economic"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 20.4 cn_climate_targets — Statutory Climate Targets Law (气候目标法) ───────────────
  {
    _id: "cn_climate_targets",
    countryScope: "cn",
    name: "Statutory Climate Targets Law",
    description:
      "Sets the framework for 双碳 (Dual Carbon) emissions-peak and neutrality commitments",
    explanation:
      "China's 双碳 (Dual Carbon) commitments — emissions peak followed by carbon neutrality — frame national climate policy. Reform debates focus on the timing of peak-emissions targets, the neutrality timeline, sector-by-sector decarbonization mandates, and international climate-diplomacy posture under the Paris Agreement framework.",
    policyDomain: "environment",
    subCategory: "Climate targets",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "climateResilience",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "climateResilience", weight: 1.0 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.7 },
      { metricCategoryId: "environment", metricId: "energyTransitionProgress", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "beltAndRoadEngagement", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: npcCommitteePositions("Environment and Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_climate_targets",
        [
          {
            name: "Maximum Climate Mobilization Law",
            explanation:
              "_最大气候动员法_ — Accelerate emissions peak by a decade, neutrality target two decades ahead, comprehensive sector-by-sector decarbonization mandates, full international climate-diplomacy leadership posture.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Common Prosperity Climate Law",
            explanation:
              "_共同富裕气候法_ — Bring forward emissions-peak target, expand 共同富裕 (Common Prosperity)-aligned just-transition fund for coal-region workers, raise decarbonization-sector mandates.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Accelerated Carbon Targets Law",
            explanation:
              "_加速碳目标法_ — Bring forward 双碳 (Dual Carbon) peak-emissions target by several years, raise renewable-energy and EV mandates accordingly, expand state climate-research funding.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Climate Targets Law",
            explanation:
              "_气候目标基本法_ — Maintain 双碳 (Dual Carbon) target trajectory with steady decarbonization-sector mandates and balanced international climate-diplomacy posture.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Climate Restraint Law",
            explanation:
              "_气候节制法_ — Defer 双碳 (Dual Carbon) peak-emissions and neutrality timing, soften sector-by-sector decarbonization mandates, prioritize industrial competitiveness.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Sovereign Energy Law",
            explanation:
              "_主权能源法_ — Abandon binding 双碳 (Dual Carbon) commitments, retain voluntary targets only, prioritize energy-security framing over climate-policy framing.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Climate Withdrawal Law",
            explanation:
              "_气候退出法_ — Withdraw from Paris Agreement framework, eliminate 双碳 (Dual Carbon) targets, abandon binding climate commitments, return to development-priority framing.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "economic"
      ),
      [900, 700, 500, 300, 150, 50, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §22 Immigration & Hukou (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 22.1 cn_hukou_reform — Statutory Hukou Reform Law (户籍制度改革法) ─────────────────
  {
    _id: "cn_hukou_reform",
    countryScope: "cn",
    name: "Statutory Hukou Reform Law",
    description: "Sets the framework for 户口 (Hukou) registration and inter-region mobility",
    explanation:
      "The 户口 (Hukou) household registration system ties social services (medical, education, housing) to provincial registration. Migrant workers (~300M) lack urban services in their workplace cities. Reform debates run from comprehensive elimination through targeted tier-city liberalization toward maintaining strict urban-quota controls. Sensitive intersection with urban-rural inequality, 共同富裕 (Common Prosperity) framing, and 流动人口 (migrant population) integration.",
    policyDomain: "immigration",
    subCategory: "Hukou reform",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "hukouMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "hukouMobility", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: 0.3 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 0.4 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      // Relaxing hukou frees rural→urban movement → urbanizationRate driver (§4.6).
      // Positive weight: liberalizing registration (left) raises urbanization.
      { metricCategoryId: "population", metricId: "urbanizationRate", weight: 0.3 },
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Internal Affairs"),
    policyOptions: policyOptions(
      "cn_hukou_reform",
      [
        {
          name: "Hukou Abolition Law",
          explanation:
            "_户籍废止法_ — Eliminate the 户口 (Hukou) registration system entirely, decouple all social services from provincial registration, full national portability of medical/education/pension entitlements.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "Common Prosperity Hukou Expansion Law",
          explanation:
            "_共同富裕户籍扩展法_ — Substantially eliminate tier-1 and tier-2 city Hukou restrictions, automatic 户口 (Hukou) transfer for stable-employment migrant workers, equalize migrant-worker service access.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Migrant Worker Integration Law",
          explanation:
            "_农民工融入法_ — Expand point-based 户口 (Hukou) transfer eligibility to tier-1 cities for stable-employment migrants, equalize migrant-worker children's education access.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Hukou Reform Law",
          explanation:
            "_户籍制度改革基本法_ — Maintain incremental tier-city 户口 (Hukou) liberalization with point-based transfer system and steady migrant-worker service expansion.",
          stance: "center",
          economic: 0,
          social: -1,
        },
        {
          name: "Hukou Discipline Reinforcement Law",
          explanation:
            "_户籍纪律强化法_ — Tighten tier-1 city 户口 (Hukou) transfer requirements, restrict migrant-worker service access to formal-employment categories, freeze further liberalization.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Strict Hukou Enforcement Law",
          explanation:
            "_严格户籍执行法_ — Reverse recent 户口 (Hukou) liberalization, restrict urban service access strictly to registered residents, tighten enforcement of unregistered-resident penalties.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Traditional Hukou Restoration Law",
          explanation:
            "_传统户籍恢复法_ — Restore comprehensive 户口 (Hukou) controls, prohibit informal migration to tier-1 cities, frame internal migration as exception requiring central approval.",
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

  // ── 22.2 cn_skilled_immigration — Statutory Foreign Talent Law (外国人才法) ────────────
  {
    _id: "cn_skilled_immigration",
    countryScope: "cn",
    name: "Statutory Foreign Talent Law",
    description:
      "Sets the framework for 千人计划 (Thousand Talents) talent attraction and foreign-expert visas",
    explanation:
      "The 千人计划 (Thousand Talents) program and R-visa for foreign experts target high-skilled talent attraction. Reform debates focus on visa-pipeline expansion for high-skilled foreigners, foreign-degree recognition, and balance with 反间谍法 (Anti-Espionage Law) scrutiny of foreign academics. Sensitive intersection with US-China decoupling pressures.",
    policyDomain: "immigration",
    subCategory: "Foreign talent",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "education", metricId: "workforceSkill", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.7 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.5 },
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: -0.3 },
      // Foreign-talent inflow is a migration inflow → migrationRate driver (§4.6).
      // Positive weight: opening talent visas (left) raises net migration.
      { metricCategoryId: "population", metricId: "migrationRate", weight: 0.4 },
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Internal Affairs"),
    policyOptions: policyOptions(
      "cn_skilled_immigration",
      [
        {
          name: "Maximum Foreign Talent Law",
          explanation:
            "_最大外国人才法_ — Open-door visa policy for foreign experts in all priority fields, expedited green-card pathways, 千人计划 (Thousand Talents) expansion to 5,000-talents scale, foreign-degree automatic recognition.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "Talent Attraction Expansion Law",
          explanation:
            "_人才引进扩展法_ — Substantially expand R-visa quotas and 千人计划 (Thousand Talents) scope, raise foreign-faculty positions in universities, expand foreign-headquartered tech-firm permits.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Strategic Talent Pipeline Law",
          explanation:
            "_战略人才引进法_ — Concentrate foreign-talent attraction in semiconductor, biotech, AI sectors, expand visa-streaming for priority Made in China industries.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Foreign Talent Law",
          explanation:
            "_外国人才基本法_ — Maintain 千人计划 (Thousand Talents) pipeline with steady visa-quota growth and balanced security-review process.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Selective Talent Reform Law",
          explanation:
            "_选择性人才改革法_ — Narrow foreign-talent attraction to priority-only sectors, tighten 反间谍法 (Anti-Espionage Law) review of foreign academics, raise visa-renewal scrutiny.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Talent Security Reinforcement Law",
          explanation:
            "_人才安全强化法_ — Restrict foreign-talent visas to non-sensitive sectors, expand security-review denials, scale back 千人计划 (Thousand Talents) state funding.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Foreign Talent Restriction Law",
          explanation:
            "_外国人才限制法_ — End 千人计划 (Thousand Talents) program, restrict foreign academic positions to non-strategic disciplines, frame foreign talent as security risk.",
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

  // ── 22.3 cn_diaspora_engagement — Statutory Diaspora Engagement Law (海外华人法) ───────
  {
    _id: "cn_diaspora_engagement",
    countryScope: "cn",
    name: "Statutory Diaspora Engagement Law",
    description:
      "Sets the framework for 华侨 (overseas Chinese) outreach and 统战部 (United Front Work Department) engagement",
    explanation:
      "华侨 (overseas Chinese) and 华人 (ethnic Chinese citizens abroad) total ~50M globally. Policy framework runs through 统战部 (United Front Work Department) and 国侨办 (Overseas Chinese Affairs Office). Reform debates focus on engagement-program scope, 港澳 (Hong Kong-Macao) integration, dual-citizenship recognition framework, and 反外国制裁法 (Anti-Foreign-Sanctions Law) intersection with overseas Chinese.",
    policyDomain: "immigration",
    subCategory: "Diaspora engagement",
    nationalOnly: true,
    // RETARGET (Spec B, ex-Spec A): diaspora engagement is a soft-power/prestige
    // lever → nationalPride, not beltAndRoadEngagement (windowed 2013).
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "nationalPride",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "nationalPride", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 0.4 },
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Internal Affairs"),
    policyOptions: policyOptions(
      "cn_diaspora_engagement",
      [
        {
          name: "Maximum Diaspora Mobilization Law",
          explanation:
            "_最大侨胞动员法_ — Comprehensive 统战部 (United Front Work Department) engagement program for all 华侨 (overseas Chinese), mandatory diaspora-business registration, recognize dual-citizenship for overseas Chinese under specific conditions.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Diaspora Investment Expansion Law",
          explanation:
            "_华侨投资扩展法_ — Substantially expand 国侨办 (Overseas Chinese Affairs Office) investment-channeling programs, prioritize diaspora capital in Made in China and 一带一路 (Belt and Road) priorities.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "United Front Reinforcement Law",
          explanation:
            "_统战强化法_ — Concentrate 统战部 (United Front Work Department) resources on key diaspora communities, expand cultural-and-Mandarin instruction programs abroad.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Diaspora Engagement Law",
          explanation:
            "_海外华人基本法_ — Maintain 国侨办 (Overseas Chinese Affairs Office) engagement pipeline with steady 统战部 (United Front Work Department) program scope and balanced diaspora-investment programs.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Diaspora Independence Reform Law",
          explanation:
            "_华侨独立改革法_ — Narrow 国侨办 (Overseas Chinese Affairs Office) scope to passport/visa services, reduce 统战部 (United Front Work Department) diaspora engagement, raise diaspora-self-determination framing.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Diaspora Disengagement Law",
          explanation:
            "_华侨脱离法_ — Roll back 统战部 (United Front Work Department) diaspora programs, restrict diaspora-investment incentives, focus on consular services only.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Diaspora Sovereignty Recognition Law",
          explanation:
            "_华侨主权承认法_ — Recognize overseas Chinese as fully sovereign in their host countries, end all 统战部 (United Front Work Department) engagement, treat diaspora purely as foreign citizens.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §23 Agriculture (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 23.1 cn_agricultural_subsidies — Statutory Agricultural Subsidies Law (农业补贴法) ─
  {
    _id: "cn_agricultural_subsidies",
    countryScope: "cn",
    name: "Statutory Agricultural Subsidies Law",
    description: "Sets the framework for 三农 (three rural) farm subsidies and direct payments",
    explanation:
      "Agricultural subsidies (农业补贴) cover grain production support, fertilizer subsidies, machinery purchases, and 三农 (three rural — agriculture, rural areas, farmers) framework programs. Reform debates focus on subsidy scale and targeting, balance between price-support and direct-payment models, and integration with 粮食安全 (food security) and 乡村振兴 (rural revitalization) objectives.",
    policyDomain: "agriculture",
    subCategory: "Agricultural subsidies",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: 0.4 },
    ],
    positions: npcCommitteePositions("Agriculture and Rural Affairs"),
    policyOptions: policyOptions(
      "cn_agricultural_subsidies",
      [
        {
          name: "Total Agricultural Support Law",
          explanation:
            "_全面农业支持法_ — Massive direct-payment program covering all grain and oil-seed farmers, full fertilizer and machinery subsidies, fully-funded crop-insurance program under 三农 (three rural) framework.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Common Prosperity Farm Expansion Law",
          explanation:
            "_共同富裕农业扩展法_ — Substantially raise direct-payment subsidies, expand 共同富裕 (Common Prosperity)-aligned rural-revitalization transfers, raise fertilizer-and-machinery subsidy ceiling.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Targeted Rural Subsidy Law",
          explanation:
            "_定向农业补贴法_ — Concentrate subsidies on grain-producing core regions, expand machinery-modernization grants, raise minimum-price support floor.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Agricultural Subsidies Law",
          explanation:
            "_农业补贴基本法_ — Maintain 三农 (three rural) subsidy framework with balanced direct-payment, fertilizer, and crop-insurance support.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Subsidy Reform Law",
          explanation:
            "_补贴改革法_ — Narrow agricultural subsidies to grain-security priorities only, reduce fertilizer-subsidy intensity, raise market-mechanism reliance.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market Agricultural Law",
          explanation:
            "_农业市场化法_ — Phase out broad subsidies, retain only minimal grain-security backstop, end direct-payment programs, hand sector growth to market signals.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Agricultural Liberalization Law",
          explanation:
            "_农业自由化法_ — Eliminate all agricultural subsidies, abolish minimum-price support, transition fully to market-led agricultural economy.",
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

  // ── 23.2 cn_food_security — Statutory Food Security Law (粮食安全法) ───────────────────
  {
    _id: "cn_food_security",
    countryScope: "cn",
    name: "Statutory Food Security Law",
    description:
      "Sets the framework for grain self-sufficiency and 耕地红线 (arable-land) protection",
    explanation:
      "粮食安全 (food security) is a strategic priority anchored in the principle of grain self-sufficiency. Reform debates focus on grain-stockpile policy, 耕地红线 (arable-land red-line) protection, GMO crop authorization, and import-dependence mitigation through 一带一路 (Belt and Road) supply diversification.",
    policyDomain: "agriculture",
    subCategory: "Food security",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.4 },
    ],
    positions: npcCommitteePositions("Agriculture and Rural Affairs"),
    policyOptions: policyOptions(
      "cn_food_security",
      [
        {
          name: "Maximum Self-Sufficiency Law",
          explanation:
            "_最大自给自足法_ — Total grain self-sufficiency mandate, full state grain-stockpile expansion, comprehensive 耕地红线 (arable-land red-line) enforcement, eliminate grain-import dependence under 粮食安全 (food security) framework.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Strategic Stockpile Expansion Law",
          explanation:
            "_战略储备扩展法_ — Substantially raise state grain-stockpile targets, expand domestic-production capacity through irrigation and seed-tech investment, restrict grain imports to non-strategic categories.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Arable Land Protection Law",
          explanation:
            "_耕地保护法_ — Strict enforcement of 耕地红线 (arable-land red-line), restrict land-conversion to non-agricultural use, expand seed-development R&D.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Food Security Law",
          explanation:
            "_粮食安全基本法_ — Maintain 粮食安全 (food security) framework with steady stockpile management, balanced import-substitution, and incremental 耕地 (arable land) protection.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Open Agricultural Markets Law",
          explanation:
            "_开放农产品市场法_ — Liberalize agricultural imports for non-strategic categories, soften 耕地红线 (arable-land red-line) enforcement, raise market-based grain pricing.",
          stance: "right",
          economic: 1,
          social: -1,
        },
        {
          name: "Agricultural Trade Liberalization Law",
          explanation:
            "_农产品贸易自由化法_ — Substantially expand agricultural imports, end strategic stockpile expansion, recognize comparative-advantage logic in grain sourcing.",
          stance: "right",
          economic: 2,
          social: -2,
        },
        {
          name: "Free Agricultural Trade Law",
          explanation:
            "_自由农产品贸易法_ — Eliminate all import restrictions on agricultural products, abandon strategic self-sufficiency framing, transition fully to market-based food sourcing.",
          stance: "right",
          economic: 3,
          social: -5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 23.3 cn_rural_revitalization — Statutory Rural Revitalization Law (乡村振兴法) ─────
  {
    _id: "cn_rural_revitalization",
    countryScope: "cn",
    name: "Statutory Rural Revitalization Law",
    description: "Sets the framework for 乡村振兴 (rural revitalization) program scope and funding",
    explanation:
      "乡村振兴 (rural revitalization) is the framework for closing rural-urban gaps in income, infrastructure, education, healthcare, and culture. Reform debates focus on program scale, target sectors (agriculture modernization vs cultural preservation vs rural-tourism), and integration with 共同富裕 (Common Prosperity) framework.",
    policyDomain: "agriculture",
    subCategory: "Rural revitalization",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Agriculture and Rural Affairs"),
    policyOptions: policyOptions(
      "cn_rural_revitalization",
      [
        {
          name: "Total Rural Mobilization Law",
          explanation:
            "_全面乡村动员法_ — Massive rural-investment program covering infrastructure, education, healthcare, and cultural preservation, full 共同富裕 (Common Prosperity)-aligned rural-urban gap-closure mandate.",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Rural Revitalization Acceleration Law",
          explanation:
            "_乡村振兴加速法_ — Substantially expand 乡村振兴 (rural revitalization) funding, raise rural-infrastructure investment, expand rural healthcare and education resource transfers.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Rural Industry Promotion Law",
          explanation:
            "_乡村产业促进法_ — Concentrate rural-revitalization funding on agricultural modernization, rural-tourism development, and 数字乡村 (digital villages) program expansion.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Rural Revitalization Law",
          explanation:
            "_乡村振兴基本法_ — Maintain 乡村振兴 (rural revitalization) framework with steady infrastructure and service-equalization funding pace.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Targeted Rural Investment Law",
          explanation:
            "_定向乡村投资法_ — Narrow rural-revitalization funding to highest-priority gap-closure projects, raise private-investment matching requirements, slow universal-program rollout.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market Rural Reform Law",
          explanation:
            "_乡村市场改革法_ — Phase out state-led rural-revitalization programs, hand rural development to market-led real-estate and agricultural-investment dynamics.",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Rural Market Sovereignty Law",
          explanation:
            "_乡村市场自主法_ — End 乡村振兴 (rural revitalization) framework, eliminate rural-development subsidies, allow rural-urban migration to proceed without state intervention.",
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

  // ═══════════════════════════════════════════════════════════════════════════
  //   §24 Governance (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 24.1 cn_anticorruption_campaign — Statutory Anti-Corruption Campaign Law (反腐法) ──
  {
    _id: "cn_anticorruption_campaign",
    countryScope: "cn",
    name: "Statutory Anti-Corruption Campaign Law",
    description:
      "Sets the framework for 中央纪委 (CCDI) campaign intensity and 双开 (dual expulsion) enforcement",
    explanation:
      "The 反腐 (anti-corruption) campaign has been a defining feature of Xi-era CCP governance, run through 中央纪委 (Central Commission for Discipline Inspection — CCDI) and 国家监察委员会 (National Supervisory Commission). The 双开 (dual expulsion — Party and government) mechanism removes officials at all levels. Reform debates focus on campaign intensity, target scope (corruption only vs broader ideological compliance), and rule-of-law institutionalization.",
    policyDomain: "governance",
    subCategory: "Anti-corruption",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "partyDiscipline",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "corruptionIndex", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
    ],
    positions: npcCommitteePositions("Discipline and Oversight"),
    policyOptions: policyOptions(
      "cn_anticorruption_campaign",
      [
        {
          name: "Comprehensive Anti-Corruption Mobilization Law",
          explanation:
            "_全面反腐动员法_ — Massive expansion of 中央纪委 (CCDI) and 国家监察委员会 (National Supervisory Commission) personnel, comprehensive 双开 (dual expulsion) framework for all corruption-related offenses, broaden scope to ideological-compliance violations.",
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Anti-Corruption Surge Law",
          explanation:
            "_反腐增长法_ — Substantially raise 反腐 (anti-corruption) campaign intensity at all administrative levels, expand state-asset audit programs, intensify 双开 (dual expulsion) enforcement.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Disciplinary Reinforcement Law",
          explanation:
            "_纪律强化法_ — Concentrate 中央纪委 (CCDI) resources on senior-cadre cases, expand random-audit programs for SOE leadership, raise transparency in 双开 (dual expulsion) case rationales.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory Anti-Corruption Campaign Law",
          explanation:
            "_反腐基本法_ — Maintain 反腐 (anti-corruption) campaign intensity with steady CCDI staffing and balanced 双开 (dual expulsion) enforcement framework.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Rule-of-Law Reform Law",
          explanation:
            "_法治改革法_ — Narrow anti-corruption activity to formal-legal channels, raise CCDI procedural-rights standards, transition from campaign-style to institutional rule-of-law enforcement.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Anti-Corruption Restraint Law",
          explanation:
            "_反腐节制法_ — Roll back 反腐 (anti-corruption) campaign intensity, narrow scope to highest-priority corruption cases only, end administrative-pressure framing.",
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Anti-Corruption Withdrawal Law",
          explanation:
            "_反腐退出法_ — End campaign-style 反腐 (anti-corruption) framework, restrict CCDI to routine procedural enforcement, treat corruption as rule-of-law issue managed via courts.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "social"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 24.2 cn_npc_reform — Statutory NPC Reform Law (人民代表大会改革法) ────────────────
  {
    _id: "cn_npc_reform",
    countryScope: "cn",
    name: "Statutory NPC Reform Law",
    description:
      "Sets the framework for NPC delegate-selection, committee authority, and transparency",
    explanation:
      "The 全国人民代表大会 (National People's Congress — NPC) is the supreme legislative body, with the NPC Standing Committee handling year-round legislative work. 政协 (CPPCC) sits in advisory capacity. Reform debates focus on NPC delegate-selection mechanisms, Standing Committee scope and authority, role of independent NPC committees, and 党的领导 (Party leadership) integration. Sensitive to broader political-reform considerations.",
    policyDomain: "governance",
    subCategory: "Legislative reform",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.3 },
    ],
    positions: npcCommitteePositions("Constitutional and Legal Affairs"),
    policyOptions: policyOptions(
      "cn_npc_reform",
      [
        {
          name: "Comprehensive NPC Modernization Law",
          explanation:
            "_全面人大现代化法_ — Substantially expand independent NPC committee authority, raise NPC delegate-selection competitiveness, mandate transparent legislative proceedings with live broadcast, raise minimum-quorum requirements for major bills.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "NPC Authority Expansion Law",
          explanation:
            "_人大权限扩展法_ — Substantially expand NPC Standing Committee legislative oversight, raise NPC committee research-and-investigation authority, expand independent budget-review powers.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Procedural Transparency Law",
          explanation:
            "_程序透明法_ — Mandate public-record legislative-vote disclosure, expand NPC hearing transparency for major bills, raise civic-petition response standards.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory NPC Reform Law",
          explanation:
            "_人大改革基本法_ — Maintain NPC Standing Committee primacy with incremental committee-procedure refinement and balanced 党的领导 (Party leadership) oversight.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Standing Committee Reinforcement Law",
          explanation:
            "_常委会强化法_ — Concentrate legislative authority in NPC Standing Committee, narrow independent-committee authority, raise 党的领导 (Party leadership) integration.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "NPC Discipline Reinforcement Law",
          explanation:
            "_人大纪律强化法_ — Tighten NPC delegate-selection vetting, raise discipline requirements for delegate participation, restrict independent-investigation authority.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Centralized Legislative Authority Law",
          explanation:
            "_集中立法权法_ — Centralize all major legislative authority under 党中央 (Party Central) and State Council, reduce NPC plenary scope to ceremonial approval, end committee-level investigation framework.",
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

  // ── 24.3 cn_hk_macao_affairs — Statutory HK-Macao Affairs Law (港澳事务法) ─────────────
  {
    _id: "cn_hk_macao_affairs",
    countryScope: "cn",
    name: "Statutory HK-Macao Affairs Law",
    description: "Sets the framework for 一国两制 (One Country, Two Systems) policy direction",
    explanation:
      '港澳事务 (Hong Kong-Macao affairs) operate under 一国两制 (One Country, Two Systems) framework. The 国家安全法 (National Security Law) and electoral-system overhauls have tightened HK integration with mainland. Reform debates focus on the balance between "Two Systems" autonomy preservation and "One Country" integration acceleration, sensitivity to international financial-center status, and Taiwan-precedent implications.',
    policyDomain: "governance",
    subCategory: "HK-Macao affairs",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "taiwanStraitTension",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "taiwanStraitTension", weight: -0.6 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "beltAndRoadEngagement", weight: -0.3 },
    ],
    positions: npcCommitteePositions("HK-Macao-Taiwan Affairs"),
    policyOptions: policyOptions(
      "cn_hk_macao_affairs",
      [
        {
          name: "Full Integration Law",
          explanation:
            '_全面融合法_ — Comprehensive mainland-HK integration with full administrative equivalence, end "Two Systems" framing in policy communications, mandate Mandarin instruction parity in HK schools, integrate HK financial regulation under PBOC and CSRC.',
          stance: "left",
          economic: -2,
          social: 5,
        },
        {
          name: "Accelerated Integration Law",
          explanation:
            "_加速融合法_ — Substantially raise mainland-HK administrative integration pace, expand 国家安全法 (National Security Law) enforcement scope, tighten HK media regulation.",
          stance: "left",
          economic: -1,
          social: 3,
        },
        {
          name: "Security Reinforcement Law",
          explanation:
            "_安全强化法_ — Strengthen 国家安全法 (National Security Law) enforcement against pro-independence actors, expand electoral-system overhaul to district-level positions.",
          stance: "left",
          economic: 0,
          social: 2,
        },
        {
          name: "Statutory HK-Macao Affairs Law",
          explanation:
            "_港澳事务基本法_ — Maintain 一国两制 (One Country, Two Systems) framework with steady 国家安全法 (National Security Law) enforcement and balanced HK financial-autonomy preservation.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Two Systems Reaffirmation Law",
          explanation:
            "_两制重申法_ — Restore HK administrative-autonomy framing, narrow 国家安全法 (National Security Law) enforcement to highest-priority cases, expand HK financial-regulator independence.",
          stance: "right",
          economic: 0,
          social: -1,
        },
        {
          name: "Autonomy Restoration Law",
          explanation:
            '_自治恢复法_ — Roll back recent 国家安全法 (National Security Law) enforcement expansions, restore prior electoral framework partial elements, reaffirm HK financial-center status under "Two Systems".',
          stance: "right",
          economic: 0,
          social: -3,
        },
        {
          name: "Full Two Systems Restoration Law",
          explanation:
            "_全面两制恢复法_ — Restore comprehensive HK administrative autonomy, deprioritize 国家安全法 (National Security Law) enforcement against political dissent, treat 一国两制 (One Country, Two Systems) as binding strict separation.",
          stance: "right",
          economic: 0,
          social: -5,
        },
      ],
      "both"
    ),
    source: "seed",
    isPermanent: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //   §28 Media (PR4)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 28.1 cn_state_media_funding — Statutory State Media Funding Law (国家媒体经费法) ───
  {
    _id: "cn_state_media_funding",
    countryScope: "cn",
    name: "Statutory State Media Funding Law",
    description: "Sets central funding for CCTV, Xinhua, People's Daily, and CGTN",
    explanation:
      "State media is anchored by CCTV (中央电视台), Xinhua News Agency (新华社), People's Daily (人民日报), and CGTN (China Global Television Network). Domestic media operates under 国家广电总局 (State Administration of Radio, Film, and Television — SARFT) regulation. International broadcasting expands under CGTN. Reform debates focus on funding scale, programming-direction balance, commercial-content vs ideological-content priorities, and CGTN's international footprint expansion.",
    policyDomain: "mediaInformation",
    subCategory: "State media",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "partyDiscipline",
      scope: "national",
    },
    effectTargetsWeighted: [
      // P6a reconcile: CCP-line media funding IS state media control (negative
      // weight: left direction → control UP).
      { metricCategoryId: "mediaInformation", metricId: "stateMediaControl", weight: -0.7 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.6 },
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: -0.5 },
      { metricCategoryId: "mediaInformation", metricId: "mediaPolarization", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.1 },
    ],
    positions: npcCommitteePositions("Culture and Media"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_state_media_funding",
        [
          {
            name: "Maximum State Media Mobilization Law",
            explanation:
              "_最大国家媒体动员法_ — Massive expansion of CCTV (中央电视台), Xinhua (新华社), People's Daily (人民日报), and CGTN funding, comprehensive 国家广电总局 (SARFT) regulatory enforcement on commercial media, mandate state-content quotas across all media platforms.",
            stance: "left",
            economic: -5,
            social: 2,
          },
          {
            name: "State Media Acceleration Law",
            explanation:
              "_国家媒体加速法_ — Substantially expand state-media programming budgets, raise CGTN international-broadcasting capacity, expand 国家广电总局 (SARFT) commercial-content review framework.",
            stance: "left",
            economic: -3,
            social: 1,
          },
          {
            name: "Strategic Media Reinforcement Law",
            explanation:
              "_战略媒体强化法_ — Concentrate state-media funding on CGTN international footprint and 新华社 (Xinhua) digital expansion, raise commercial-content ideological-compliance requirements.",
            stance: "left",
            economic: -2,
            social: 1,
          },
          {
            name: "Statutory State Media Funding Law",
            explanation:
              "_国家媒体经费基本法_ — Maintain state-media funding framework with steady CCTV/Xinhua/People's Daily/CGTN budgets and balanced commercial-content review.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "State Media Reform Law",
            explanation:
              "_国家媒体改革法_ — Narrow state-media funding to highest-priority CCTV and 新华社 (Xinhua) functions, raise commercial-revenue requirements for state outlets, soften 国家广电总局 (SARFT) enforcement on private media.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Commercial Media Expansion Law",
            explanation:
              "_商业媒体扩展法_ — Phase out state-media direct subsidies, hand domestic media to commercial-revenue funding, end state-content quota framework.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Media Privatization Law",
            explanation:
              "_媒体私有化法_ — Privatize state-media holdings (excluding national-security broadcasters), abolish 国家广电总局 (SARFT) content-quota framework, transition to fully commercial-media market.",
            stance: "right",
            economic: 5,
            social: -1,
          },
        ],
        "both"
      ),
      [600, 480, 360, 240, 120, 60, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 28.2 cn_press_freedom — Statutory Press Freedom Law (新闻自由法) ───────────────────
  // Directional note: this type inverts the typical CN convention.
  // Rightward shifts = stricter state control (less press freedom).
  // Leftward shifts = expanded press freedom and journalist protections.
  // Matches player-intuitive interpretation of "press freedom" as the policy outcome.
  {
    _id: "cn_press_freedom",
    countryScope: "cn",
    name: "Statutory Press Freedom Law",
    description:
      "Sets the framework for journalist rights and 国家保密法 (State Secrets Law) enforcement scope",
    explanation:
      "新闻自由 (press freedom) in China is constrained by Party-discipline framework on journalists, foreign-correspondent visa-pressure, 国家保密法 (State Secrets Law) enforcement scope, and 网信办 (Cyberspace Administration) content controls on commercial outlets. International press-freedom rankings consistently rate China low. Reform debates focus on direction — substantially relaxing constraints, holding the line, or further tightening controls. (Directional note: rightward shifts = stricter control; leftward shifts = expanded press freedom.)",
    policyDomain: "mediaInformation",
    subCategory: "Press freedom",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "corruptionIndex", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "governance" as const, metricId: "nationalPride", weight: -0.4 },
    ],
    positions: npcCommitteePositions("Culture and Media"),
    policyOptions: policyOptions(
      "cn_press_freedom",
      [
        {
          name: "Maximum Press Freedom Law",
          explanation:
            "_最大新闻自由法_ — Comprehensive journalist-rights framework with criminal penalties for retaliation against reporters, full foreign-correspondent visa-access framework, narrow 国家保密法 (State Secrets Law) scope to genuine national-security categories only, end Party-discipline framework on journalists.",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Press Liberalization Expansion Law",
          explanation:
            "_新闻自由扩展法_ — Substantially expand journalist legal-protection framework, raise foreign-correspondent visa quotas, soften 网信办 (Cyberspace Administration) content controls on commercial outlets.",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "Journalist Protection Law",
          explanation:
            "_记者保护法_ — Strengthen journalist legal-protections framework, narrow 国家保密法 (State Secrets Law) enforcement to specific national-security categories, expand foreign-correspondent visa pipeline.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Press Freedom Law",
          explanation:
            "_新闻自由基本法_ — Maintain press-freedom framework with steady journalist-registration requirements and balanced 国家保密法 (State Secrets Law) enforcement.",
          stance: "center",
          economic: 0,
          social: 1,
        },
        {
          name: "Journalist Discipline Reinforcement Law",
          explanation:
            "_记者纪律强化法_ — Tighten journalist-registration requirements, raise Party-discipline framework on commercial outlets, expand 网信办 (Cyberspace Administration) content controls.",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Press Discipline Expansion Law",
          explanation:
            "_新闻纪律扩展法_ — Substantially expand 国家保密法 (State Secrets Law) enforcement scope, restrict foreign-correspondent visa access, intensify Party-discipline framework.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Maximum Press Discipline Law",
          explanation:
            "_最大新闻纪律法_ — Comprehensive 国家保密法 (State Secrets Law) framework expansion, mandatory state-licensing for all journalists, end foreign-correspondent independent reporting framework.",
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

  // ═══════════════════════════════════════════════════════════════════════════
  //   §29 Provincial LARP Tables (PR5) — 5 non-tax provincial types
  //   All use allowedScope: "state" and peoplesCongressCommitteePositions.
  //   cn_provincial_resource_tax already drafted in §2.9 (PR1 tax catalogue).
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 29.1 cn_provincial_education — Provincial Education Law (省级教育法) ──────────────
  {
    _id: "cn_provincial_education",
    countryScope: "cn",
    name: "Provincial Education Law",
    description: "Sets provincial-level K-12 funding and 高考 (Gaokao) preparation programs",
    explanation:
      "Provincial Departments of Education set K-12 curriculum delivery, teacher pay, and provincial-level 高考 (Gaokao) preparation programs. Provincial-level reform debates focus on per-pupil spending equalization within provinces, urban-rural school staffing, and balance with national education-policy mandates.",
    policyDomain: "education",
    budgetCategory: "education",
    subCategory: "Provincial education",
    allowedScope: "state",
    effectTarget: { metricCategoryId: "education", metricId: "educationSpending", scope: "state" },
    // §4.7 (P2a) sweep, applied here for ticket #826 item 14: testPerformance
    // and workforceSkill are engine-derived, spend-channel-driven readouts —
    // this law's educationSpending push already drives them via the channel,
    // so a direct weighted push here double-counts (same fix as
    // us_state_education_funding/us_federal_education_funding).
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "educationSpending", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "commonProsperityIndex", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: peoplesCongressCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_education",
        [
          {
            name: "Universal Provincial Education Law",
            explanation:
              "_全民省级教育法_ — Free provincial K-12 education with vouchers covering private-school equivalents, free provincial-tier 高考 (Gaokao) preparation, fully-funded rural school teacher placement at provincial cost.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Provincial Education Expansion Law",
            explanation:
              "_省级教育扩展法_ — Substantially raise per-pupil spending across the province, expand rural school subsidies, fully fund teacher salary equalization.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Urban-Rural Equalization Law",
            explanation:
              "_城乡均等化法_ — Direct provincial transfers to equalize rural-urban per-pupil spending, expand free meals for rural primary schools, raise rural teacher housing subsidies.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Provincial Education Law",
            explanation:
              "_省级教育基本法_ — Maintain provincial education-funding framework with incremental equalization between urban and rural schools.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Provincial Education Reform Law",
            explanation:
              "_省级教育改革法_ — Narrow provincial education funding to highest-priority sectors, raise market-led private-school growth, soften per-pupil equalization mandates.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Provincial Education Law",
            explanation:
              "_民办省级教育法_ — Phase out provincial education subsidies beyond compulsory floor, hand higher-education funding to commercial-market provisions.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Education Devolution Law",
            explanation:
              "_教育下放法_ — Devolve education funding entirely to local-government and private-market, retain only provincial-coordination role with no direct funding.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [115, 92, 69, 46, 23, 8, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.2 cn_provincial_public_security — Provincial Public Security Law (省级公共安全法) ─
  {
    _id: "cn_provincial_public_security",
    countryScope: "cn",
    name: "Provincial Public Security Law",
    description:
      "Sets provincial 公安厅 (PSB) operational scale and 维稳 (stability maintenance) capability",
    explanation:
      "Provincial Public Security Bureaus (省级公安厅) handle provincial-level law-enforcement operations, surveillance-technology deployment, and 维稳 (stability maintenance) capabilities. Provincial budget allocations determine the operational scale of these activities under the national 公安部 (Ministry of Public Security) framework.",
    policyDomain: "law_justice",
    subCategory: "Provincial public security",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.7 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "socialCreditCoverage", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: peoplesCongressCommitteePositions("Public Security"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_public_security",
        [
          {
            name: "Maximum Provincial Surveillance Law",
            explanation:
              "_最大省级监控法_ — Massive expansion of provincial 公安厅 (PSB) surveillance-technology deployment, full provincial facial-recognition network, comprehensive 维稳 (stability maintenance) reserves at every district level.",
            stance: "left",
            economic: -5,
            social: 5,
          },
          {
            name: "Provincial PSB Acceleration Law",
            explanation:
              "_省级公安加速法_ — Substantially raise provincial 公安厅 (PSB) staffing and equipment, expand provincial surveillance-camera networks, raise 维稳 (stability maintenance) capability.",
            stance: "left",
            economic: -3,
            social: 3,
          },
          {
            name: "Technology-Heavy Provincial PSB Law",
            explanation:
              "_科技密集省级公安法_ — Concentrate provincial 公安厅 (PSB) investment in surveillance and AI-enabled enforcement, raise inter-prefecture data-sharing capability.",
            stance: "left",
            economic: -2,
            social: 2,
          },
          {
            name: "Statutory Provincial Public Security Law",
            explanation:
              "_省级公共安全基本法_ — Maintain provincial 公安厅 (PSB) operational scale with steady surveillance-technology upgrades and balanced 维稳 (stability maintenance) preparation.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Provincial PSB Restraint Law",
            explanation:
              "_省级公安节制法_ — Narrow provincial 公安厅 (PSB) operational scope to highest-priority enforcement categories, slow surveillance-technology deployment, raise procedural-rights protections.",
            stance: "right",
            economic: 2,
            social: -1,
          },
          {
            name: "Community Policing Reform Law",
            explanation:
              "_社区警务改革法_ — Substantially redirect provincial 公安厅 (PSB) resources to community-policing model, scale back surveillance-camera networks, expand independent oversight.",
            stance: "right",
            economic: 3,
            social: -2,
          },
          {
            name: "Minimal Provincial Policing Law",
            explanation:
              "_最低省级警务法_ — Comprehensive rollback of provincial 公安厅 (PSB) operational scope to formal-warranted enforcement only, dismantle 维稳 (stability maintenance) reserves, transition to community-led safety framework.",
            stance: "right",
            economic: 5,
            social: -3,
          },
        ],
        "both"
      ),
      [92, 73, 54, 35, 19, 8, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.3 cn_provincial_economic_development — Provincial Economic Development Law (省级经济发展法) ─
  {
    _id: "cn_provincial_economic_development",
    countryScope: "cn",
    name: "Provincial Economic Development Law",
    description: "Sets provincial industrial-policy scope and 经济特区 (SEZ) management",
    explanation:
      "Provincial industrial-strategy authority covers 经济特区 (Special Economic Zone) management, SOE provincial-portfolio oversight, and provincial-level Made in China implementation. Reform debates focus on provincial-level industrial-strategy autonomy within national framework and balance between provincial SOE expansion and private-sector growth.",
    policyDomain: "economic",
    subCategory: "Provincial economic development",
    allowedScope: "state",
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "state" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: -0.4 },
    ],
    positions: peoplesCongressCommitteePositions("Economic Development"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_economic_development",
        [
          {
            name: "Maximum Provincial Industrial State Law",
            explanation:
              "_最大省级产业国家法_ — Massive provincial-SOE expansion across all strategic sectors, comprehensive 经济特区 (Special Economic Zone) state-led investment, full provincial industrial-targeting under Five-Year Plan flagship priorities.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Provincial Industrial Acceleration Law",
            explanation:
              "_省级产业加速法_ — Substantially raise provincial industrial-subsidy budgets, expand SOE provincial-portfolio scope, raise 经济特区 (Special Economic Zone) state-investment intensity.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Strategic Provincial Sector Law",
            explanation:
              "_战略省级产业法_ — Concentrate provincial industrial-policy resources on Made in China priority sectors, expand provincial-SOE foundry and biotech holdings.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Provincial Economic Development Law",
            explanation:
              "_省级经济发展基本法_ — Maintain provincial industrial-policy framework with steady SOE-and-private mix and balanced 经济特区 (Special Economic Zone) management.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Provincial Reform Law",
            explanation:
              "_省级改革法_ — Narrow provincial industrial-policy scope to highest-priority sectors, raise private-investment matching requirements, scale back provincial-SOE subsidies.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Provincial Market Liberalization Law",
            explanation:
              "_省级市场自由化法_ — Phase out provincial industrial-subsidy programs, hand 经济特区 (Special Economic Zone) management to market dynamics, end provincial-SOE expansion mandates.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Provincial Privatization Law",
            explanation:
              "_省级私有化法_ — Privatize provincial-SOE portfolio entirely, dissolve provincial industrial-policy framework, transition to fully market-led provincial economy.",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "economic"
      ),
      [154, 123, 92, 62, 31, 12, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.4 cn_provincial_health_services — Provincial Health Services Law (省级卫生服务法) ─
  {
    _id: "cn_provincial_health_services",
    countryScope: "cn",
    name: "Provincial Health Services Law",
    description: "Sets provincial-hospital network funding and rural-urban equalization",
    explanation:
      "Provincial hospital networks (省级医院网络) and provincial public-health bureaus handle hospital network funding, provincial public-health infrastructure, and provincial-tier 医保 (medical insurance) administration. Provincial-level decisions affect rural-urban service equalization within the province.",
    policyDomain: "healthcare",
    subCategory: "Provincial health services",
    allowedScope: "state",
    effectTarget: { metricCategoryId: "healthcare", metricId: "physicianRate", scope: "state" },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "physicianRate", weight: 0.7 },
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.6 },
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.4 },
      { metricCategoryId: "healthcare", metricId: "elderCareQuality", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: peoplesCongressCommitteePositions("Health and Welfare"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_health_services",
        [
          {
            name: "Universal Provincial Health Law",
            explanation:
              "_省级全民医疗法_ — Free provincial-tier 医保 (medical insurance) for all residents, full provincial-hospital state funding, mandatory rural-urban physician rotation, comprehensive provincial public-health infrastructure expansion.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Provincial Health Expansion Law",
            explanation:
              "_省级卫生扩展法_ — Substantially raise provincial-hospital subsidies, expand rural provincial-hospital staffing, raise 医保 (medical insurance) provincial reimbursement floor.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Rural Health Equalization Law",
            explanation:
              "_乡村卫生均等化法_ — Direct provincial transfers to equalize rural-urban hospital staffing and equipment, expand rural primary-care provincial-clinic network.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Provincial Health Services Law",
            explanation:
              "_省级卫生服务基本法_ — Maintain provincial-hospital network with incremental rural-urban equalization and balanced 医保 (medical insurance) provincial administration.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Provincial Health Reform Law",
            explanation:
              "_省级卫生改革法_ — Narrow provincial-hospital subsidies to highest-priority programs, raise commercial-hospital growth incentives, soften rural-equalization mandates.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Mixed Provincial Health Law",
            explanation:
              "_混合省级卫生法_ — Substantially expand commercial-hospital market, hand provincial-hospital growth to private-investment matching, scale back state subsidies.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Provincial Health Privatization Law",
            explanation:
              "_省级卫生私有化法_ — Privatize provincial-hospital networks, end state-subsidy framework, transition fully to commercial-market provincial healthcare.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [138, 108, 77, 46, 23, 8, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.5 cn_provincial_culture_propaganda — Provincial Culture & Propaganda Law (省级文化宣传法) ─
  {
    _id: "cn_provincial_culture_propaganda",
    countryScope: "cn",
    name: "Provincial Culture & Propaganda Law",
    description: "Sets provincial 统战部 (United Front) activity and cultural-content regulation",
    explanation:
      "Provincial Department of Culture and 统战部 (United Front Work Department) provincial activity handle cultural-content programming, ideological-compliance enforcement at provincial level, and provincial-level media regulation. Reform debates focus on balance between cultural preservation and ideological framing, and provincial discretion within national framework.",
    policyDomain: "mediaInformation",
    subCategory: "Provincial culture",
    allowedScope: "state",
    effectTarget: { metricCategoryId: "governance", metricId: "partyDiscipline", scope: "state" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "partyDiscipline", weight: 0.5 },
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: -0.4 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: peoplesCongressCommitteePositions("Culture and Media"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_culture_propaganda",
        [
          {
            name: "Maximum Provincial Propaganda Law",
            explanation:
              "_最大省级宣传法_ — Massive provincial 统战部 (United Front Work Department) operations expansion, full provincial state-media network funding, mandatory provincial ideological-content review for all commercial outlets.",
            stance: "left",
            economic: -5,
            social: 5,
          },
          {
            name: "Provincial Cultural Expansion Law",
            explanation:
              "_省级文化扩展法_ — Substantially expand provincial Department of Culture programming budgets, raise 统战部 (United Front Work Department) provincial outreach, expand provincial state-media production.",
            stance: "left",
            economic: -3,
            social: 3,
          },
          {
            name: "Ideological Compliance Reinforcement Law",
            explanation:
              "_意识形态合规强化法_ — Concentrate provincial cultural funding on ideological-compliance content, expand provincial-level 统战部 (United Front Work Department) supervision of commercial-media outlets.",
            stance: "left",
            economic: -2,
            social: 2,
          },
          {
            name: "Statutory Provincial Culture Law",
            explanation:
              "_省级文化基本法_ — Maintain provincial Department of Culture programming with steady 统战部 (United Front Work Department) activity and balanced commercial-content review.",
            stance: "center",
            economic: 0,
            social: 1,
          },
          {
            name: "Cultural Preservation Reform Law",
            explanation:
              "_文化保护改革法_ — Narrow provincial cultural funding to historical/preservation priorities, soften 统战部 (United Front Work Department) commercial-media supervision, raise private-sector cultural-production incentives.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Commercial Culture Expansion Law",
            explanation:
              "_商业文化扩展法_ — Phase out provincial state-media subsidies, hand provincial cultural sector to commercial-revenue funding, end mandatory ideological-content review.",
            stance: "right",
            economic: 3,
            social: -1,
          },
          {
            name: "Provincial Culture Privatization Law",
            explanation:
              "_省级文化私有化法_ — Privatize provincial state-media holdings, dissolve provincial 统战部 (United Front Work Department) cultural-outreach programs, transition to fully commercial-cultural market.",
            stance: "right",
            economic: 5,
            social: -2,
          },
        ],
        "both"
      ),
      [46, 37, 28, 18, 9, 5, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.6 cn_provincial_environmental_policy — Provincial Environmental Policy Law (省级环境政策法) ─
  {
    _id: "cn_provincial_environmental_policy",
    countryScope: "cn",
    name: "Provincial Environmental Policy Law",
    description:
      "Sets provincial-level pollution control, ecological restoration, and environmental-enforcement funding",
    explanation:
      "Provincial 生态环境厅 (Department of Ecology and Environment) bureaus operate provincial pollution control, ecological restoration, and environmental-enforcement programs. Provincial budget allocations determine pollutant-monitoring coverage, factory-inspection cadence, and remediation of legacy industrial sites, complementing national 双碳 (Dual Carbon) commitments.",
    policyDomain: "environment",
    subCategory: "Provincial environment",
    allowedScope: "state",
    // RETARGET (Spec B, ex-Spec A): provincial pollution control's felt effect is
    // local air quality; carbonEmissions (windowed 1990) demoted to a secondary.
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "airQuality",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "airQuality", weight: 0.8 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: -0.6 },
      { metricCategoryId: "environment", metricId: "climateResilience", weight: -0.6 },
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.4 },
    ],
    positions: peoplesCongressCommitteePositions("Environmental Protection"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_environmental_policy",
        [
          {
            name: "Maximum Provincial Environmental Law",
            explanation:
              "_最大省级环保法_ — Province-wide industrial-pollution shutdown authority, full ecological-restoration funding across degraded sites, mandatory continuous-emissions monitoring on every regulated facility.",
            stance: "left",
            economic: -5,
            social: -1,
          },
          {
            name: "Provincial Pollution Control Expansion Law",
            explanation:
              "_省级污染防治扩展法_ — Substantially expand provincial 生态环境厅 (Department of Ecology and Environment) staffing, raise factory-inspection coverage, fully fund provincial ecological-restoration projects.",
            stance: "left",
            economic: -3,
            social: -1,
          },
          {
            name: "Industrial Compliance Tightening Law",
            explanation:
              "_工业合规收紧法_ — Concentrate provincial environmental budgets on heavy-industry compliance enforcement, expand pollutant-emission monitoring, raise penalties on repeat-offender facilities.",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Statutory Provincial Environmental Law",
            explanation:
              "_省级环保基本法_ — Maintain provincial pollution-control framework with steady inspection cadence and balanced industrial-development pressure.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Provincial Environmental Reform Law",
            explanation:
              "_省级环保改革法_ — Narrow provincial environmental funding to highest-pollution-risk facilities, soften routine inspection mandates, lift industrial-permit friction for SMEs.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Industrial Liberalization Law",
            explanation:
              "_工业自由化法_ — Phase out routine provincial pollution inspections, end province-wide remediation subsidies, devolve environmental compliance to industry self-regulation.",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: "Environmental Deregulation Law",
            explanation:
              "_环境放管法_ — Dissolve provincial 生态环境厅 (Department of Ecology and Environment) enforcement role, transfer pollution-monitoring to commercial-market services only.",
            stance: "right",
            economic: 5,
            social: 0,
          },
        ],
        "both"
      ),
      [62, 49, 37, 25, 12, 6, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── 29.7 cn_provincial_infrastructure_investment — Provincial Infrastructure Investment Law (省级基础设施投资法) ─
  {
    _id: "cn_provincial_infrastructure_investment",
    countryScope: "cn",
    name: "Provincial Infrastructure Investment Law",
    description:
      "Sets provincial-level capital investment in inter-city roads, bridges, water, sewage, and urban-renewal programs",
    explanation:
      "Provincial 发展和改革委员会 (Development and Reform Commission) and 交通运输厅 (Department of Transportation) jointly direct provincial capital investment in inter-city roads, bridges, water and sewage networks, and urban-renewal programs, complementing the national rail and digital-infrastructure stack. Provincial budget allocations set the headline scale of these programs.",
    policyDomain: "infrastructure",
    subCategory: "Provincial infrastructure",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "transportEfficiency",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "transportEfficiency", weight: -0.8 },
      { metricCategoryId: "infrastructure", metricId: "publicTransit", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "eastWestRegionalGap", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.6 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: peoplesCongressCommitteePositions("Infrastructure and Construction"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_provincial_infrastructure_investment",
        [
          {
            name: "Maximum Provincial Infrastructure Law",
            explanation:
              "_最大省级基础设施法_ — Full inter-city road and bridge network rebuild, province-wide water and sewage modernization, mass urban-renewal funding for every prefecture-level city.",
            stance: "left",
            economic: -5,
            social: 0,
          },
          {
            name: "Provincial Capex Expansion Law",
            explanation:
              "_省级基本建设扩展法_ — Substantially raise provincial 发展和改革委员会 (Development and Reform Commission) capex envelope, accelerate rural-road and last-mile water modernization.",
            stance: "left",
            economic: -3,
            social: 0,
          },
          {
            name: "Western Provinces Equalization Law",
            explanation:
              "_西部省份均等化法_ — Direct provincial infrastructure transfers toward interior and Western prefectures, raise rural-road and water-sewage modernization at province-funded scale.",
            stance: "left",
            economic: -2,
            social: -1,
          },
          {
            name: "Statutory Provincial Infrastructure Law",
            explanation:
              "_省级基础设施基本法_ — Maintain provincial capital investment at steady pace with balanced rural-urban allocation and incremental urban-renewal funding.",
            stance: "center",
            economic: 0,
            social: 0,
          },
          {
            name: "Provincial Infrastructure Restraint Law",
            explanation:
              "_省级基础设施约束法_ — Narrow provincial capex to highest-return inter-city corridors, halt expansion to low-density rural routes, reduce urban-renewal subsidies.",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Private Provincial Infrastructure Law",
            explanation:
              "_民营省级基础设施法_ — Open provincial water, sewage, and road operations to private capital, soften provincial-government project sponsorship requirements.",
            stance: "right",
            economic: 3,
            social: 1,
          },
          {
            name: "Infrastructure Privatization Law",
            explanation:
              "_基础设施私有化法_ — Privatize provincial water, sewage, and road operations entirely, end provincial-government direct capital investment in inter-city corridors.",
            stance: "right",
            economic: 5,
            social: 1,
          },
        ],
        "both"
      ),
      [115, 92, 69, 46, 23, 8, 0]
    ),
    source: "seed",
    isPermanent: true,
  },

  // ── P6a: Recruitment / National Service (militaryReadiness + conscription axis home) ──
  {
    _id: "cn_conscription",
    countryScope: "cn",
    name: "Statutory Military Service Law",
    description:
      "PLA recruitment, the nominal universal-service obligation, and mobilization readiness",
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
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "militaryReadiness", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "nationalPride", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "civilLiberties", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: 0.1 },
    ],
    positions: npcCommitteePositions("National Defense"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "cn_conscription",
        [
          { name: "Professional PLA Law", stance: "left", effectDirection: -1 },
          { name: "Volunteer Recruitment Law", stance: "left", effectDirection: -1 },
          { name: "Streamlined Forces Law", stance: "left", effectDirection: -1 },
          { name: "Service Framework Continuity Law", stance: "center", effectDirection: 0 },
          { name: "Recruitment Quota Expansion Law", stance: "right", effectDirection: 1 },
          { name: "Mobilization Readiness Law", stance: "right", effectDirection: 1 },
          { name: "Universal Enforcement Law", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Transition the PLA to a fully professional volunteer force with civilian technical recruitment",
          "Emphasize volunteer recruitment with university deferment reform and veteran placement",
          "Streamline force structure toward a leaner professional military",
          "Maintain the nominal universal obligation with selective volunteer-first intake",
          "Raise annual recruitment quotas and expand reserve mobilization exercises",
          "Strengthen mobilization readiness with mandatory reserve registration and training",
          "Enforce the universal service obligation across all eligible cohorts",
        ][i],
      })),
      [3, 6, 10, 15, 24, 38, 55]
    ),
    source: "seed",
    isPermanent: true,
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  Default spending calibration (added 2026-06-03, fix/default-laws)
// ────────────────────────────────────────────────────────────────────────────
//  Attach `budgetCategory` to CN spending programs so the national budget seeds
//  a full set of expenditure lines (CN previously generated no spending laws —
//  14 types carried per-capita costs but no category, so deriveEnactedLaws
//  skipped them and the CN budget showed 0/flat expenditure).
//
//  All spending programs get a `budgetCategory` + per-capita cost (CNY/capita at
//  index 3, the seeded default). Index 3 anchors each baseline; the curve grades
//  toward the higher-spending option. CN's authored convention puts the
//  higher-spending option on the LEFT (e.g. surveillance-state public security,
//  expansive PLA), so every CN program uses EXPANSION (high at idx 0).
//
//  The 14 types that already wrapped withPerCapitaCosts in situ are re-anchored
//  here to per-capita figures that reconcile each category to real CN 2023
//  general-budget function totals (their authored idx-3 values skewed the mix —
//  e.g. pensions exceeding education, which is backwards for China).
//
//  Regulatory / rule-only types (minimum wage, anticorruption, hukou, NPC
//  reform, HK/Macao, press freedom, diplomacy doctrines, emissions trading,
//  gender equality, internet governance, skilled immigration, diaspora) are
//  intentionally omitted — no standing expenditure line. Public security and
//  criminal justice use a dedicated `publicSafety` line (rendered via the
//  budget UI's humanizeKey fallback) so the large CN security outlay is visible
//  rather than buried in "other".
//
//  Σ(per-capita × population) per category is reconciled into
//  NATIONAL_BUDGET_SEED_CONFIGS.CN.baselineSpendingByCategory.
//  State-scope provincial types are out of scope here (state-budget surface).
// ════════════════════════════════════════════════════════════════════════════
const CN_EXPANSION_CURVE = [1.6, 1.35, 1.15, 1.0, 0.8, 0.6, 0.4];

const CN_SPENDING_CALIBRATION: Record<
  string,
  { category: string; baseline: number; curve: number[] }
> = {
  // ── Education (real CN 2023 ≈ ¥4.1T) ────────────────────────────────────────
  cn_education_funding: { category: "education", baseline: 2266, curve: CN_EXPANSION_CURVE },
  cn_research_science: { category: "education", baseline: 425, curve: CN_EXPANSION_CURVE },
  cn_gaokao_reform: { category: "education", baseline: 142, curve: CN_EXPANSION_CURVE },
  cn_academic_pressure_reform: { category: "education", baseline: 71, curve: CN_EXPANSION_CURVE },
  // ── Social Security (≈ ¥3.9T) ───────────────────────────────────────────────
  cn_pension_system: { category: "socialSecurity", baseline: 2125, curve: CN_EXPANSION_CURVE },
  cn_common_prosperity: { category: "socialSecurity", baseline: 425, curve: CN_EXPANSION_CURVE },
  cn_family_policy: { category: "socialSecurity", baseline: 212, curve: CN_EXPANSION_CURVE },
  // ── Health (≈ ¥2.2T) ────────────────────────────────────────────────────────
  cn_medical_insurance: { category: "health", baseline: 1133, curve: CN_EXPANSION_CURVE },
  cn_public_health: { category: "health", baseline: 283, curve: CN_EXPANSION_CURVE },
  cn_elder_care: { category: "health", baseline: 71, curve: CN_EXPANSION_CURVE },
  cn_mental_health: { category: "health", baseline: 71, curve: CN_EXPANSION_CURVE },
  // ── Defense (≈ ¥1.6T) ───────────────────────────────────────────────────────
  cn_pla_modernization: { category: "defense", baseline: 1098, curve: CN_EXPANSION_CURVE },
  cn_cybersecurity: { category: "defense", baseline: 35, curve: CN_EXPANSION_CURVE },
  // ── Infrastructure (≈ ¥3.5T) ────────────────────────────────────────────────
  cn_rail_transport: { category: "infrastructure", baseline: 708, curve: CN_EXPANSION_CURVE },
  cn_housing: { category: "infrastructure", baseline: 567, curve: CN_EXPANSION_CURVE },
  cn_digital_infrastructure: {
    category: "infrastructure",
    baseline: 354,
    curve: CN_EXPANSION_CURVE,
  },
  cn_belt_and_road: { category: "infrastructure", baseline: 283, curve: CN_EXPANSION_CURVE },
  cn_renewable_energy_target: {
    category: "infrastructure",
    baseline: 283,
    curve: CN_EXPANSION_CURVE,
  },
  cn_nuclear_energy: { category: "infrastructure", baseline: 142, curve: CN_EXPANSION_CURVE },
  cn_climate_targets: { category: "infrastructure", baseline: 142, curve: CN_EXPANSION_CURVE },
  // ── Agriculture (≈ ¥2.4T) ───────────────────────────────────────────────────
  cn_agricultural_subsidies: { category: "agriculture", baseline: 992, curve: CN_EXPANSION_CURVE },
  cn_rural_revitalization: { category: "agriculture", baseline: 567, curve: CN_EXPANSION_CURVE },
  cn_food_security: { category: "agriculture", baseline: 142, curve: CN_EXPANSION_CURVE },
  // ── Public Safety (≈ ¥2.3T) ─────────────────────────────────────────────────
  cn_public_security: { category: "publicSafety", baseline: 1487, curve: CN_EXPANSION_CURVE },
  cn_criminal_justice: { category: "publicSafety", baseline: 142, curve: CN_EXPANSION_CURVE },
  // ── Other central programs (≈ ¥3.1T) ────────────────────────────────────────
  cn_industrial_strategy: { category: "other", baseline: 708, curve: CN_EXPANSION_CURVE },
  cn_semiconductor_strategy: { category: "other", baseline: 425, curve: CN_EXPANSION_CURVE },
  cn_state_enterprises: { category: "other", baseline: 354, curve: CN_EXPANSION_CURVE },
  cn_fiscal_stimulus: { category: "other", baseline: 354, curve: CN_EXPANSION_CURVE },
  cn_state_media_funding: { category: "other", baseline: 240, curve: CN_EXPANSION_CURVE },
  cn_ai_strategy: { category: "other", baseline: 142, curve: CN_EXPANSION_CURVE },
};

const cnCalibratedIds = new Set<string>();
for (const lt of cnLegislationTypes) {
  const cal = CN_SPENDING_CALIBRATION[lt._id];
  if (!cal) continue;
  lt.budgetCategory = cal.category;
  const { baseline, curve } = cal;
  if (baseline !== undefined && curve) {
    const options = lt.policyOptions ?? [];
    if (options.length !== curve.length) {
      throw new Error(
        `CN spending calibration for ${lt._id}: expected ${curve.length} options, got ${options.length}`
      );
    }
    lt.policyOptions = withPerCapitaCosts(
      options,
      curve.map((m) => Math.round(baseline * m))
    );
  }
  cnCalibratedIds.add(lt._id);
}
// Guard against a mistyped calibration key silently under-seeding spending.
const cnUnmatched = Object.keys(CN_SPENDING_CALIBRATION).filter((id) => !cnCalibratedIds.has(id));
if (cnUnmatched.length > 0) {
  throw new Error(`CN spending calibration references unknown type ids: ${cnUnmatched.join(", ")}`);
}
