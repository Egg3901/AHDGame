import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withPerCapitaCosts,
} from "../reference/policyOptionHelpers";

/**
 * Nigeria country-specific legislation.
 *
 * Weight-sign convention for `effectTargetsWeighted` (mirrors the audited
 * IE/CN/JP seeds — see `ieLegislationTypes.ts` for the full derivation):
 *
 *   Engine per target:
 *     contribution = effectDirection × weight × MAX × scope × effectSign
 *     effectSign   = isHigherBetter ? +1 : -1   (baked in by the engine)
 *
 *   `taxRateOptions` sets effectDirection by stance: right → +1, left → −1,
 *   center → 0 (the tax helper pre-inverts, so a metric improves under the
 *   RIGHT option exactly when its weight is POSITIVE). The helper also injects
 *   a per-option `smallBusinessFormation` tick (right +, left −), which is the
 *   natural right-side upside the P6c symmetry guard credits.
 *
 *   Stance ↔ rate direction differs by tax family (matches CN/IE):
 *     - Direct/progressive taxes (CIT, PIT, PPT, CGT, stamp): LOW rate = RIGHT.
 *     - Consumption / trade taxes (VAT, customs): LOW rate = LEFT.
 *     - Excise (sin/carbon framing): LOW rate = RIGHT (abolition is market-coded).
 *
 * Nigeria legislates in English, so titles and descriptions are English (no
 * transliteration flavor, unlike the CN/IE seeds). Metric ids are drawn from
 * the NG metric set authored in `ngStateMetrics.ts`.
 *
 * Sub-phases: 5a tax (this batch); 5b economic/infra/energy; 5c social/
 * health/security/foreign (appended below as they land).
 */

function ngCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "senate_chair",
      name: `Chair, Senate Committee on ${domainLabel}`,
      chamber: "senate",
    },
    {
      positionId: "house_chair",
      name: `Chair, House Committee on ${domainLabel}`,
      chamber: "house",
    },
  ];
}

export const ngLegislationTypes: LegislationType[] = [
  // ── Tax (5a) ──────────────────────────────────────────────────────────────
  {
    _id: "ng_vat_rate",
    countryScope: "ng",
    name: "Statutory Value-Added Tax Act",
    description: "Sets the standard value-added tax rate on goods and services",
    explanation:
      "VAT is a broad federal consumption tax, collected centrally and shared with the states under the federation account. This Act sets the standard headline rate.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    // Consumption tax (high rate = right): higher VAT raises cost of living and
    // poverty, so both carry negative weights.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.25 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("ng_vat_rate", [
      {
        rate: 0,
        name: "VAT Abolition Act",
        description: "Abolish VAT entirely; fund the federation from income and corporate tax only",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 2.5,
        name: "Consumer Relief Act",
        description: "A token VAT to ease the cost of living on households",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 5,
        name: "Reduced VAT Act",
        description: "Roll VAT back to the historic 5% rate",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 7.5,
        name: "Statutory VAT Act",
        description: "The statutory standard rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 10,
        name: "Revenue Consolidation Act",
        description: "Raise VAT to widen the non-oil revenue base",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 12.5,
        name: "Fiscal Capacity Act",
        description: "An above-statutory VAT to strengthen federal and state allocations",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Continental Alignment Act",
        description: "Lift VAT toward the West African regional average",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Maximum Consumption Tax Act",
        description: "Fund government primarily through consumption taxation",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_companies_income_tax",
    countryScope: "ng",
    name: "Companies Income Tax Act",
    description: "Sets the headline rate of tax on company profits",
    explanation:
      "Companies Income Tax (CIT) is levied on the profits of resident companies. The headline rate applies to large companies; smaller firms attract lower bands in practice. This Act sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    // Direct tax (low rate = right): a lower CIT lifts growth, business
    // formation and formal employment, but weakens the budget.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("ng_companies_income_tax", [
      {
        rate: 0,
        name: "Corporate Tax Abolition Act",
        description: "Eliminate company income tax to maximise investment",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 10,
        name: "Investment Magnet Act",
        description: "A very low CIT to draw capital and headquarters",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Competitive Rate Act",
        description: "A below-statutory CIT favouring enterprise",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 25,
        name: "Mid-Market Relief Act",
        description: "A modest cut from the statutory rate",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 30,
        name: "Statutory CIT Act",
        description: "The statutory headline rate for large companies",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 35,
        name: "Revenue Mobilisation Act",
        description: "Raise CIT to fund federal programmes",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 40,
        name: "Corporate Contribution Act",
        description: "A high CIT shifting the burden onto large firms",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 45,
        name: "Maximum Corporate Tax Act",
        description: "The highest CIT, funding government from company profits",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_personal_income_tax",
    countryScope: "ng",
    name: "Personal Income Tax Act",
    description: "Sets the top marginal rate of personal income tax",
    explanation:
      "Personal Income Tax (PAYE and direct assessment) is administered on a graduated scale; this Act sets the top marginal band. State boards collect it within the federal framework.",
    policyDomain: "tax",
    subCategory: "Income taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    // Direct tax (low rate = right): a lower top band lifts take-home income and
    // growth, but widens inequality and reduces redistribution.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("ng_personal_income_tax", [
      {
        rate: 7,
        name: "Flat Low Tax Act",
        description: "Collapse the bands to the entry rate for all earners",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 11,
        name: "Take-Home Pay Act",
        description: "A low top band to maximise disposable income",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Earnings Relief Act",
        description: "A below-statutory top band",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 19,
        name: "Middle-Class Relief Act",
        description: "A modest cut to the top band",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 24,
        name: "Statutory Income Tax Act",
        description: "The statutory top marginal rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 28,
        name: "Progressive Bands Act",
        description: "Raise the top band on high earners",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 33,
        name: "Redistribution Act",
        description: "A high top band funding social programmes",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Income Tax Act",
        description: "The highest top band, maximising redistribution",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_petroleum_profit_tax",
    countryScope: "ng",
    name: "Petroleum Profit Tax Act",
    description: "Sets the rate of tax on upstream petroleum profits",
    explanation:
      "Petroleum Profit Tax (and the hydrocarbon tax under the petroleum fiscal regime) governs the share of upstream oil profits taken by the federation. Upstream operations are dominated by international oil companies, so this dial maps to the foreign-corporate rate. It is the single largest swing factor in federal revenue.",
    policyDomain: "tax",
    subCategory: "Petroleum taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    // Direct tax on oil majors (low rate = right): a lower PPT attracts upstream
    // investment (growth, oil-export trade) but starves the federal budget.
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.9 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
    ],
    positions: ngCommitteePositions("Petroleum Resources"),
    taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
    policyOptions: taxRateOptions("ng_petroleum_profit_tax", [
      {
        rate: 0,
        name: "Upstream Tax Holiday Act",
        description: "Suspend petroleum profit tax to maximise upstream investment",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 30,
        name: "Investment Incentive Act",
        description: "A low petroleum take to draw exploration capital",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 50,
        name: "Production-Sharing Rate Act",
        description: "The lighter production-sharing-contract rate across the board",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 67,
        name: "Statutory Petroleum Tax Act",
        description: "The blended statutory petroleum take",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 76,
        name: "Resource Sovereignty Act",
        description: "Raise the federation's share of oil profits",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 85,
        name: "Joint-Venture Maximum Act",
        description: "Apply the heavy joint-venture rate across the sector",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 90,
        name: "Windfall Capture Act",
        description: "The highest petroleum take, capturing oil windfalls in full",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_customs_tariff",
    countryScope: "ng",
    name: "Customs Tariff Act",
    description: "Sets the average import tariff on goods",
    explanation:
      "Import tariffs are set within the ECOWAS Common External Tariff framework. Lower tariffs cut input and consumer costs; higher tariffs protect domestic producers and raise customs revenue. This Act sets the average applied rate.",
    policyDomain: "tax",
    subCategory: "Trade taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    // Trade tax (high rate = right/protectionist): a higher tariff shelters
    // producers but raises input costs for small firms, lifts consumer prices,
    // and dampens trade.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Trade and Investment"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("ng_customs_tariff", [
      {
        rate: 0,
        name: "Free Trade Act",
        description: "Abolish import tariffs to cut input and consumer costs",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 5,
        name: "Open Markets Act",
        description: "A minimal tariff favouring open trade",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 10,
        name: "Low Tariff Act",
        description: "A below-average tariff",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 12,
        name: "Common External Tariff Act",
        description: "The regional common-external-tariff average",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Local Content Act",
        description: "Raise tariffs to shelter domestic producers",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 35,
        name: "Industrial Protection Act",
        description: "A high tariff wall behind which to industrialise",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Protection Act",
        description: "The highest tariff, prioritising domestic industry",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_capital_gains_tax",
    countryScope: "ng",
    name: "Capital Gains Tax Act",
    description: "Sets the rate of tax on realised capital gains",
    explanation:
      "Capital Gains Tax applies to gains on the disposal of chargeable assets. A lower rate rewards investment and risk-taking; a higher rate raises revenue and curbs wealth concentration. This Act sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Capital taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    // Direct tax (low rate = right): a lower CGT rewards investment and growth
    // but widens inequality and softens the budget.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "capitalGainsTax" },
    policyOptions: taxRateOptions("ng_capital_gains_tax", [
      {
        rate: 0,
        name: "Capital Gains Exemption Act",
        description: "Exempt capital gains to spur investment",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Investor Incentive Act",
        description: "A low CGT favouring capital formation",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 10,
        name: "Statutory CGT Act",
        description: "The statutory capital gains rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Wealth Contribution Act",
        description: "Raise CGT toward the income-tax bands",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 30,
        name: "Capital Equity Act",
        description: "A high CGT to curb wealth concentration",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Capital Tax Act",
        description: "The highest CGT, taxing gains as ordinary income",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_stamp_duty",
    countryScope: "ng",
    name: "Stamp Duty Act",
    description: "Sets the stamp duty rate on documented transactions",
    explanation:
      "Stamp duties apply to instruments and electronic transfers. A lower rate reduces transaction friction for businesses; a higher rate raises easy revenue at the cost of formalisation. This Act sets the headline rate.",
    policyDomain: "tax",
    subCategory: "Transaction taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    // Direct transaction tax (low rate = right): a lower duty eases business
    // formation; a higher duty raises revenue but adds friction and inequality.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.2 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "stampDuty" },
    policyOptions: taxRateOptions("ng_stamp_duty", [
      {
        rate: 0,
        name: "Stamp Duty Abolition Act",
        description: "Abolish stamp duties to cut transaction friction",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 0.5,
        name: "Light Duty Act",
        description: "A token stamp duty on transactions",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 1,
        name: "Statutory Stamp Duty Act",
        description: "The statutory documented-transaction rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 2,
        name: "Transaction Levy Act",
        description: "Raise stamp duty to widen revenue",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 4,
        name: "Revenue Stamp Act",
        description: "A higher duty on documented transactions",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 6,
        name: "Maximum Stamp Duty Act",
        description: "The highest duty, maximising transaction revenue",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },
  {
    _id: "ng_excise_duty",
    countryScope: "ng",
    name: "Excise Duty Act",
    description: "Sets the excise multiplier on alcohol, tobacco, sugar, and fuel (100 = baseline)",
    explanation:
      "Excise duties fall on alcohol, tobacco, sugar-sweetened beverages, telecoms, and fuel. Modelled as a multiplier where 100 is the baseline calibration. Higher excise advances public-health and emissions goals; lower excise eases the cost of living.",
    policyDomain: "tax",
    subCategory: "Excise taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    // Sin/carbon excise (low rate = right/abolition): mirrors the IE excise
    // weights — higher excise curbs emissions and funds the budget but lifts
    // the cost of living.
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "exciseDuty" },
    policyOptions: taxRateOptions("ng_excise_duty", [
      {
        rate: 0,
        name: "Excise Abolition Act",
        description: "Abolish excise duties; tax these goods through VAT only",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 25,
        name: "Token Excise Act",
        description: "Excise reduced to a token level",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 50,
        name: "Light Excise Act",
        description: "A below-baseline excise to ease living costs",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 100,
        name: "Statutory Excise Act",
        description: "The baseline excise calibration",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 150,
        name: "Public Health Excise Act",
        description: "Raise excise on harmful goods for public-health gains",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 200,
        name: "Sin Tax Act",
        description: "A high excise to curb alcohol, tobacco, and emissions",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 250,
        name: "Maximum Excise Act",
        description: "The highest excise, prioritising health and climate goals",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  {
    _id: "ng_paye",
    countryScope: "ng",
    name: "Payroll Contributions Act",
    description: "Sets statutory payroll contributions (pension, housing, and social levies)",
    explanation:
      "Mandatory payroll contributions — the contributory pension, the National Housing Fund, and social-insurance levies — collected on wages alongside PAYE. Higher contributions fund social provision but raise the cost of formal employment; lower contributions ease hiring.",
    policyDomain: "tax",
    subCategory: "Payroll taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "laborParticipation",
      scope: "national",
    },
    // Direct payroll levy (low rate = right): a lower rate lifts formal hiring,
    // take-home pay, and business formation, but weakens social-fund revenue.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: ngCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("ng_paye", [
      {
        rate: 0,
        name: "Payroll Levy Abolition Act",
        description: "Abolish statutory payroll contributions to maximise formal hiring",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Light Contribution Act",
        description: "A minimal payroll contribution",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 8,
        name: "Reduced Contribution Act",
        description: "A below-statutory payroll contribution",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 10,
        name: "Statutory Payroll Act",
        description: "The statutory combined payroll-contribution rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "Enhanced Pension Act",
        description: "Raise contributions to strengthen the pension and housing funds",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 20,
        name: "Social Insurance Act",
        description: "A high payroll contribution funding broad social insurance",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum Contribution Act",
        description: "The highest payroll contribution, maximising social-fund revenue",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── Economic / infrastructure / energy (5b) ─────────────────────────────────
  {
    _id: "ng_petroleum_sector_reform",
    countryScope: "ng",
    name: "Petroleum Sector Reform Act",
    description: "Sets the downstream fuel-subsidy and NNPC commercialisation regime",
    explanation:
      "Governs whether petrol is subsidised at the pump and how far the national oil company is commercialised. Subsidy keeps fuel cheap but drains the federation account; deregulation frees the budget but raises pump prices.",
    policyDomain: "economic",
    subCategory: "Energy markets",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: -0.3 },
    ],
    positions: ngCommitteePositions("Petroleum Resources"),
    policyOptions: policyOptions(
      "ng_petroleum_sector_reform",
      [
        {
          name: "Universal Fuel Subsidy Act",
          explanation: "Fully subsidise petrol and keep the national oil company state-run",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Managed Subsidy Act",
          explanation: "Retain a partial subsidy with a price cap and gradual NNPC reform",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Status Quo Petroleum Act",
          explanation: "Maintain the current mixed subsidy-and-commercialisation regime",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Subsidy Phase-Out Act",
          explanation: "Phase out the subsidy and commercialise the national oil company",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Full Deregulation Act",
          explanation: "Deregulate fuel pricing entirely and privatise downstream operations",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_power_sector_reform",
    countryScope: "ng",
    name: "Power Sector Reform Act",
    description: "Sets the investment and tariff regime for electricity supply",
    explanation:
      "Governs public investment in generation and transmission versus privatised, cost-reflective tariffs. Public investment lifts grid reliability but strains the budget; liberalised tariffs attract capital but raise bills.",
    policyDomain: "infrastructure",
    subCategory: "Energy infrastructure",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); spending channel drives grid readout.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Power"),
    policyOptions: policyOptions(
      "ng_power_sector_reform",
      [
        {
          name: "National Grid Buildout Act",
          explanation: "Major public investment in generation and transmission",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Public Power Expansion Act",
          explanation: "Sustained state funding with subsidised consumer tariffs",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Hybrid Power Act",
          explanation: "Maintain the current public-private generation mix",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Cost-Reflective Tariff Act",
          explanation: "Move to cost-reflective tariffs to attract private generation",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Power Market Liberalisation Act",
          explanation: "Fully liberalise the electricity market and privatise distribution",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_minimum_wage",
    countryScope: "ng",
    name: "National Minimum Wage Act",
    description: "Sets the national minimum-wage floor",
    explanation:
      "Sets the statutory national minimum wage. A higher floor lifts incomes and reduces poverty but raises business costs; a lower floor eases hiring and small-business formation.",
    policyDomain: "economic",
    subCategory: "Minimum wage",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    positions: ngCommitteePositions("Labour and Employment"),
    policyOptions: policyOptions(
      "ng_minimum_wage",
      [
        {
          name: "Living Wage Act",
          explanation: "A substantially higher minimum wage indexed to the cost of living",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Wage Floor Increase Act",
          explanation: "Raise the minimum wage well above the current floor",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Minimum Wage Act",
          explanation: "Maintain the current statutory minimum wage with periodic review",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Flexible Wage Act",
          explanation: "Freeze the floor and allow state-level variation",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Wage Act",
          explanation: "Set only a minimal floor, leaving wages to the market",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_industrial_policy",
    countryScope: "ng",
    name: "Industrial Strategy Act",
    description: "Sets the state's role in industrial and local-content policy",
    explanation:
      "Governs active industrial strategy — local-content rules, sector incentives, and state-backed manufacturing — versus a market-led approach. Intervention can spur output and trade but costs the budget.",
    policyDomain: "economic",
    subCategory: "Industrial policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Industry"),
    policyOptions: policyOptions(
      "ng_industrial_policy",
      [
        {
          name: "State Industrialisation Act",
          explanation: "Aggressive state-led industrial strategy with local-content mandates",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Sector Incentives Act",
          explanation: "Targeted incentives and credit for priority manufacturing sectors",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Mixed Industrial Act",
          explanation: "Maintain the current blend of incentives and market forces",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light-Touch Industry Act",
          explanation: "Scale back incentives and local-content rules",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Free Market Industry Act",
          explanation: "End industrial subsidies and let the market allocate capital",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_infrastructure_investment",
    countryScope: "ng",
    name: "Infrastructure Investment Act",
    description: "Sets the level of public capital investment in roads and transport",
    explanation:
      "Governs the scale of public capital spending on roads, rail, ports, and transit versus fiscal restraint and private partnerships. Investment closes the infrastructure gap but widens the deficit.",
    policyDomain: "infrastructure",
    subCategory: "Capital investment",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      // Funding law — fiscal/macro only (§4.7); spending channel drives road readouts.
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Works"),
    policyOptions: policyOptions(
      "ng_infrastructure_investment",
      [
        {
          name: "National Infrastructure Act",
          explanation: "A major debt-funded national infrastructure programme",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Capital Expansion Act",
          explanation: "Increase capital spending on roads, rail, and ports",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Balanced Capital Act",
          explanation: "Maintain the current capital-budget envelope",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Private Partnership Act",
          explanation: "Shift to public-private partnerships and concessions",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Fiscal Restraint Act",
          explanation: "Cut capital spending to protect the budget",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_agriculture_policy",
    countryScope: "ng",
    name: "Agriculture Support Act",
    description: "Sets the level of state support for farming and food security",
    explanation:
      "Governs input subsidies, credit, and price support for farmers versus a market-led food economy. Support improves food security and rural incomes but costs the budget.",
    policyDomain: "agriculture",
    subCategory: "Farm support",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "foodInsecurity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "foodInsecurity", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Agriculture"),
    policyOptions: policyOptions(
      "ng_agriculture_policy",
      [
        {
          name: "Food Sovereignty Act",
          explanation: "Large input subsidies, guaranteed prices, and state procurement",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Farm Support Act",
          explanation: "Expand fertiliser subsidies and smallholder credit",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Mixed Agriculture Act",
          explanation: "Maintain the current blend of support and market pricing",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Agribusiness Act",
          explanation: "Shift support toward commercial agribusiness and exports",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Farming Act",
          explanation: "End subsidies and let markets set food prices",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_renewable_energy",
    countryScope: "ng",
    name: "Renewable Energy Act",
    description: "Sets the pace of the transition to renewable power",
    explanation:
      "Governs subsidies and mandates for solar, hydro, and gas-to-power versus a fossil-led energy mix. A faster transition cuts emissions and builds resilience but requires upfront public spending.",
    policyDomain: "environment",
    subCategory: "Energy transition",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: 0.7 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "environment", metricId: "climateResilience", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Environment"),
    policyOptions: policyOptions(
      "ng_renewable_energy",
      [
        {
          name: "Green Transition Act",
          explanation: "Large renewable subsidies and a binding clean-power target",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Clean Energy Incentives Act",
          explanation: "Expand solar and gas-to-power incentives and mini-grids",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Balanced Energy Act",
          explanation: "Maintain the current fossil-and-renewable mix",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Gas-Led Growth Act",
          explanation: "Prioritise domestic gas with limited renewable support",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Energy Act",
          explanation: "End energy subsidies and let the market choose the mix",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_fiscal_framework",
    countryScope: "ng",
    name: "Fiscal Responsibility Act",
    description: "Sets the federal stance between stimulus and fiscal discipline",
    explanation:
      "Governs the overall fiscal stance — borrow-and-invest stimulus versus deficit reduction and debt discipline. Expansion supports growth and poverty reduction but raises debt; discipline protects the budget.",
    policyDomain: "economic",
    subCategory: "Fiscal policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.8 },
      { metricCategoryId: "governance", metricId: "debtToGdp", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Finance"),
    policyOptions: policyOptions(
      "ng_fiscal_framework",
      [
        {
          name: "Borrow and Invest Act",
          explanation: "Run larger deficits to fund growth and social programmes",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Counter-Cyclical Stimulus Act",
          explanation: "Modest deficit spending to support demand",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Balanced Fiscal Act",
          explanation: "Maintain the current deficit path and review cycle",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Deficit Reduction Act",
          explanation: "Tighten spending to reduce the deficit and debt",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Debt Discipline Act",
          explanation: "Strict balanced-budget rule and debt ceiling",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },

  // ── Social / health / education / security / foreign (5c) ───────────────────
  {
    _id: "ng_health_insurance",
    countryScope: "ng",
    name: "National Health Insurance Act",
    description: "Sets the scope of the national health insurance scheme",
    explanation:
      "Governs how far the national health insurance scheme is expanded toward universal coverage. Broader coverage improves health outcomes and reduces catastrophic out-of-pocket costs, but raises public spending.",
    policyDomain: "healthcare",
    subCategory: "Health insurance",
    nationalOnly: true,
    // Funding law: the healthcare spending channel drives the health outcome
    // readouts, so the weighted effects capture only the fiscal/macro dimension
    // (avoids the §4.7 channel double-count).
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ng_health_insurance",
      [
        {
          name: "Universal Health Coverage Act",
          explanation: "Tax-funded universal coverage for all residents",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Coverage Expansion Act",
          explanation: "Expand insurance to the informal sector with subsidies",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Insurance Act",
          explanation: "Maintain the current contributory scheme",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Means-Tested Cover Act",
          explanation: "Limit subsidised cover to the poorest households",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Private Insurance Act",
          explanation: "Rely on private insurance with a minimal public safety net",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_primary_healthcare",
    countryScope: "ng",
    name: "Primary Healthcare Act",
    description: "Sets investment in primary and rural health services",
    explanation:
      "Governs funding for primary health centres, rural clinics, and frontline health workers. Investment improves access and cuts preventable deaths but costs the budget.",
    policyDomain: "healthcare",
    subCategory: "Primary care",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the spending
    // channel drives physician/mortality/life-expectancy readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ng_primary_healthcare",
      [
        {
          name: "Rural Health Drive Act",
          explanation: "Major expansion of primary health centres and health workers",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Frontline Care Act",
          explanation: "Increase funding for clinics and community health workers",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Primary Care Act",
          explanation: "Maintain the current primary-care funding level",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Clinics Act",
          explanation: "Focus limited funds on the highest-need districts",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Health Budget Act",
          explanation: "Restrain primary-care spending to protect the budget",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_public_health",
    countryScope: "ng",
    name: "Public Health Preparedness Act",
    description: "Sets investment in disease control and outbreak readiness",
    explanation:
      "Governs funding for disease surveillance, vaccination, and outbreak response. Stronger preparedness cuts mortality and protects the economy from shocks but requires standing investment.",
    policyDomain: "healthcare",
    subCategory: "Public health",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ng_public_health",
      [
        {
          name: "Pandemic Readiness Act",
          explanation: "Build a standing disease-surveillance and response capability",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Immunisation Drive Act",
          explanation: "Expand vaccination and disease-control programmes",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Public Health Act",
          explanation: "Maintain the current public-health funding",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Response Act",
          explanation: "Fund outbreak response reactively rather than standing capacity",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Minimal Public Health Act",
          explanation: "Restrain public-health spending to essentials only",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_basic_education",
    countryScope: "ng",
    name: "Universal Basic Education Act",
    description: "Sets investment in free and compulsory basic education",
    explanation:
      "Governs funding for free, compulsory basic education and the out-of-school-children challenge. Investment lifts literacy and lifts children out of poverty but costs the budget.",
    policyDomain: "education",
    subCategory: "Basic education",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the education
    // spending channel drives literacy/test-performance readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: ngCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ng_basic_education",
      [
        {
          name: "Free Education Drive Act",
          explanation: "Fully fund free basic education and end out-of-school numbers",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "School Access Act",
          explanation: "Expand school funding, feeding, and teacher numbers",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Basic Education Act",
          explanation: "Maintain the current basic-education funding",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Schooling Act",
          explanation: "Focus funds on the lowest-enrolment regions",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Education Act",
          explanation: "Restrain education spending and rely on community schools",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_tertiary_education",
    countryScope: "ng",
    name: "Tertiary Education Act",
    description: "Sets funding and tuition policy for universities",
    explanation:
      "Governs university funding and whether tuition is free, subsidised, or cost-recovery. Public funding widens access and skills but strains the budget; cost-recovery shifts the burden to families.",
    policyDomain: "education",
    subCategory: "Tertiary education",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the education
    // spending channel drives the workforce-skill / test-performance readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: ngCommitteePositions("Tertiary Education"),
    policyOptions: policyOptions(
      "ng_tertiary_education",
      [
        {
          name: "Free University Act",
          explanation: "Fully fund tuition-free public universities",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Subsidised Tuition Act",
          explanation: "Heavily subsidise tuition and expand student grants",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Tertiary Act",
          explanation: "Maintain the current funding and fee structure",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Student Loan Act",
          explanation: "Shift toward income-contingent student loans",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Cost-Recovery Act",
          explanation: "Move universities to full cost-recovery tuition",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_technical_education",
    countryScope: "ng",
    name: "Technical and Vocational Education Act",
    description: "Sets investment in technical and vocational skills training",
    explanation:
      "Governs funding for technical and vocational education and apprenticeships. Investment builds workforce skills and employment but costs the budget.",
    policyDomain: "education",
    subCategory: "Vocational training",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the education
    // spending channel drives the workforce-skill readout.
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "laborParticipation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: ngCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ng_technical_education",
      [
        {
          name: "National Skills Drive Act",
          explanation: "Major investment in vocational colleges and apprenticeships",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Skills Expansion Act",
          explanation: "Expand technical training and employer partnerships",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Vocational Act",
          explanation: "Maintain the current vocational-training funding",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Employer-Led Training Act",
          explanation: "Shift training costs to employers with light public support",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Skills Act",
          explanation: "Leave skills training to the private market",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_social_safety_net",
    countryScope: "ng",
    name: "Social Safety Net Act",
    description: "Sets the scale of cash transfers and social assistance",
    explanation:
      "Governs conditional and unconditional cash transfers and social assistance for the poorest households. A larger net cuts poverty and inequality but costs the budget.",
    policyDomain: "social",
    subCategory: "Social assistance",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); the welfare spending channel drives
    // the poverty / inequality / food-security cluster readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.4 },
    ],
    positions: ngCommitteePositions("Humanitarian Affairs"),
    policyOptions: policyOptions(
      "ng_social_safety_net",
      [
        {
          name: "Universal Basic Income Act",
          explanation: "A broad cash-transfer floor for all poor households",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Cash Transfer Expansion Act",
          explanation: "Expand conditional cash transfers to more households",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Safety Net Act",
          explanation: "Maintain the current social-register transfers",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Relief Act",
          explanation: "Tighten eligibility to the extreme poor only",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Minimal Welfare Act",
          explanation: "Scale back cash transfers to protect the budget",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_pension_system",
    countryScope: "ng",
    name: "Pension Reform Act",
    description: "Sets the structure and generosity of the pension system",
    explanation:
      "Governs the contributory pension scheme and old-age poverty support. A more generous system protects the elderly but raises long-run liabilities; a leaner one protects the budget.",
    policyDomain: "social",
    subCategory: "Pensions",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); the social-security spending channel
    // drives the poverty / cohesion cluster readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Pensions"),
    policyOptions: policyOptions(
      "ng_pension_system",
      [
        {
          name: "Universal Pension Act",
          explanation: "A tax-funded basic pension for all elderly citizens",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Pension Top-Up Act",
          explanation: "Add a state top-up to the contributory scheme",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Pension Act",
          explanation: "Maintain the current contributory pension scheme",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Private Pension Act",
          explanation: "Shift toward private retirement savings accounts",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Pension Act",
          explanation: "Restrain pension liabilities to protect the budget",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_housing_policy",
    countryScope: "ng",
    name: "Affordable Housing Act",
    description: "Sets public investment in affordable housing",
    explanation:
      "Governs public housing programmes and mortgage support versus a market-led housing sector. Investment improves affordability and cuts homelessness but costs the budget.",
    policyDomain: "social",
    subCategory: "Housing",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); the welfare spending channel drives
    // the housing-affordability / homelessness cluster readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Housing"),
    policyOptions: policyOptions(
      "ng_housing_policy",
      [
        {
          name: "Public Housing Drive Act",
          explanation: "A major public housing construction programme",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Mortgage Support Act",
          explanation: "Subsidise mortgages and expand the housing fund",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Housing Act",
          explanation: "Maintain the current housing-fund framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Developer Incentive Act",
          explanation: "Use tax incentives to spur private housing supply",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Housing Act",
          explanation: "Leave housing supply to the private market",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_gender_equality",
    countryScope: "ng",
    name: "Gender Equality Act",
    description: "Sets policy on women's representation and economic inclusion",
    explanation:
      "Governs measures on women's political representation, economic inclusion, and protection from violence. Stronger measures advance equality and cohesion; opponents frame them as overreach.",
    policyDomain: "social",
    subCategory: "Gender policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "genderEquality", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "genderEquality", weight: 0.7 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Women's Affairs"),
    policyOptions: policyOptions(
      "ng_gender_equality",
      [
        {
          name: "Gender Parity Act",
          explanation: "Legislated representation quotas and strong protections",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Inclusion Expansion Act",
          explanation: "Expand women's economic inclusion and legal protections",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Equality Act",
          explanation: "Maintain current equality provisions",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Traditional Norms Act",
          explanation: "Defer to customary and religious norms on gender roles",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Conservative Family Act",
          explanation: "Entrench traditional family structures in law",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_foreign_policy",
    countryScope: "ng",
    name: "Foreign Policy Doctrine Act",
    description: "Sets the orientation of Nigeria's foreign relations",
    explanation:
      "Governs the broad orientation of foreign policy — non-aligned multilateralism, Western alignment, or partnership with rising powers. Shapes trade, investment, and diplomatic standing.",
    policyDomain: "foreign_policy",
    subCategory: "Foreign relations",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "population", metricId: "migrationRate", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Foreign Affairs"),
    policyOptions: policyOptions(
      "ng_foreign_policy",
      [
        {
          name: "South-South Solidarity Act",
          explanation: "Prioritise non-aligned and developing-world partnerships",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Multilateral Engagement Act",
          explanation: "Lead through the AU, ECOWAS, and the UN",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Balanced Diplomacy Act",
          explanation: "Maintain a non-aligned, interest-driven foreign policy",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Western Partnership Act",
          explanation: "Deepen security and trade ties with Western powers",
          stance: "right",
          economic: 0,
          social: 2,
        },
        {
          name: "Great-Power Alignment Act",
          explanation: "Align closely with a major external power for investment",
          stance: "right",
          economic: 0,
          social: 4,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_regional_integration",
    countryScope: "ng",
    name: "Regional Integration Act",
    description: "Sets Nigeria's commitment to West African economic integration",
    explanation:
      "Governs commitment to ECOWAS free movement, the continental free-trade area, and a common regional market. Deeper integration boosts trade and growth but cedes some policy autonomy.",
    policyDomain: "foreign_policy",
    subCategory: "Regional integration",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Foreign Affairs"),
    policyOptions: policyOptions(
      "ng_regional_integration",
      [
        {
          name: "Open Borders Act",
          explanation: "Full ECOWAS free movement and a single regional market",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Free Trade Area Act",
          explanation: "Ratify and implement the continental free-trade area in full",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Measured Integration Act",
          explanation: "Maintain the current pace of regional integration",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Protected Market Act",
          explanation: "Slow integration to shield domestic producers",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Economic Nationalism Act",
          explanation: "Prioritise domestic markets over regional commitments",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_policing_reform",
    countryScope: "ng",
    name: "Police Reform Act",
    description: "Sets the model for policing and community safety",
    explanation:
      "Governs police funding, accountability, and the balance between enforcement and community policing. Stronger enforcement can cut crime; reform-minded approaches rebuild public trust.",
    policyDomain: "publicSafety",
    subCategory: "Policing",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); the public-safety spending channel
    // drives the crime / confidence readouts.
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Police Affairs"),
    policyOptions: policyOptions(
      "ng_policing_reform",
      [
        {
          name: "Community Policing Act",
          explanation: "Invest in community policing, oversight, and accountability",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Police Accountability Act",
          explanation: "Expand civilian oversight and reform police conduct",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Policing Act",
          explanation: "Maintain the current policing model",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Enforcement Surge Act",
          explanation: "Expand police numbers and hardware for tougher enforcement",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Hardline Security Act",
          explanation: "Maximal enforcement powers and rapid-response units",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_criminal_justice",
    countryScope: "ng",
    name: "Criminal Justice Reform Act",
    description: "Sets the balance between rehabilitation and incarceration",
    explanation:
      "Governs sentencing, prison conditions, and rehabilitation versus a punitive model. Rehabilitation cuts reoffending; a punitive model emphasises deterrence and incarceration.",
    policyDomain: "publicSafety",
    subCategory: "Criminal justice",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "recidivismRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "recidivismRate", weight: 0.5 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: -0.4 },
      { metricCategoryId: "publicSafety", metricId: "incarcerationRate", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Justice"),
    policyOptions: policyOptions(
      "ng_criminal_justice",
      [
        {
          name: "Rehabilitation Act",
          explanation: "Prioritise rehabilitation, diversion, and reintegration",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Justice Reform Act",
          explanation: "Reduce pre-trial detention and expand non-custodial sentences",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Justice Act",
          explanation: "Maintain the current sentencing framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Tough Sentencing Act",
          explanation: "Lengthen sentences and limit parole",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Maximum Deterrence Act",
          explanation: "Mandatory minimums and expanded incarceration",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_counterinsurgency",
    countryScope: "ng",
    name: "Counter-Insurgency Act",
    description: "Sets the strategy against insurgency and banditry",
    explanation:
      "Governs the balance between military force and a development-led approach to insurgency, banditry, and communal conflict. Force can restore order; development addresses root causes. Both are costly.",
    policyDomain: "defense",
    subCategory: "Internal security",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "violentCrimeRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "violentCrimeRate", weight: -0.5 },
      { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: ngCommitteePositions("Defence"),
    policyOptions: policyOptions(
      "ng_counterinsurgency",
      [
        {
          name: "Development-Led Peace Act",
          explanation: "Address insurgency through development, amnesty, and dialogue",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Stabilisation Act",
          explanation: "Combine security operations with reconstruction",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Security Act",
          explanation: "Maintain the current counter-insurgency posture",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Military Surge Act",
          explanation: "Expand military operations against armed groups",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Total Force Act",
          explanation: "Maximal military mobilisation to crush insurgency",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_defense_policy",
    countryScope: "ng",
    name: "National Defence Act",
    description: "Sets the level of defence spending and modernisation",
    explanation:
      "Governs the size, modernisation, and posture of the armed forces. Higher spending builds capability and confidence but draws from the budget.",
    policyDomain: "defense",
    subCategory: "Defence policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "publicSafety", metricId: "violentCrimeRate", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: ngCommitteePositions("Defence"),
    policyOptions: policyOptions(
      "ng_defense_policy",
      [
        {
          name: "Defence Buildup Act",
          explanation: "Major investment in modernising the armed forces",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Force Modernisation Act",
          explanation: "Increase defence spending and equipment renewal",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Defence Act",
          explanation: "Maintain the current defence budget",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Defence Restraint Act",
          explanation: "Trim defence spending toward core capabilities",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Forces Act",
          explanation: "Cut the defence budget sharply to protect fiscal balance",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_anti_corruption",
    countryScope: "ng",
    name: "Anti-Corruption Act",
    description: "Sets the strength of anti-corruption enforcement",
    explanation:
      "Governs the powers and independence of anti-corruption agencies, asset declaration, and transparency rules. Stronger enforcement raises transparency and trust but meets entrenched resistance.",
    policyDomain: "governance",
    subCategory: "Anti-corruption",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "corruptionIndex",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "corruptionIndex", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Anti-Corruption"),
    policyOptions: policyOptions(
      "ng_anti_corruption",
      [
        {
          name: "Independent Agencies Act",
          explanation: "Fully empower and insulate anti-corruption agencies",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Transparency Expansion Act",
          explanation: "Strengthen asset declaration and open-contracting rules",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Integrity Act",
          explanation: "Maintain current anti-corruption provisions",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Executive Oversight Act",
          explanation: "Place anti-corruption bodies under executive control",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Discretionary Enforcement Act",
          explanation: "Scale back independent enforcement powers",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_judiciary_reform",
    countryScope: "ng",
    name: "Judicial Reform Act",
    description: "Sets the independence and capacity of the judiciary",
    explanation:
      "Governs judicial independence, funding, and case-processing capacity. A stronger, better-funded judiciary improves the rule of law and trust but requires resources and cedes executive leverage.",
    policyDomain: "governance",
    subCategory: "Judiciary",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Judiciary"),
    policyOptions: policyOptions(
      "ng_judiciary_reform",
      [
        {
          name: "Judicial Independence Act",
          explanation: "Guarantee judicial funding and insulate appointments",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Courts Capacity Act",
          explanation: "Fund more judges and digital case management",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Judiciary Act",
          explanation: "Maintain the current judicial framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Executive Appointment Act",
          explanation: "Increase executive influence over judicial appointments",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Constrained Courts Act",
          explanation: "Limit judicial review of executive action",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_electoral_reform",
    countryScope: "ng",
    name: "Electoral Reform Act",
    description: "Sets the integrity and inclusiveness of elections",
    explanation:
      "Governs electoral technology, transparency, and access. Stronger reforms raise turnout and trust in the process; opponents resist changes that dilute incumbency advantages.",
    policyDomain: "governance",
    subCategory: "Elections",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "voterTurnout", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.4 },
    ],
    positions: ngCommitteePositions("Electoral Matters"),
    policyOptions: policyOptions(
      "ng_electoral_reform",
      [
        {
          name: "Full Electronic Voting Act",
          explanation: "Electronic voting, transmission, and same-day results",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Electoral Integrity Act",
          explanation: "Expand biometric accreditation and result transparency",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Elections Act",
          explanation: "Maintain the current electoral framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Incumbent Safeguard Act",
          explanation: "Slow-walk reforms that weaken incumbents",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Restricted Access Act",
          explanation: "Tighten registration and limit electoral oversight",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_federalism",
    countryScope: "ng",
    name: "Fiscal Federalism Act",
    description: "Sets the balance of power and revenue between centre and states",
    explanation:
      "Governs revenue allocation, resource control, and devolution of powers to the states. Greater devolution can improve responsiveness and cohesion but complicates national coordination.",
    policyDomain: "governance",
    subCategory: "Federalism",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Constitutional Review"),
    policyOptions: policyOptions(
      "ng_federalism",
      [
        {
          name: "Devolution Act",
          explanation: "Devolve resource control and powers to the states",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "State Empowerment Act",
          explanation: "Increase state revenue shares and responsibilities",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Federalism Act",
          explanation: "Maintain the current revenue-allocation formula",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Central Coordination Act",
          explanation: "Strengthen federal coordination over the states",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Centralisation Act",
          explanation: "Concentrate revenue and powers at the centre",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_civil_service_reform",
    countryScope: "ng",
    name: "Civil Service Reform Act",
    description: "Sets the size, pay, and efficiency of the public service",
    explanation:
      "Governs civil-service size, digitisation, and merit reform. Modernisation improves transparency and service delivery; right-sizing protects the budget but meets union resistance.",
    policyDomain: "governance",
    subCategory: "Public administration",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: ngCommitteePositions("Public Service"),
    policyOptions: policyOptions(
      "ng_civil_service_reform",
      [
        {
          name: "Service Expansion Act",
          explanation: "Grow and better-pay the civil service to deliver more",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Capacity Building Act",
          explanation: "Invest in training and digitising the public service",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Service Act",
          explanation: "Maintain the current civil-service structure",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Efficiency Reform Act",
          explanation: "Trim duplication and tie pay to performance",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Government Act",
          explanation: "Sharply reduce the public payroll to cut costs",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_press_freedom",
    countryScope: "ng",
    name: "Press Freedom Act",
    description: "Sets protections for the press and free expression",
    explanation:
      "Governs media freedom, journalist protection, and the limits of state regulation of speech. Stronger protections raise press freedom and trust; tighter control curbs dissent.",
    policyDomain: "governance",
    subCategory: "Media freedom",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: 0.7 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "mediaInformation", metricId: "mediaPolarization", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Information"),
    policyOptions: policyOptions(
      "ng_press_freedom",
      [
        {
          name: "Free Press Act",
          explanation: "Strong constitutional protections for the press",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Journalist Protection Act",
          explanation: "Decriminalise defamation and protect sources",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Media Act",
          explanation: "Maintain current media regulation",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Media Regulation Act",
          explanation: "Tighten licensing and content rules",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "State Information Act",
          explanation: "Bring broadcasting and online speech under state control",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_digital_economy",
    countryScope: "ng",
    name: "Digital Economy Act",
    description: "Sets policy for the technology and digital-services sector",
    explanation:
      "Governs support for the technology sector, broadband access, and the regulatory environment for startups. A market-friendly stance spurs business formation; a state-led stance directs investment.",
    policyDomain: "technology",
    subCategory: "Digital economy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: ngCommitteePositions("Communications and Digital Economy"),
    policyOptions: policyOptions(
      "ng_digital_economy",
      [
        {
          name: "State Digital Investment Act",
          explanation: "State-led investment in digital infrastructure and skills",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Public Broadband Act",
          explanation: "Public funding to extend broadband to underserved areas",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Digital Act",
          explanation: "Maintain the current digital-economy framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Startup Enabling Act",
          explanation: "Cut red tape and taxes for technology startups",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Free Market Tech Act",
          explanation: "Light-touch regulation and full market liberalisation",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_water_sanitation",
    countryScope: "ng",
    name: "Water and Sanitation Act",
    description: "Sets investment in clean water and sanitation",
    explanation:
      "Governs investment in clean water supply and sanitation. Investment cuts disease and improves quality of life but costs the budget.",
    policyDomain: "infrastructure",
    subCategory: "Water and sanitation",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); spending channel drives water readout.
    // preventableMortality is safe here (infrastructure budget key, not healthcare).
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Water Resources"),
    policyOptions: policyOptions(
      "ng_water_sanitation",
      [
        {
          name: "Universal Water Act",
          explanation: "A national programme for clean water and sanitation for all",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Water Access Act",
          explanation: "Expand water schemes and rural sanitation",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Water Act",
          explanation: "Maintain the current water-sector funding",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Utility Concession Act",
          explanation: "Bring in private operators under concessions",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Water Act",
          explanation: "Rely on private and community water provision",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_environmental_protection",
    countryScope: "ng",
    name: "Environmental Protection Act",
    description: "Sets the strength of environmental and conservation regulation",
    explanation:
      "Governs conservation, anti-pollution rules, and protection against desertification and oil-spill damage. Stronger rules protect land and air but constrain extractive industry. Enforcement costs the budget.",
    policyDomain: "environment",
    subCategory: "Conservation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "environment", metricId: "protectedLand", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "protectedLand", weight: 0.6 },
      { metricCategoryId: "environment", metricId: "airQuality", weight: 0.4 },
      { metricCategoryId: "environment", metricId: "climateResilience", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: ngCommitteePositions("Environment"),
    policyOptions: policyOptions(
      "ng_environmental_protection",
      [
        {
          name: "Strong Protection Act",
          explanation: "Strict conservation, anti-pollution, and clean-up mandates",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Conservation Expansion Act",
          explanation: "Expand protected areas and pollution enforcement",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Environment Act",
          explanation: "Maintain the current environmental rules",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light Regulation Act",
          explanation: "Ease environmental rules to support industry",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Extraction Priority Act",
          explanation: "Minimise environmental constraints on extractive industry",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_population_policy",
    countryScope: "ng",
    name: "Population and Family Policy Act",
    description: "Sets policy on population growth, family planning, and urban drift",
    explanation:
      "Governs family-planning access, reproductive health, and the management of rapid population growth and urbanisation. Investment eases dependency pressures; opponents cite cultural and religious concerns.",
    policyDomain: "population",
    subCategory: "Population policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "povertyRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Population"),
    policyOptions: policyOptions(
      "ng_population_policy",
      [
        {
          name: "Family Planning Act",
          explanation: "Universal access to family planning and reproductive health",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Reproductive Health Act",
          explanation: "Expand reproductive-health services and education",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Population Act",
          explanation: "Maintain the current population programmes",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Traditional Family Act",
          explanation: "Limit state involvement in family-size decisions",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Pronatalist Act",
          explanation: "Actively encourage larger families",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ── Additional domains (5c continued) ───────────────────────────────────────
  {
    _id: "ng_labor_rights",
    countryScope: "ng",
    name: "Labour Rights Act",
    description: "Sets the strength of worker protections and union rights",
    explanation:
      "Governs collective bargaining, job protection, and workplace standards versus labour-market flexibility. Stronger rights raise participation and equality; flexibility eases hiring and business formation.",
    policyDomain: "labor",
    subCategory: "Labour standards",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "laborParticipation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    positions: ngCommitteePositions("Labour and Employment"),
    policyOptions: policyOptions(
      "ng_labor_rights",
      [
        {
          name: "Strong Labour Rights Act",
          explanation: "Robust collective bargaining and strong job protection",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Worker Protection Act",
          explanation: "Expand workplace standards and union recognition",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Labour Act",
          explanation: "Maintain the current labour framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Flexible Labour Act",
          explanation: "Ease hiring-and-firing and reduce compliance burdens",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Labour Deregulation Act",
          explanation: "Minimal labour regulation and at-will employment",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_sme_support",
    countryScope: "ng",
    name: "Small Business Support Act",
    description: "Sets state support for small and medium enterprises",
    explanation:
      "Governs credit, grants, and regulatory relief for small and medium enterprises. Support spurs business formation and jobs but costs the budget; a market approach relies on private finance.",
    policyDomain: "economic",
    subCategory: "Enterprise policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Industry"),
    policyOptions: policyOptions(
      "ng_sme_support",
      [
        {
          name: "SME Credit Drive Act",
          explanation: "Large public credit and grant programmes for small business",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Enterprise Support Act",
          explanation: "Expand SME credit guarantees and incubation",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Enterprise Act",
          explanation: "Maintain the current SME support framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Red Tape Reduction Act",
          explanation: "Cut registration and compliance costs for small firms",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Finance Act",
          explanation: "Rely on private finance with minimal public support",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_trade_promotion",
    countryScope: "ng",
    name: "Export Promotion Act",
    description: "Sets support for non-oil exports and trade competitiveness",
    explanation:
      "Governs export incentives, trade-zone development, and diversification away from oil. Support lifts non-oil trade and growth but costs the budget.",
    policyDomain: "economic",
    subCategory: "Trade policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Trade and Investment"),
    policyOptions: policyOptions(
      "ng_trade_promotion",
      [
        {
          name: "Export Drive Act",
          explanation: "Aggressive export incentives and special economic zones",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Diversification Act",
          explanation: "Targeted support for non-oil export sectors",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Trade Act",
          explanation: "Maintain the current export-promotion framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Lean Trade Support Act",
          explanation: "Trim export subsidies and rely on competitiveness",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Trade Act",
          explanation: "End export subsidies entirely",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_solid_minerals",
    countryScope: "ng",
    name: "Solid Minerals Development Act",
    description: "Sets policy for the mining and solid-minerals sector",
    explanation:
      "Governs the development and regulation of mining outside oil and gas. State-led development can diversify the economy; a liberal regime attracts private capital. Both interact with revenue and the environment.",
    policyDomain: "economic",
    subCategory: "Extractive industry",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Solid Minerals"),
    policyOptions: policyOptions(
      "ng_solid_minerals",
      [
        {
          name: "State Mining Act",
          explanation: "State-led development of strategic mineral resources",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Mineral Development Act",
          explanation: "Public investment with community benefit-sharing",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Minerals Act",
          explanation: "Maintain the current mining framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Investor Mining Act",
          explanation: "Liberalise licensing to attract private miners",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Free Mining Market Act",
          explanation: "Minimal regulation and full private development",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_youth_employment",
    countryScope: "ng",
    name: "Youth Employment Act",
    description: "Sets state programmes for youth jobs and entrepreneurship",
    explanation:
      "Governs public youth-employment schemes, internships, and entrepreneurship grants for a very young population. Investment cuts youth unemployment but costs the budget.",
    policyDomain: "economic",
    subCategory: "Youth employment",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "unemploymentRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Youth Development"),
    policyOptions: policyOptions(
      "ng_youth_employment",
      [
        {
          name: "National Youth Jobs Act",
          explanation: "A large public youth-employment and stipend programme",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Youth Opportunity Act",
          explanation: "Expand internships, skills, and entrepreneurship grants",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Youth Act",
          explanation: "Maintain the current youth-employment schemes",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Private Apprenticeship Act",
          explanation: "Shift youth training to employer-led apprenticeships",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Market Jobs Act",
          explanation: "Rely on growth and the market to absorb youth labour",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_land_reform",
    countryScope: "ng",
    name: "Land Use Reform Act",
    description: "Sets policy on land tenure and agricultural land access",
    explanation:
      "Governs reform of land tenure under the Land Use framework — titling, access for farmers, and resolution of land disputes. Reform improves food security and rural incomes but is politically contested.",
    policyDomain: "agriculture",
    subCategory: "Land policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "foodInsecurity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "foodInsecurity", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.2 },
    ],
    positions: ngCommitteePositions("Agriculture"),
    policyOptions: policyOptions(
      "ng_land_reform",
      [
        {
          name: "Land Redistribution Act",
          explanation: "Redistribute and title land to smallholder farmers",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Tenure Security Act",
          explanation: "Expand titling and protect customary land rights",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Land Act",
          explanation: "Maintain the current land-use framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Land Market Act",
          explanation: "Liberalise land markets for commercial investment",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Private Land Act",
          explanation: "Full private land titling and free transferability",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_maternal_child_health",
    countryScope: "ng",
    name: "Maternal and Child Health Act",
    description: "Sets investment in maternal and child health services",
    explanation:
      "Governs funding for maternal and child health, immunisation, and nutrition. Investment sharply cuts preventable deaths in a high-mortality setting but costs the budget.",
    policyDomain: "healthcare",
    subCategory: "Maternal and child health",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the spending
    // channel drives the mortality/life-expectancy readouts.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ng_maternal_child_health",
      [
        {
          name: "Free Maternal Care Act",
          explanation: "Free maternal and child health care nationwide",
          stance: "left",
          economic: -5,
          social: 0,
        },
        {
          name: "Child Health Expansion Act",
          explanation: "Expand immunisation, nutrition, and antenatal care",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Maternal Health Act",
          explanation: "Maintain the current maternal-and-child programmes",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Maternal Act",
          explanation: "Focus funding on the highest-mortality regions",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Lean Maternal Budget Act",
          explanation: "Restrain spending to core maternal services",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_mental_health",
    countryScope: "ng",
    name: "Mental Health Act",
    description: "Sets investment in and protections for mental health care",
    explanation:
      "Governs mental-health funding, integration into primary care, and protection from stigma. Investment widens access and cohesion but costs the budget.",
    policyDomain: "healthcare",
    subCategory: "Mental health",
    nationalOnly: true,
    // Funding law — fiscal/macro weighted effects only (§4.7); the spending
    // channel drives the mental-health-access readout.
    effectTarget: { metricCategoryId: "social", metricId: "socialCohesion", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: ngCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ng_mental_health",
      [
        {
          name: "Universal Mental Health Act",
          explanation: "Integrate mental-health care into universal services",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Mental Health Access Act",
          explanation: "Expand community mental-health services and training",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Mental Health Act",
          explanation: "Maintain the current mental-health provisions",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Mental Health Act",
          explanation: "Limit funding to acute services",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Minimal Mental Health Act",
          explanation: "Rely on private and community provision",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_disability_inclusion",
    countryScope: "ng",
    name: "Disability Inclusion Act",
    description: "Sets protections and inclusion measures for persons with disabilities",
    explanation:
      "Governs accessibility mandates, anti-discrimination protections, and inclusion support for persons with disabilities. Stronger measures advance inclusion and mobility; opponents cite compliance costs.",
    policyDomain: "social",
    subCategory: "Disability policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Disability Affairs"),
    policyOptions: policyOptions(
      "ng_disability_inclusion",
      [
        {
          name: "Full Inclusion Act",
          explanation: "Strong accessibility mandates and inclusion funding",
          stance: "left",
          economic: 0,
          social: -5,
        },
        {
          name: "Accessibility Expansion Act",
          explanation: "Expand accessibility standards and anti-discrimination rules",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Disability Act",
          explanation: "Maintain current disability provisions",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Voluntary Compliance Act",
          explanation: "Make accessibility largely voluntary for business",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Minimal Mandate Act",
          explanation: "Limit disability mandates to public buildings",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_immigration_policy",
    countryScope: "ng",
    name: "Immigration and Migration Act",
    description: "Sets policy on migration, diaspora, and free movement",
    explanation:
      "Governs immigration controls, regional free movement, and engagement with the large Nigerian diaspora. Openness supports labour and remittances; tighter controls emphasise security.",
    policyDomain: "governance",
    subCategory: "Migration",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "population", metricId: "migrationRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "population", metricId: "migrationRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.2 },
      // Right-lane axis metric: tighter controls (right) raise borderSecurity.
      { metricCategoryId: "governance", metricId: "borderSecurity", weight: -0.4 },
    ],
    positions: ngCommitteePositions("Interior"),
    policyOptions: policyOptions(
      "ng_immigration_policy",
      [
        {
          name: "Open Movement Act",
          explanation: "Full regional free movement and active diaspora engagement",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Managed Openness Act",
          explanation: "Streamline visas and protect migrant workers",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Migration Act",
          explanation: "Maintain the current immigration framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Controlled Borders Act",
          explanation: "Tighten entry controls and work permits",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Security-First Migration Act",
          explanation: "Strict border control and limited immigration",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
  {
    _id: "ng_telecommunications",
    countryScope: "ng",
    name: "Telecommunications Act",
    description: "Sets policy for the telecoms sector and broadband access",
    explanation:
      "Governs telecoms regulation, spectrum, and the drive to extend broadband. Public investment widens access; a market-led approach relies on private operators.",
    policyDomain: "governance",
    subCategory: "Telecommunications",
    nationalOnly: true,
    // Funding law — fiscal/macro only (§4.7); spending channel drives broadband readout.
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Communications and Digital Economy"),
    policyOptions: policyOptions(
      "ng_telecommunications",
      [
        {
          name: "Universal Broadband Act",
          explanation: "Public funding to bring broadband to every region",
          stance: "left",
          economic: -4,
          social: 0,
        },
        {
          name: "Connectivity Expansion Act",
          explanation: "Subsidise rural connectivity and shared infrastructure",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Telecoms Act",
          explanation: "Maintain the current telecoms framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Operator-Led Rollout Act",
          explanation: "Rely on licensed operators with light regulation",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          name: "Free Market Telecoms Act",
          explanation: "Full liberalisation and minimal regulation",
          stance: "right",
          economic: 5,
          social: 0,
        },
      ],
      "economic"
    ),
  },
  {
    _id: "ng_local_government",
    countryScope: "ng",
    name: "Local Government Autonomy Act",
    description: "Sets the autonomy and funding of local governments",
    explanation:
      "Governs the financial and administrative autonomy of local governments. Greater autonomy can improve grassroots service delivery and trust but reduces state-government control.",
    policyDomain: "governance",
    subCategory: "Local government",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
    ],
    positions: ngCommitteePositions("Local Government"),
    policyOptions: policyOptions(
      "ng_local_government",
      [
        {
          name: "Local Autonomy Act",
          explanation: "Guarantee direct funding and full local-government autonomy",
          stance: "left",
          economic: 0,
          social: -4,
        },
        {
          name: "Grassroots Empowerment Act",
          explanation: "Strengthen local-government powers and accountability",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Statutory Local Government Act",
          explanation: "Maintain the current local-government framework",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "State Oversight Act",
          explanation: "Retain state-government control over local councils",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Centralised Councils Act",
          explanation: "Subordinate local councils fully to state governments",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  Spending calibration — attach `budgetCategory` + per-capita NGN cost to NG
//  spending programs so the federal budget seeds full expenditure lines (without
//  this, deriveEnactedLaws skips them and NG spending is baseline-only / inert
//  to policy choices). Mirrors the CN calibration pattern.
//
//  Per-capita figures are NGN/capita/year at the seeded default option (index 2,
//  the center bracket). The NG_SPENDING_CURVE grades cost across the 5 options;
//  NG authors the higher-spending option on the LEFT (index 0), so the curve is
//  highest at index 0 and lowest at index 4, =1.0 at the center.
//
//  Σ(per-capita × 200M population) per category reconciles to NG 2019
//  baselineSpendingByCategory in src/lib/seeds/reference/budgets.ts. The absolute
//  costs are GDP-indexed per era by COST_SCALE_ANCHORS.NG (so the 1991 preset
//  scales them down ~40× rather than over-stating a ₦1.8T-GDP budget).
//
//  Regulatory / rule-only types (taxes, minimum wage, labour rights, industrial
//  vs-market stance, anti-corruption, judiciary, electoral, federalism, press
//  freedom, immigration, disability, gender, local government, population,
//  foreign policy, regional integration, petroleum/fiscal stance, environmental
//  rules) carry no standing expenditure line and are intentionally omitted.
// ════════════════════════════════════════════════════════════════════════════
const NG_SPENDING_CURVE = [1.8, 1.4, 1.0, 0.6, 0.3];

const NG_SPENDING_CALIBRATION: Record<
  string,
  { category: string; baseline: number; curve: number[] }
> = {
  // ── Healthcare (≈ ₦300B; ₦1,500/capita) ─────────────────────────────────────
  ng_health_insurance: { category: "healthcare", baseline: 600, curve: NG_SPENDING_CURVE },
  ng_primary_healthcare: { category: "healthcare", baseline: 400, curve: NG_SPENDING_CURVE },
  ng_public_health: { category: "healthcare", baseline: 200, curve: NG_SPENDING_CURVE },
  ng_maternal_child_health: { category: "healthcare", baseline: 200, curve: NG_SPENDING_CURVE },
  ng_mental_health: { category: "healthcare", baseline: 100, curve: NG_SPENDING_CURVE },
  // ── Education (≈ ₦500B; ₦2,500/capita) ──────────────────────────────────────
  ng_basic_education: { category: "education", baseline: 1500, curve: NG_SPENDING_CURVE },
  ng_tertiary_education: { category: "education", baseline: 700, curve: NG_SPENDING_CURVE },
  ng_technical_education: { category: "education", baseline: 300, curve: NG_SPENDING_CURVE },
  // ── Social Security (≈ ₦1.5T; ₦7,500/capita) ────────────────────────────────
  ng_pension_system: { category: "socialSecurity", baseline: 7500, curve: NG_SPENDING_CURVE },
  // ── Welfare (≈ ₦400B; ₦2,000/capita) ────────────────────────────────────────
  ng_social_safety_net: { category: "welfare", baseline: 1200, curve: NG_SPENDING_CURVE },
  ng_housing_policy: { category: "welfare", baseline: 800, curve: NG_SPENDING_CURVE },
  // ── Defense (≈ ₦600B; ₦3,000/capita) ────────────────────────────────────────
  ng_defense_policy: { category: "defense", baseline: 2000, curve: NG_SPENDING_CURVE },
  ng_counterinsurgency: { category: "defense", baseline: 1000, curve: NG_SPENDING_CURVE },
  // ── Infrastructure (≈ ₦2.0T; ₦10,000/capita) ────────────────────────────────
  ng_infrastructure_investment: {
    category: "infrastructure",
    baseline: 4000,
    curve: NG_SPENDING_CURVE,
  },
  ng_power_sector_reform: { category: "infrastructure", baseline: 3000, curve: NG_SPENDING_CURVE },
  ng_water_sanitation: { category: "infrastructure", baseline: 1500, curve: NG_SPENDING_CURVE },
  ng_telecommunications: { category: "infrastructure", baseline: 1000, curve: NG_SPENDING_CURVE },
  ng_renewable_energy: { category: "infrastructure", baseline: 500, curve: NG_SPENDING_CURVE },
  // ── Public Safety (≈ ₦200B; ₦1,000/capita) ──────────────────────────────────
  ng_policing_reform: { category: "publicSafety", baseline: 1000, curve: NG_SPENDING_CURVE },
  // ── Agriculture (≈ ₦300B; ₦1,500/capita) ────────────────────────────────────
  ng_agriculture_policy: { category: "agriculture", baseline: 1000, curve: NG_SPENDING_CURVE },
  ng_land_reform: { category: "agriculture", baseline: 500, curve: NG_SPENDING_CURVE },
  // ── Other central programs (≈ ₦3.0T; ₦15,000/capita) ────────────────────────
  ng_civil_service_reform: { category: "other", baseline: 5000, curve: NG_SPENDING_CURVE },
  ng_industrial_policy: { category: "other", baseline: 3000, curve: NG_SPENDING_CURVE },
  ng_youth_employment: { category: "other", baseline: 2000, curve: NG_SPENDING_CURVE },
  ng_digital_economy: { category: "other", baseline: 1500, curve: NG_SPENDING_CURVE },
  ng_sme_support: { category: "other", baseline: 1500, curve: NG_SPENDING_CURVE },
  ng_trade_promotion: { category: "other", baseline: 1000, curve: NG_SPENDING_CURVE },
  ng_solid_minerals: { category: "other", baseline: 1000, curve: NG_SPENDING_CURVE },
};

const ngCalibratedIds = new Set<string>();
for (const lt of ngLegislationTypes) {
  const cal = NG_SPENDING_CALIBRATION[lt._id];
  if (!cal) continue;
  lt.budgetCategory = cal.category;
  const { baseline, curve } = cal;
  const options = lt.policyOptions ?? [];
  if (options.length !== curve.length) {
    throw new Error(
      `NG spending calibration for ${lt._id}: expected ${curve.length} options, got ${options.length}`
    );
  }
  lt.policyOptions = withPerCapitaCosts(
    options,
    curve.map((m) => Math.round(baseline * m))
  );
  ngCalibratedIds.add(lt._id);
}
// Guard against a mistyped calibration key silently under-seeding spending.
const ngUnmatched = Object.keys(NG_SPENDING_CALIBRATION).filter((id) => !ngCalibratedIds.has(id));
if (ngUnmatched.length > 0) {
  throw new Error(`NG spending calibration references unknown type ids: ${ngUnmatched.join(", ")}`);
}
