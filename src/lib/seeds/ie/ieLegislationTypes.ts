import type { LegislationType } from "@/lib/db/types/legislation";
import {
  policyOptions,
  taxRateOptions,
  withPerCapitaCosts,
} from "../reference/policyOptionHelpers";

/**
 * Weight-sign convention for `effectTargetsWeighted` on IE legislation
 * (verified against `shared/constants/formulas.ts:calculatePolicyContribution`
 * and `src/lib/policyEffects.ts:calculateMetricTarget`, corrected 2026-05-28
 * after auditing peer seeds — the original PR1 doc had the sign flipped):
 *
 *   Engine formula per target:
 *     contribution = effectDirection × weight × MAX × scope × effectSign
 *     where effectSign = isHigherBetter ? +1 : -1
 *     and the engine adds `contribution` directly to `baseline`.
 *
 *   `effectDirection` is set by the option helpers via stance:
 *     - Non-tax `policyOptions`: left = +1, right = -1, center = 0
 *     - Tax `taxRateOptions`: left = -1, right = +1, center = 0
 *       (The stance label tracks political content, not rate level — e.g.
 *       "VAT abolition" is `stance: "left"` even at rate=0%, and "Maximum
 *       Consumption Tax Act" at rate=35% is `stance: "right"` despite being
 *       a high rate.)
 *
 *   Practical rule when designing `effectTargetsWeighted` (NON-TAX):
 *     • Ask: "Does LEFT-stance push this metric toward its better direction,
 *       or toward its worse direction?"
 *     • POSITIVE weight = LEFT-stance favors this metric's BETTER direction
 *       (and RIGHT-stance favors the worse direction).
 *     • NEGATIVE weight = LEFT-stance favors this metric's WORSE direction
 *       (typically a trade-off — e.g. LEFT spending hurts `budgetBalance`).
 *     • The engine's `effectSign` handles the higher/lower-better polarity
 *       inversion automatically — you only choose the sign of `weight`.
 *
 *   Worked examples:
 *     • Healthcare LEFT = NHS Universal → boosts `lifeExpectancy` (higher
 *       is better) → weight POSITIVE.
 *     • Climate LEFT = strong action → cuts `carbonEmissions` (lower is
 *       better) → weight POSITIVE (engine inverts via effectSign).
 *     • Pensions LEFT = Universal Basic Pension → hurts `budgetBalance`
 *       (higher is better, but LEFT spends more) → weight NEGATIVE.
 *
 *   For TAX (taxRateOptions) types the helper pre-inverts effectDirection,
 *   so the rule reads as "RIGHT-stance (low rate) favors better → POSITIVE".
 *
 *   Peer seeds JP and DE follow this math-correct convention. The CN seed
 *   and the original IE PR2-PR4 weights followed the inverted convention
 *   and were corrected in the same audit pass.
 */

function dailCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "dail_chair",
      name: `Chair, Dáil Committee on ${domainLabel}`,
      chamber: "dail",
    },
    {
      positionId: "dail_vice",
      name: `Vice-Chair, Dáil Committee on ${domainLabel}`,
      chamber: "dail",
    },
  ];
}

export const ieLegislationTypes: LegislationType[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  //  TAX TYPES (11) — PR1 statutory baselines per spec §2
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Corporation Tax (Domestic) ──────────────────────────────────────────────
  {
    _id: "ie_corporate_tax_rate",
    countryScope: "ie",
    name: "Statutory Corporation Tax Act",
    description: "Sets the headline rate of corporation tax on company profits",
    explanation:
      "Ireland's 12.5% corporation tax rate has been the cornerstone of FDI policy since 1997. OECD Pillar Two now imposes a 15% effective minimum on large MNCs above €750M turnover. The domestic rate remains 12.5% for SMEs.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
    policyOptions: taxRateOptions("ie_corporate_tax_rate", [
      {
        rate: 0,
        name: "Corporation Tax Abolition Act",
        description:
          "_Aisghairm na Cánach Corparáide_ — Abolish corporation tax entirely; rely on VAT and income tax to fund government",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 5,
        name: "Ultra-Low Enterprise Rate Act",
        description:
          "Reduce corporation tax to 5%, undercutting every OECD jurisdiction and triple-locking FDI attraction",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 9,
        name: "Reduced Enterprise Rate Extension Act",
        description:
          "Extend the existing 9% trading-profit rate to all sectors, accelerating Celtic-Tiger-style FDI inflows",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 12.5,
        name: "Statutory Corporation Tax Act",
        description:
          "The signature 12.5% rate retained as the cornerstone of Irish industrial policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "OECD Pillar Two Alignment Act",
        description:
          "Apply the OECD 15% minimum effective rate across all companies — full Pillar Two compliance",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
        name: "EU Convergence Corporation Tax Act",
        description:
          "Modest above-statutory rate aligning Ireland with mid-tier EU rates while preserving FDI competitiveness",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 20,
        name: "Domestic Re-Investment Act",
        description:
          "Raise corporation tax to recapture more MNC profits for domestic re-investment in housing and infrastructure",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 23,
        name: "Excess Profit Recapture Act",
        description:
          "Significant rate increase targeting outsized MNC profit-shifting concentrations in pharma and tech",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 26,
        name: "Windfall Profit Tax Act",
        description:
          "Near-OECD-average corporation tax, ending Ireland's tax-haven reputation entirely",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 30,
        name: "FDI Dependence Reduction Act",
        description:
          "Substantially higher corporation tax, accepting reduced FDI inflows in exchange for fiscal capacity",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 33,
        name: "Maximum Corporate Extraction Act",
        description:
          "The highest peacetime corporation tax, designed to fund a Nordic-scale welfare state",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Foreign Corporation Tax ─────────────────────────────────────────────────
  {
    _id: "ie_foreign_corporate_tax_rate",
    countryScope: "ie",
    name: "Foreign Corporation Tax Act",
    description:
      "Sets the rate of corporation tax on foreign-headquartered corps operating in Ireland",
    explanation:
      "Foreign-headquartered corporations are subject to Ireland's 12.5% statutory rate, but Pillar Two is bifurcating the regime: foreign MNCs above €750M turnover effectively pay 15% globally. This Act lets foreign-corp tax diverge from the domestic rate under future legislation.",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "fdiPipelineStrength", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "mncDependency", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
    policyOptions: taxRateOptions("ie_foreign_corporate_tax_rate", [
      {
        rate: 0,
        name: "Foreign Corporation Tax Abolition Act",
        description:
          "_Aisghairm na Cánach Corparáide Eachtraí_ — Abolish foreign corp tax entirely; signal that foreign-HQ'd MNCs operate fee-free in Ireland",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 5,
        name: "Foreign Ultra-Low Rate Act",
        description:
          "Cut foreign corp tax to 5%, tripling FDI inducement versus the domestic 12.5% rate",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 9,
        name: "Foreign Trading Profit Rate Act",
        description: "Apply Ireland's 9% trading-profit rate to all foreign-HQ corporate activity",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 12.5,
        name: "Statutory Foreign Corporation Tax Act",
        description:
          "Day-one parity with domestic 12.5% — foreign and domestic corps treated identically (the historical Irish norm)",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "Pillar Two Minimum Foreign Act",
        description:
          "Apply the OECD Pillar Two 15% minimum to foreign MNCs while domestic SMEs keep 12.5%",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
        name: "Foreign Multinational Convergence Act",
        description: "Modest above-statutory rate aligning foreign MNCs with mid-tier EU rates",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 20,
        name: "MNC Profit-Shift Recapture Act",
        description:
          "Raise foreign corp tax to recapture profit-shifting concentrations in pharma and tech",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 23,
        name: "Foreign Windfall Profit Act",
        description:
          "Significant rate increase on foreign-HQ corps, ending Ireland's tax-haven reputation",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 26,
        name: "Foreign Excess Extraction Act",
        description:
          "Above-OECD-average rate on foreign multinationals while preserving domestic 12.5%",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 30,
        name: "FDI Dependence Acceptance Act",
        description:
          "Substantially higher foreign corp tax, accepting reduced FDI inflows in exchange for fiscal capacity",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 33,
        name: "Maximum Foreign Recapture Act",
        description:
          "The highest peacetime foreign corp tax, designed to fully tax MNC profits at OECD averages",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Income Tax ─────────────────────────────────────────────────────────────
  {
    _id: "ie_income_tax_rate",
    countryScope: "ie",
    name: "Statutory Income Tax Act",
    description: "Adjusts the higher rate of income tax on personal earnings",
    explanation:
      "Ireland's two-band system: 20% standard rate and 40% higher rate. The standard-rate cut-off threshold sits at ~€42,000 for single earners. USC (Universal Social Charge) and PRSI are separate levies. This Act covers the higher-band rate.",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.7 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
    policyOptions: taxRateOptions("ie_income_tax_rate", [
      {
        rate: 0,
        name: "Income Tax Abolition Act",
        description:
          "_Aisghairm na Cánach Ioncaim_ — Abolish income tax entirely; replace with VAT and corporation tax",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 10,
        name: "Single-Band Flat-Tax Act",
        description:
          "Collapse to a single 10% flat rate, eliminating the standard-higher distinction",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 15,
        name: "Reduced Single-Band Act",
        description:
          "Apply only the 15% effective average rate across all earnings, abolishing the higher band",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 20,
        name: "Standard-Rate-Only Act",
        description:
          "Set the higher-band rate to the standard 20%, eliminating progressivity at the top",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 25,
        name: "Below-Standard Higher-Band Act",
        description:
          "Cut the higher rate well below standard to boost middle-class disposable income",
        stance: "right",
        economic: 1,
        social: 1,
      },
      {
        rate: 30,
        name: "Modest Higher-Band Reduction Act",
        description: "Cut higher rate from 40% to 30%, benefiting middle-to-high earners",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 35,
        name: "Sub-Standard Progressivity Act",
        description:
          "Modest below-statutory higher rate balancing fiscal capacity against work incentives",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 40,
        name: "Statutory Income Tax Act",
        description: "Maintain the canonical 20%/40% two-band structure",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 45,
        name: "Progressive Uplift Act",
        description:
          "Introduce a 45% band on incomes above €100,000 to fund housing and health programmes",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 50,
        name: "High-Earner Contribution Act",
        description: "Top-bracket rate at 50%, signaling rejection of low-tax-haven framing",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 55,
        name: "Maximum Redistribution Act",
        description:
          "The highest peacetime income tax, designed to fund a Nordic-scale welfare state",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Universal Social Charge ────────────────────────────────────────────────
  {
    _id: "ie_usc",
    countryScope: "ie",
    name: "Universal Social Charge Act",
    description: "Adjusts the Universal Social Charge — a separate levy on gross income",
    explanation:
      "USC is a progressive surcharge on gross income above thresholds, introduced 2011 as a budget-emergency measure and never repealed. Politically, 'abolishing USC' is a recurring centre-right policy position. Top band 8% (11% for self-employed income over €100k).",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "universalSocialCharge" },
    policyOptions: taxRateOptions("ie_usc", [
      {
        rate: 0,
        name: "USC Abolition Act",
        description:
          "_Aisghairm An Mhuirir Shóisialta Uilíoch_ — Fulfill the long-standing pledge to abolish USC",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 1,
        name: "Token USC Retention Act",
        description:
          "Reduce USC to a near-zero band, preserving the legal instrument for fiscal-emergency reactivation",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 2,
        name: "Low-Income-Only USC Act",
        description: "Apply USC only to a narrow standard band, exempting higher earners",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 4,
        name: "Reduced USC Act",
        description:
          "Cut top USC band substantially below statutory, easing tax burden on professional middle class",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 6,
        name: "Modest USC Reduction Act",
        description: "Below-statutory USC supporting cost-of-living measures",
        stance: "right",
        economic: 1,
        social: 1,
      },
      {
        rate: 8,
        name: "Statutory USC Act",
        description: "Retain the existing 8% top USC band, unchanged from current statutory rate",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 10,
        name: "Above-Statutory USC Act",
        description: "Modest USC increase funding targeted spending in health and housing",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 12,
        name: "Self-Employed-Convergence Act",
        description:
          "Apply the 11% self-employed top rate to all earners — convergence at the higher level",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 14,
        name: "Progressive Surcharge Expansion Act",
        description:
          "Expand USC into a true progressive surcharge with high top band funding social investment",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 16,
        name: "High-Income USC Maximisation Act",
        description: "Near-historic peak USC level, reversing the 'USC abolition' framing entirely",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 20,
        name: "Maximum Social Charge Act",
        description: "The highest USC ever, designed to fund Nordic-scale services",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── PRSI (Pay-Related Social Insurance) ────────────────────────────────────
  {
    _id: "ie_prsi",
    countryScope: "ie",
    name: "Pay-Related Social Insurance Act",
    description: "Sets PRSI rates funding the Social Insurance Fund",
    explanation:
      "PRSI funds the Social Insurance Fund (contributory pensions, jobseeker's benefit, illness benefit, parental benefit). Class A rates: 4% employee + 11.05% employer = ~15.05% combined statutory. This Act covers the combined Class A rate as a single dial.",
    policyDomain: "tax",
    subCategory: "Payroll taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      // A lower payroll tax (right) lowers the cost of hiring, so a higher rate
      // must RAISE unemployment: positive weight (matches DE/CN payroll bills).
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
    policyOptions: taxRateOptions("ie_prsi", [
      {
        rate: 0,
        name: "PRSI Abolition Act",
        description:
          "_Aisghairm an PRSI_ — Abolish PRSI entirely, replacing the Social Insurance Fund with direct exchequer funding",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 2,
        name: "Token PRSI Retention Act",
        description: "Reduce PRSI to a token rate, gutting Social Insurance Fund autonomy",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 4,
        name: "Employee-Only PRSI Act",
        description: "Cut employer PRSI to zero, retain only the 4% employee contribution",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 6,
        name: "Reduced Employer PRSI Act",
        description: "Halve employer PRSI to ease labour costs and incentivise hiring",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 8,
        name: "Modest PRSI Reduction Act",
        description: "Below-statutory PRSI supporting employer competitiveness",
        stance: "right",
        economic: 1,
        social: 1,
      },
      {
        rate: 11,
        name: "Statutory PRSI Act",
        description:
          "Maintain the Class A combined 11.05% statutory rate funding the Social Insurance Fund",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 14,
        name: "PRSI Expansion Act",
        description:
          "Modest PRSI increase strengthening Social Insurance Fund and benefit indexation",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 17,
        name: "Pension Solvency PRSI Act",
        description: "Higher PRSI funding contributory pension long-term solvency",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 20,
        name: "Universal Social Insurance Act",
        description:
          "Substantial PRSI increase enabling truly universal social insurance entitlements",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 23,
        name: "Nordic-Level Contribution Act",
        description: "Near-Nordic PRSI rates funding comprehensive cradle-to-grave benefits",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 26,
        name: "Maximum Social Insurance Act",
        description:
          "The highest PRSI ever, designed to fully fund Nordic-scale welfare entitlements",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Value-Added Tax ────────────────────────────────────────────────────────
  {
    _id: "ie_vat_rate",
    countryScope: "ie",
    name: "Statutory Value-Added Tax Act",
    description: "Sets the standard VAT rate on goods and services",
    explanation:
      "VAT is Ireland's largest single consumption tax. Multi-rate: 23% standard, 13.5% reduced (tourism/hospitality/construction), 9% second-reduced (newspapers/sports), 4.8% livestock, 0% essentials. This Act covers the standard headline rate.",
    policyDomain: "tax",
    subCategory: "Consumption taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.25 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.6 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
    policyOptions: taxRateOptions("ie_vat_rate", [
      {
        rate: 0,
        name: "VAT Abolition Act",
        description:
          "_Aisghairm an CBL_ — Abolish VAT entirely; restructure federal revenue around income and corporation tax only",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 5,
        name: "Consumer Stimulus Maximum Act",
        description: "A token VAT dramatically reducing consumer cost of living",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 9,
        name: "Tourism-Rate Unified Act",
        description: "Apply only the 9% second-reduced rate uniformly across all goods",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 13.5,
        name: "Hospitality-Rate Unified Act",
        description:
          "Set the headline rate to the 13.5% reduced bracket, eliminating differential treatment",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 17,
        name: "Below-Statutory VAT Act",
        description: "Modest reduction supporting household purchasing power",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 21,
        name: "Recession-Stimulus VAT Act",
        description:
          "Below the 23% statutory rate to reduce inflationary pressure (the rate used during emergency hospitality cuts)",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 23,
        name: "Statutory Value-Added Tax Act",
        description:
          "The statutory 23% standard rate paired with retained 13.5% and 9% reduced rates",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 25,
        name: "EU Convergence VAT Act",
        description: "Modest above-statutory VAT aligning Ireland with high-end EU rates",
        stance: "right",
        economic: 1,
        social: 1,
      },
      {
        rate: 27,
        name: "High-VAT Anglo-Continental Act",
        description: "Above-statutory VAT replacing portions of income tax",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 30,
        name: "Consumption-Shift Act",
        description: "High VAT, sharply reduced income tax — shift toward consumption taxation",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 35,
        name: "Maximum Consumption Tax Act",
        description: "The highest VAT, funding government primarily through consumption",
        stance: "right",
        economic: 5,
        social: 2,
      },
    ]),
  },

  // ── Customs Tariff ─────────────────────────────────────────────────────────
  {
    _id: "ie_customs_tariff_rate",
    countryScope: "ie",
    name: "Customs Tariff Act",
    description: "Sets customs duties on imports",
    explanation:
      "Customs duties on imports. Ireland negotiates jointly within EU trade-policy framework, so unilateral tariff changes are legally constrained but politically meaningful (Brexit context, US-EU tariff disputes). Game baseline 0% per project convention. Unusual political axis: low/zero tariffs = EU/free-trade centrist consensus; mid-range tariffs = industrial-policy left framing; very high tariffs = sovereignty/anti-EU right framing.",
    policyDomain: "tax",
    subCategory: "Trade taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "fdiPipelineStrength", weight: -0.5 },
      { metricCategoryId: "economic", metricId: "mncDependency", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
    policyOptions: taxRateOptions("ie_customs_tariff_rate", [
      {
        rate: 0,
        name: "Free Trade Customs Act",
        description:
          "_Acht na Saorthrádála_ — Zero customs duties; the small-open-economy doctrine that has defined Irish economic policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 2,
        name: "Light-Touch CET Act",
        description:
          "Symbolic tariff preserving customs infrastructure within EU Common External Tariff framework",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 5,
        name: "EU Common External Tariff Act",
        description:
          "Standard EU CET on third-country imports — full Single Market compliance, no unilateral deviation",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 8,
        name: "Selective Sector Protection Act",
        description:
          "Above-CET tariff on agri-food and manufacturing under EU-derogation negotiations",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 12,
        name: "Industrial Policy Tariff Act",
        description:
          "Substantial protective tariff supporting domestic manufacturing competitiveness",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 16,
        name: "Strategic Industry Protection Act",
        description:
          "High protective tariffs funding active industrial policy and domestic supply chains",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 20,
        name: "Indigenous Manufacturing Tariff Act",
        description: "Aggressive tariff regime favouring Irish-HQ industry over MNC imports",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 25,
        name: "Sovereignty Tariff Act",
        description:
          "Hard-tariff regime asserting trade sovereignty (would require EU customs-union renegotiation)",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 30,
        name: "Anti-EU Tariff Act",
        description: "Near-autarkic tariffs incompatible with EU Single Market membership",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 40,
        name: "Closed-Economy Act",
        description: "Very high tariffs effectively closing Ireland to imported goods",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 50,
        name: "Maximum Autarkic Tariff Act",
        description: "The highest tariffs ever — full economic isolation, EU-exit prerequisite",
        stance: "right",
        economic: 5,
        social: 2,
      },
    ]),
  },

  // ── Local Property Tax ─────────────────────────────────────────────────────
  {
    _id: "ie_local_property_tax",
    countryScope: "ie",
    name: "Local Property Tax Act",
    description: "Sets the rate of annual self-assessed Local Property Tax",
    explanation:
      "LPT is a self-assessed annual tax on residential property market value, introduced 2013. Banded structure with rates ranging from 0.1029% (low bands) to 0.25%+ (high bands). The Local Adjustment Factor (±15%) allows local-authority deviation from the base rate. This Act covers the mid-band rate as a single dial.",
    policyDomain: "tax",
    subCategory: "Property taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingAffordability",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "housingAffordability", weight: -0.5 },
      { metricCategoryId: "social", metricId: "vacantPropertyRate", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: -0.3 },
      { metricCategoryId: "social", metricId: "homelessnessRate", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "propertyTax" },
    policyOptions: taxRateOptions("ie_local_property_tax", [
      {
        rate: 0,
        name: "Property Tax Abolition Act",
        description:
          "_Aisghairm na Cánach Mhaoine Áitiúil_ — Abolish LPT entirely; leave local-authority funding to LGF + commercial rates only",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 0.05,
        name: "Symbolic LPT Act",
        description:
          "A token LPT preserving the legal instrument without significant revenue impact",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 0.1,
        name: "Statutory Low-Band Act",
        description: "Apply only the LPT lowest-band rate (~0.1029%) uniformly",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 0.15,
        name: "Below-Mid-Band Act",
        description: "Below mid-band LPT supporting homeowner cashflow",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 0.18,
        name: "Statutory Mid-Band Act",
        description: "The current mid-band LPT rate retained at statutory level",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 0.25,
        name: "LPT Modernisation Act",
        description: "Modest above-statutory LPT funding local-authority housing initiatives",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 0.3,
        name: "Housing Affordability Recapture Act",
        description:
          "Above-statutory LPT specifically targeting high-value properties to fund affordable housing",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 0.4,
        name: "Vacancy Disincentive LPT Act",
        description: "Substantial LPT increase using rate-based vacant-property disincentive",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 0.5,
        name: "Property Speculation Cooling Act",
        description: "High LPT cooling speculative-investment incentive on residential property",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 0.75,
        name: "Property Wealth Recapture Act",
        description:
          "Near-punitive LPT extracting property-wealth concentrations for housing investment",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 1.0,
        name: "Maximum Property Wealth Act",
        description: "The highest LPT ever, designed to recapture all property-wealth appreciation",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Stamp Duty ─────────────────────────────────────────────────────────────
  {
    _id: "ie_stamp_duty",
    countryScope: "ie",
    name: "Stamp Duty Act",
    description: "Sets the rate of stamp duty on property and share transactions",
    explanation:
      "Stamp duty on property transfers (1% under €1M, 2% above) and share/securities trades (1%). Multi-rate in real life but LARP'd here as a single dial centered on a 2% averaged rate.",
    policyDomain: "tax",
    subCategory: "Transaction taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.5 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: -0.4 },
      { metricCategoryId: "social", metricId: "vacantPropertyRate", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "social", metricId: "rentalPressureIndex", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "stampDuty" },
    policyOptions: taxRateOptions("ie_stamp_duty", [
      {
        rate: 0,
        name: "Stamp Duty Abolition Act",
        description:
          "_Aisghairm na Dleachta Stampa_ — Abolish stamp duty entirely; remove transaction friction from property and securities markets",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 0.5,
        name: "Token Documentation Levy Act",
        description: "A near-zero rate preserving the legal instrument",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 1,
        name: "Single-Rate Stamp Duty Act",
        description: "Apply the 1% under-€1M rate uniformly, eliminating progressive thresholds",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 2,
        name: "Statutory Stamp Duty Act",
        description: "The current statutory averaged rate (1% under €1M, 2% above)",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 3,
        name: "Modest Stamp Duty Increase Act",
        description: "Above-statutory rate supporting transaction-based government revenue",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 5,
        name: "High-Value Property Surcharge Act",
        description:
          "Substantial stamp duty increase on high-value residential property transactions",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 7.5,
        name: "Investor-Cooling Stamp Act",
        description: "High stamp duty cooling institutional-investor speculation in housing",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 10,
        name: "Speculation Disincentive Act",
        description:
          "Very high stamp duty effectively pricing speculative trading out of the market",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 12,
        name: "Property Bubble Prevention Act",
        description:
          "Near-punitive stamp duty preventing property-bubble dynamics through frictional cost",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 15,
        name: "Anti-Speculation Maximum Act",
        description:
          "Near-historic stamp duty levels designed to lock down speculative property activity",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 20,
        name: "Maximum Transaction Cooling Act",
        description:
          "The highest stamp duty ever, designed to fully suppress speculative property and securities trading",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Capital Gains Tax ──────────────────────────────────────────────────────
  {
    _id: "ie_capital_gains_tax",
    countryScope: "ie",
    name: "Capital Gains Tax Act",
    description: "Sets the rate of capital gains tax on realised investment returns",
    explanation:
      "CGT is a flat 33% rate on realized capital gains in Ireland — one of the highest in Europe. Politically a perennial 'Should we cut CGT to attract risk capital?' debate, with Entrepreneur Relief (10% on first €1M of qualifying gains) as the current compromise.",
    policyDomain: "tax",
    subCategory: "Capital taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "fdiPipelineStrength", weight: 0.3 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "capitalGainsTax" },
    policyOptions: taxRateOptions("ie_capital_gains_tax", [
      {
        rate: 0,
        name: "Capital Gains Tax Abolition Act",
        description:
          "_Aisghairm na Cánach Gnóthachan Caipitiúil_ — Abolish CGT entirely; remove all friction on realised investment returns",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 5,
        name: "Token CGT Retention Act",
        description: "A near-zero CGT preserving the legal instrument",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 10,
        name: "Entrepreneur Relief Universal Act",
        description:
          "Extend the 10% Entrepreneur Relief rate to all gains regardless of qualifying conditions",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 15,
        name: "Capital Mobilisation Act",
        description: "Below-statutory CGT incentivising long-term investment and SME exits",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 20,
        name: "Modest CGT Reduction Act",
        description: "Below-statutory CGT supporting capital-market depth",
        stance: "right",
        economic: 1,
        social: 1,
      },
      {
        rate: 25,
        name: "Below-Statutory CGT Act",
        description: "Modest below-statutory CGT funding general government",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 33,
        name: "Statutory Capital Gains Tax Act",
        description: "The current 33% statutory rate, one of the highest CGT rates in Europe",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 40,
        name: "Wealth Recapture CGT Act",
        description: "Above-statutory CGT recapturing more investment-return concentrations",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 45,
        name: "Excess Gain Recapture Act",
        description: "High CGT funding social-investment programmes from realised capital gains",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 50,
        name: "Inequality Reduction CGT Act",
        description:
          "Near-historic CGT levels designed to substantially reduce post-tax inequality",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 55,
        name: "Maximum Capital Gains Tax Act",
        description:
          "The highest CGT ever, designed to extract maximum revenue from realised investment returns",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ── Excise Duty ────────────────────────────────────────────────────────────
  {
    _id: "ie_excise_duty",
    countryScope: "ie",
    name: "Excise Duty Act",
    description: "Sets excise multiplier for alcohol, tobacco, and fuel duties (100 = baseline)",
    explanation:
      "Excise duties on alcohol, tobacco, and fuel are politically central to Ireland (carbon-tax pathway, public-health framing). Real Irish excise revenue ≈ 1.5-2% of GDP. LARP'd as a multiplier dial where 100 = current excise revenue calibration.",
    policyDomain: "tax",
    subCategory: "Excise taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.5 },
      { metricCategoryId: "environment", metricId: "agriEmissionsShare", weight: 0.2 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.2 },
    ],
    positions: dailCommitteePositions("Finance"),
    taxRateChange: { scope: "federal", taxType: "exciseDuty" },
    policyOptions: taxRateOptions("ie_excise_duty", [
      {
        rate: 0,
        name: "Excise Duty Abolition Act",
        description:
          "_Aisghairm na Máil_ — Abolish excise duties entirely; alcohol, tobacco, fuel taxed only via VAT",
        stance: "right",
        economic: 5,
        social: 2,
      },
      {
        rate: 25,
        name: "Symbolic Excise Act",
        description: "Excise reduced to a token level, removing carbon-tax dial entirely",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 50,
        name: "Halved Excise Act",
        description: "Halve excise duties, dramatically cutting fuel and alcohol prices",
        stance: "right",
        economic: 3,
        social: 1,
      },
      {
        rate: 75,
        name: "Below-Baseline Excise Act",
        description: "Modest excise reduction easing cost-of-living pressure",
        stance: "right",
        economic: 2,
        social: 1,
      },
      {
        rate: 100,
        name: "Statutory Excise Act",
        description: "The current baseline excise level paired with scheduled carbon-tax increases",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 125,
        name: "Carbon Tax Accelerator Act",
        description:
          "Above-baseline excise funding accelerated carbon-tax pathway toward €100/tonne by 2030",
        stance: "left",
        economic: -1,
        social: -1,
      },
      {
        rate: 150,
        name: "Public Health Excise Act",
        description: "Higher excise on alcohol and tobacco funded by public-health rationale",
        stance: "left",
        economic: -2,
        social: -1,
      },
      {
        rate: 175,
        name: "Climate Action Excise Act",
        description:
          "Substantial excise increase explicitly funding Climate Action Plan implementation",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        rate: 200,
        name: "Doubled Excise Act",
        description: "Doubled excise duties using price signals to drive behaviour change",
        stance: "left",
        economic: -4,
        social: -1,
      },
      {
        rate: 250,
        name: "Behavioural Maximum Act",
        description:
          "Near-punitive excise levels designed to substantially curb alcohol/tobacco/fuel consumption",
        stance: "left",
        economic: -5,
        social: -2,
      },
      {
        rate: 300,
        name: "Maximum Pigouvian Excise Act",
        description:
          "The highest excise multiplier, designed to fully internalise health and climate externalities",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  EXISTING NON-TAX (4) — carry forward; later PRs rewrite to 7 options
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Housing Policy (rewrite — 7-option Vienna-model axis) ──────────────────
  {
    _id: "ie_housing_policy",
    countryScope: "ie",
    name: "Housing Development and Tenure Act",
    description: "Sets national housing development targets, planning policy, and tenure mix",
    explanation:
      "Ireland's housing crisis is the single most player-salient political issue. Housing for All target 33,000 new homes per year. Rebuilding Ireland → Housing for All policy sequence. Vienna-model public housing vs. market-led supply debate.",
    policyDomain: "housing",
    subCategory: "Housing supply",
    nationalOnly: false,
    effectTarget: { metricCategoryId: "social", metricId: "homelessnessRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "homelessnessRate", weight: 1.0 },
      { metricCategoryId: "social", metricId: "housingCompletionsRate", weight: 0.7 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 0.6 },
      { metricCategoryId: "social", metricId: "rentalPressureIndex", weight: 0.5 },
      { metricCategoryId: "social", metricId: "vacantPropertyRate", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Housing"),
    policyOptions: policyOptions(
      "ie_housing_policy",
      [
        {
          name: "Vienna-Model Public Housing Act",
          explanation:
            "_Acht Tithíochta Phoiblí Vienna_ — Mass public-housing build (50k/yr cost-rental); LDA absorbs all zoned land; rent controls universal.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Cost-Rental Expansion Act",
          explanation:
            "Scale cost-rental and social housing through LDA and local authorities; windfall taxes on vacant/zoned land.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Affordable Purchase + Cost-Rental Act",
          explanation:
            "Expand First Home shared-equity + cost-rental schemes alongside moderate planning reform.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Housing for All Act",
          explanation:
            "Maintain current Housing for All trajectory with selective acceleration of LDA cost-rental.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Planning Reform and Market Supply Act",
          explanation:
            "Deregulate planning; remove height restrictions; reduce LDA mandate; private-sector-led supply.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Market-Led Housing Act",
          explanation: "Repeal Rent Pressure Zones; abolish LDA cost-rental; market-only delivery.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Full Deregulation Act",
          explanation:
            "Repeal vacant-property tax; abolish RPZ; abolish Help-to-Buy; pure laissez-faire housing market.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR2 — HEALTH & EDUCATION (8 types: 1 rewrite + 7 new)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Health Services (rewrite from 3-option to 7-option Sláintecare axis) ────
  {
    _id: "ie_healthcare_policy",
    countryScope: "ie",
    name: "Health Services Bill",
    description: "Governs the structure and funding of the Irish public health system",
    explanation:
      "Sláintecare (2017) is the cross-party plan for a universal single-tier health system. Ireland still operates a mixed public/private system through the HSE. Politically the most contested health-policy axis: private-led ↔ universal single-tier.",
    policyDomain: "healthcare",
    subCategory: "Health system structure",
    nationalOnly: false,
    effectTarget: { metricCategoryId: "healthcare", metricId: "lifeExpectancy", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "lifeExpectancy", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.6 },
      { metricCategoryId: "healthcare", metricId: "slaintecareProgress", weight: 0.8 },
      { metricCategoryId: "healthcare", metricId: "hseWaitingListMonths", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ie_healthcare_policy",
      [
        {
          name: "NHS-Style Universal Act",
          explanation:
            "_Acht Sláinte Uilíoch_ — Tax-funded universal system; abolish private health insurance entirely; UK NHS-style framework with capitated GP rolls.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Universal Single-Tier Act",
          explanation:
            "Full Sláintecare: universal free GP care, eliminate waiting-list inequity, end private treatment within public hospitals.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Sláintecare Acceleration Act",
          explanation:
            "Front-load Sláintecare implementation; expand GP visit cards to all under-18s; statutory waiting-list targets.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Mixed System Act",
          explanation:
            "Maintain current HSE + regulated private insurance; incremental Sláintecare rollout at current pace.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Public-Private Partnership Act",
          explanation:
            "Expand co-located private treatment within HSE hospitals to reduce waits; allow private capacity in HSE diagnostics.",
          stance: "right",
          economic: 1,
          social: 1,
        },
        {
          name: "Private-Led Hybrid Act",
          explanation:
            "Expand private health insurance tax relief; let HSE focus on safety-net provision; permit for-profit hospital expansion.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Full Privatisation Act",
          explanation:
            "Eliminate the HSE; means-tested vouchers; private insurance dominates with state catastrophic coverage only.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Public Health and Disease Prevention (new) ──────────────────────────────
  {
    _id: "ie_public_health",
    countryScope: "ie",
    name: "Public Health and Disease Prevention Act",
    description: "Funds HSE Health Protection, vaccination outreach, and public-health levies",
    explanation:
      "Funding for HSE Health Protection Surveillance Centre (HPSC), infectious-disease response, immunisation, screening programmes, sugar-tax/alcohol-MUP. Post-COVID political salience high.",
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
      { metricCategoryId: "healthcare", metricId: "preventableMortality", weight: 0.5 },
      { metricCategoryId: "healthcare", metricId: "lifeExpectancy", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ie_public_health",
      [
        {
          name: "Comprehensive Public Health State Act",
          explanation:
            "Permanent pandemic-response staffing, mandatory annual screening, full HPSC autonomy from market pressure.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Public Health Expansion Act",
          explanation:
            "Accelerate HSE Health Protection budget; expand vaccination outreach to all undocumented residents; statutory MUP.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Sugar Tax Acceleration Act",
          explanation:
            "Expand Sugar-Sweetened Drinks Tax to wider HFSS food range; aggressive public-health levies.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Public Health Act",
          explanation:
            "Maintain current HPSC structure with incremental funding and screening expansion.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light-Touch Public Health Act",
          explanation:
            "Outsource public-health promotions to private/NGO sector; freeze MUP and sugar tax at current levels.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Industry-Led Health Promotion Act",
          explanation:
            "Repeal alcohol MUP; remove industry levies; rely on industry-led voluntary measures.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Minimal Public Health Act",
          explanation:
            "Eliminate non-clinical public-health functions; HPSC reduced to emergency-only mandate.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "both"
    ),
  },

  // ── Mental Health Services (new) ────────────────────────────────────────────
  {
    _id: "ie_mental_health",
    countryScope: "ie",
    name: "Mental Health Services Act",
    description: "Funds community-based mental health teams and CAMHS",
    explanation:
      "A Vision for Change (2006) and Sharing the Vision (2020) set the strategic framework for community-based mental health. CAMHS waiting lists are a chronic scandal.",
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
      { metricCategoryId: "healthcare", metricId: "lifeExpectancy", weight: 0.3 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ie_mental_health",
      [
        {
          name: "Universal Mental Health Act",
          explanation:
            "_Acht Meabhairshláinte Uilíoch_ — Free universal mental health treatment; abolish all private/public barriers; statutory access right.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Community Mental Health Expansion Act",
          explanation:
            "Substantial community-based mental health team expansion; CAMHS waiting-list elimination target within 3 years.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Counsellor-in-Primary-Care Act",
          explanation:
            "Statutory entitlement to counsellor visits within primary care; expand HSE direct provision.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Vision-for-Change Implementation Act",
          explanation:
            "Maintain current A Vision for Change / Sharing the Vision implementation pace.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Private Mental Health Pathway Act",
          explanation:
            "Expand private mental health insurance coverage; reduce HSE direct provision; rely on private sector growth.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Clinical-Only Mental Health Act",
          explanation:
            "Restrict mental health spending to clinical psychiatry; close community-based teams; family-responsibility framing.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Minimal Mental Health Act",
          explanation:
            "Eliminate state mental-health funding above acute-psychiatric care; entirely private provision otherwise.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Fair Deal / Elder Care (new) ────────────────────────────────────────────
  {
    _id: "ie_elder_care",
    countryScope: "ie",
    name: "Fair Deal Reform Act",
    description: "Sets the Nursing Homes Support Scheme and statutory home-care framework",
    explanation:
      "The Nursing Homes Support Scheme ('Fair Deal', 2009) is the means-tested model for long-term residential care. Politically controversial: 80% of pension + 7.5% of assets including family home, capped at 22.5% over 3 years. Statutory home care under development.",
    policyDomain: "healthcare",
    subCategory: "Long-term care",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "elderCareQuality",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "elderCareQuality", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "lifeExpectancy", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ie_elder_care",
      [
        {
          name: "Universal Elder Care Act",
          explanation:
            "_Acht Cúraim Aosaigh Uilíoch_ — Free universal long-term care (residential + home-based); abolish Fair Deal asset assessment entirely.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "Statutory Home Care Entitlement Act",
          explanation:
            "Right to home care for over-70s; expand HSE direct home-care provision; ring-fence funding.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Fair Deal Family Home Exclusion Act",
          explanation:
            "Exclude principal private residence from Fair Deal asset calculation entirely.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Fair Deal Act",
          explanation:
            "Maintain current Nursing Homes Support Scheme structure with 3-year asset cap.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Means-Tested Fair Deal Act",
          explanation:
            "Tighten Fair Deal means-testing; lengthen asset assessment window; encourage private long-term care insurance.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Private Long-Term Care Insurance Act",
          explanation:
            "Tax relief on private long-term care insurance; encourage insurance pre-funding; reduce state direct funding.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Family Responsibility Act",
          explanation:
            "Phase out Fair Deal scheme; elder care responsibility devolves to families with means-tested last-resort vouchers.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Primary and Post-Primary Education Funding (new) ────────────────────────
  {
    _id: "ie_education_funding",
    countryScope: "ie",
    name: "Primary and Post-Primary Education Funding Act",
    description: "Sets per-pupil capitation, DEIS funding, and school-meals/transport programmes",
    explanation:
      "Per-pupil capitation grants, DEIS programme (Delivering Equality of Opportunity in Schools), teacher-pupil ratios, school transport (Bus Scoile), school meals, special education needs (SEN) supports.",
    policyDomain: "education",
    subCategory: "Schools funding",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    // §4.7 (P2a): literacyRate/testPerformance secondaries dropped — this
    // funding law's education spend now drives them via the engine's channel.
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "educationSpending", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ie_education_funding",
      [
        {
          name: "Universal Free Education Act",
          explanation:
            "_Acht Oideachais Saor Uilíoch_ — Full school-meals programme; free books/uniforms; lowest pupil-teacher ratios in EU.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "DEIS Expansion Act",
          explanation:
            "Expand DEIS to all disadvantaged schools; reduce teacher-pupil ratios across the board; fund SEN organisers fully.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "School Transport Universal Act",
          explanation: "Free Bus Scoile for all pupils; universal Hot School Meals expansion.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Education Funding Act",
          explanation:
            "Maintain current per-pupil capitation, DEIS levels, and selective Hot School Meals expansion.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Subsidy Reform Act",
          explanation:
            "Replace blanket capitation with means-tested support; encourage Educate Together / private-school growth via vouchers.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Charter School Expansion Act",
          explanation:
            "Liberalise private/charter school regulation; expand voucher pathways; reduce state share of school funding.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Education Privatisation Act",
          explanation:
            "Phase out state subsidies above constitutional minimum; route school funding via parental vouchers in a market system.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Higher Education and SUSI Reform (new) ──────────────────────────────────
  {
    _id: "ie_higher_education",
    countryScope: "ie",
    name: "Higher Education and SUSI Reform Act",
    description: "Sets the registration-fee + SUSI maintenance-grant framework for third-level",
    explanation:
      "Free Fees scheme covers tuition for EU undergraduates; €3,000/yr student contribution remains. SUSI (Student Universal Support Ireland) provides means-tested maintenance grants. Long-running debate on income-contingent loans (UK-style).",
    policyDomain: "education",
    subCategory: "Higher education",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "universityEnrollment",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "universityEnrollment", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "social", metricId: "incomeInequality", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Higher Education"),
    policyOptions: policyOptions(
      "ie_higher_education",
      [
        {
          name: "Free Higher Education Act",
          explanation:
            "_Acht Ardoideachais Saor in Aisce_ — Abolish registration fee entirely; universal free third-level; expand SUSI to all.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "SUSI Universalisation Act",
          explanation:
            "Raise SUSI grant thresholds substantially; introduce postgraduate SUSI; reduce registration fee to €1,000.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Registration Fee Reduction Act",
          explanation:
            "Phased reduction of registration fee from €3,000 to €2,000; expand SUSI middle-income bands.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Free Fees Scheme Act",
          explanation:
            "Maintain current €3,000 student contribution + Free Fees scheme for EU undergraduates.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Income-Contingent Loan Act",
          explanation:
            "Replace registration fee with UK-style income-contingent loan system repayable above earnings threshold.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Partial Tuition Reintroduction Act",
          explanation:
            "Reintroduce undergraduate tuition at €3,000-5,000 with means-tested grants.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Full Tuition Fees Act",
          explanation:
            "End Free Fees scheme; introduce €8,000+ tuition with privately-arranged loans.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Research and Science Funding (new) ──────────────────────────────────────
  {
    _id: "ie_research_science",
    countryScope: "ie",
    name: "Research and Science Funding Act",
    description: "Funds SFI, IRC, and disruptive-technologies research programmes",
    explanation:
      "Science Foundation Ireland (SFI), Irish Research Council (IRC), Higher Education Authority (HEA), Disruptive Technologies Innovation Fund. R&D intensity ≈ 1.1% GDP (below EU 3% target).",
    policyDomain: "economic",
    subCategory: "Research & development",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "rdIntensity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "rdIntensity", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "fdiPipelineStrength", weight: 0.4 },
      // §4.7 (P2d): productivityGrowth secondary dropped — the primary root
      // feeds the engine TFP basket (root pass-through).
      { metricCategoryId: "economic", metricId: "manufacturingCompetitiveness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Higher Education"),
    policyOptions: policyOptions(
      "ie_research_science",
      [
        {
          name: "3% R&D Target Act",
          explanation:
            "_Acht Sprice 3% R&D_ — Hit EU 3% of GDP R&D target via substantial public investment; new institutes and chairs.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Research Investment Act",
          explanation:
            "Double SFI funding; expand IRC postgraduate grants; new disruptive-technologies centres.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Basic Research Restoration Act",
          explanation:
            "Rebalance SFI funding toward basic-research grants; reduce mission-led prioritisation.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory SFI Funding Act",
          explanation: "Maintain current SFI/IRC funding levels and frameworks.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Reduced SFI Funding Act",
          explanation:
            "Below-statutory SFI funding; market-driven research prioritisation; trim non-strategic IRC programmes.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Private R&D Tax Credit Act",
          explanation:
            "Eliminate basic-research grants; rely on R&D tax credits for private-sector research investment.",
          stance: "right",
          economic: 3,
          social: 1,
        },
        {
          name: "Minimal Research Funding Act",
          explanation:
            "Wind down SFI and IRC; route all research funding through R&D tax credits and FDI-led private investment.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "economic"
    ),
  },

  // ── Leaving Certificate Reform (new) ────────────────────────────────────────
  {
    _id: "ie_curriculum_reform",
    countryScope: "ie",
    name: "Leaving Certificate Reform Act",
    description:
      "Sets the Senior Cycle assessment framework and exam-based vs continuous-assessment balance",
    explanation:
      "Senior Cycle Redevelopment underway; Leaving Cert points system, oral Irish requirement, continuous-assessment expansion. Long-standing teacher-union opposition to continuous assessment. A 'tradition vs. modernisation' axis.",
    policyDomain: "education",
    subCategory: "Curriculum",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "education", metricId: "testPerformance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "testPerformance", weight: 0.6 },
      { metricCategoryId: "education", metricId: "academicPressure", weight: 0.7 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "social", metricId: "irishLanguageStrength", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ie_curriculum_reform",
      [
        {
          name: "Comprehensive Curriculum Act",
          explanation:
            "_Acht Curaclaim Cuimsitheach_ — Abolish Leaving Cert points system entirely; comprehensive Nordic-style holistic assessment.",
          stance: "left",
          economic: -2,
          social: -4,
        },
        {
          name: "Continuous Assessment Act",
          explanation:
            "Substantial continuous-assessment component (40%+) across all subjects; reduce single-exam pressure.",
          stance: "left",
          economic: -1,
          social: -3,
        },
        {
          name: "Multi-Pathway Senior Cycle Act",
          explanation:
            "Expand vocational/applied/transition-year pathways; reduce exam dependence for non-academic tracks.",
          stance: "left",
          economic: 0,
          social: -2,
        },
        {
          name: "Senior Cycle Redevelopment Act",
          explanation:
            "Continue current incremental Senior Cycle redevelopment with modest assessment-component additions.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Selective Reform Act",
          explanation:
            "Minor Leaving Cert tweaks; preserve points system and external assessment as the primary mechanism.",
          stance: "right",
          economic: 0,
          social: 1,
        },
        {
          name: "Traditional Curriculum Act",
          explanation:
            "Maintain exam-based Leaving Cert; reject continuous-assessment reform entirely.",
          stance: "right",
          economic: 0,
          social: 3,
        },
        {
          name: "Classical Curriculum Restoration Act",
          explanation:
            "Restore Latin/Greek/classical-canon requirements; mandatory oral Irish at honours level; entirely exam-based assessment.",
          stance: "right",
          economic: 0,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR3 — WELFARE, FAMILY, SOCIAL (7 new types)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Contributory State Pension (new) ────────────────────────────────────────
  {
    _id: "ie_state_pensions",
    countryScope: "ie",
    name: "Contributory State Pension Act",
    description:
      "Sets age qualification, indexation, and Total Contributions Approach for State Pension",
    explanation:
      "The Contributory State Pension is funded from the Social Insurance Fund (via PRSI). Age qualification raised to 66 (2014); originally scheduled to rise to 68 — reversed after political backlash. Total Contributions Approach (TCA) is the calculation method.",
    policyDomain: "welfare",
    subCategory: "Pensions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.6 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      // Pension-age lever → older-worker laborParticipation → labor force L (§5.1).
      // Negative weight: expanding the pension / lower qualifying age (left) cuts
      // participation; raising it (right) lifts it. Replaces the removed medianAge
      // readout (§4.7 sweep → §4.6 driver).
      { metricCategoryId: "economic", metricId: "laborParticipation", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Social Protection"),
    policyOptions: policyOptions(
      "ie_state_pensions",
      [
        {
          name: "Universal Basic Pension Act",
          explanation:
            "_Acht Phinsin Bunúsach Uilíoch_ — Universal flat-rate pension from age 65 regardless of contribution history; abolish means-testing.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "Pension Age Reduction Act",
          explanation:
            "Reduce pension age to 65; index pension to wages (currently CPI); statutory benchmark indexation.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Wage Indexation Act",
          explanation:
            "Index State Pension to average earnings (wage-based) rather than inflation.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory State Pension Act",
          explanation:
            "Maintain age 66, Total Contributions Approach, current rate increases per Budget cycle.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Pension Age 67 Act",
          explanation:
            "Raise pension age to 67 in phased steps with PRSI credits for caring responsibilities.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Funded Pillar Expansion Act",
          explanation:
            "Expand AE auto-enrolment to mandatory funded pillar; reduce reliance on Social Insurance Fund.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Privatisation of State Pension Act",
          explanation:
            "Phase out Contributory State Pension; replace with mandatory private pension accounts.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "economic"
    ),
  },

  // ── Jobseeker's Allowance Reform (new) ──────────────────────────────────────
  {
    _id: "ie_unemployment_benefits",
    countryScope: "ie",
    name: "Jobseeker's Allowance Reform Act",
    description: "Sets JSA/JSB rates, eligibility, and Intreo activation requirements",
    explanation:
      "Jobseeker's Benefit (JSB) is PRSI-based, Jobseeker's Allowance (JSA) is means-tested. Activation requirements via Intreo. Recurring 'welfare-trap' debate.",
    policyDomain: "welfare",
    subCategory: "Unemployment",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.6 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.7 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Social Protection"),
    policyOptions: policyOptions(
      "ie_unemployment_benefits",
      [
        {
          name: "Universal Basic Income Act",
          explanation:
            "_Acht Bunioncaim Uilíoch_ — Universal Basic Income trial replacing JSA/JSB; means-test-free unconditional payments.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Pay-Related Jobseeker's Act",
          explanation:
            "Pay-related Jobseeker's Benefit indexed to prior earnings (Continental European model).",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "JSA Rate Increase Act",
          explanation:
            "Raise JSA rates substantially above CPI; benchmark to 30% of median earnings; expand SUSI for adult learners.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Jobseeker's Allowance Act",
          explanation: "Maintain current JSA/JSB structure with Budget-cycle adjustments.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Activation Tightening Act",
          explanation:
            "Tighten Intreo activation requirements; conditionality enforcement; sanctions for non-participation.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Workfare Act",
          explanation:
            "Workfare requirements (Tús/CE schemes mandatory after 6 months); reduce JSA for under-25s.",
          stance: "right",
          economic: 3,
          social: 3,
        },
        {
          name: "Minimal Welfare Act",
          explanation:
            "Time-limit Jobseeker's payments to 12 months; private safety-net charity to fill gap.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Working Family Payment (new) ────────────────────────────────────────────
  {
    _id: "ie_working_family_payment",
    countryScope: "ie",
    name: "Working Family Payment Act",
    description: "Sets means-tested in-work family benefit thresholds and per-child supplements",
    explanation:
      "WFP is means-tested in-work benefit for low-income working families with children (formerly FIS). Reduces in-work poverty and the welfare trap. Recurring debate on income thresholds and per-child supplements.",
    policyDomain: "welfare",
    subCategory: "Family supports",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "povertyRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.2 },
      // Family income support modestly lifts fertility → birthRate driver (§4.6).
      { metricCategoryId: "population", metricId: "birthRate", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Social Protection"),
    policyOptions: policyOptions(
      "ie_working_family_payment",
      [
        {
          name: "Universal Family Payment Act",
          explanation:
            "_Acht Íocaíochta Teaghlaigh Uilíoch_ — Universal in-work family payment, no means test; per-child supplements double.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "WFP Expansion Act",
          explanation:
            "Raise WFP income thresholds substantially; expand per-child supplements; auto-enrol via Revenue.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Targeted Family Supports Act",
          explanation: "Raise WFP rates above CPI; expand AIM for families with disabled children.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Working Family Payment Act",
          explanation: "Maintain current WFP thresholds and per-child supplement structure.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Means-Tested Restriction Act",
          explanation:
            "Tighten WFP income thresholds; reduce per-child supplements above 4 children.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Conditional Family Support Act",
          explanation:
            "Replace WFP with conditional support tied to school-attendance and immunisation compliance.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Minimal Family Support Act",
          explanation: "Phase out WFP; rely on tax credits for working families instead.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "both"
    ),
  },

  // ── Parent's Leave and Benefit (new) ────────────────────────────────────────
  {
    _id: "ie_parental_leave",
    countryScope: "ie",
    name: "Parent's Leave and Benefit Act",
    description: "Sets duration and rate of paid parent's leave",
    explanation:
      "Parent's Leave (introduced 2019, now 9 weeks per parent) is in addition to maternity/paternity leave. Paid via Social Insurance Fund. Recurring debate on extending duration and increasing per-week payment.",
    policyDomain: "welfare",
    subCategory: "Family leave",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "genderEquality", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "genderEquality", weight: 1.0 },
      { metricCategoryId: "population", metricId: "birthRate", weight: 0.4 },
      { metricCategoryId: "social", metricId: "workLifeBalance", weight: 0.4 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Children, Equality, Disability, Integration and Youth"),
    policyOptions: policyOptions(
      "ie_parental_leave",
      [
        {
          name: "Year-Long Parental Leave Act",
          explanation:
            "52 weeks combined paid leave per parent; full-pay (not flat benefit rate); statutory job protection.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Nordic Parental Leave Act",
          explanation:
            "Extend Parent's Leave to 26 weeks per parent at 80% of earnings; use-it-or-lose-it allocations.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Parent's Leave Expansion Act",
          explanation:
            "Extend Parent's Leave to 14 weeks per parent; increase weekly rate to match maternity benefit.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Statutory Parent's Leave Act",
          explanation: "Maintain current 9 weeks per parent at €274/wk flat rate.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Employer-Funded Parental Leave Act",
          explanation:
            "Shift Parent's Leave funding from Social Insurance Fund to mandatory employer top-up.",
          stance: "right",
          economic: 1,
          social: 1,
        },
        {
          name: "Reduced Parental Leave Act",
          explanation:
            "Reduce Parent's Leave to 6 weeks; longer leave only for families using public childcare.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Minimal Statutory Leave Act",
          explanation: "Repeal Parent's Leave entirely; maternity leave only (EU minimum).",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── National Childcare Scheme (new) ─────────────────────────────────────────
  {
    _id: "ie_childcare_policy",
    countryScope: "ie",
    name: "National Childcare Scheme Act",
    description: "Sets NCS means-tested subsidies and AIM disability supports",
    explanation:
      "NCS (2019) is the means-tested childcare subsidy with universal sponsorship up to 3 years. AIM (Access and Inclusion Model) supports children with disabilities. Childcare costs in Ireland are among the highest in Europe.",
    policyDomain: "welfare",
    subCategory: "Childcare",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "childPoverty", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "childPoverty", weight: 1.0 },
      { metricCategoryId: "population", metricId: "birthRate", weight: 0.4 },
      { metricCategoryId: "social", metricId: "genderEquality", weight: 0.5 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Children, Equality, Disability, Integration and Youth"),
    policyOptions: policyOptions(
      "ie_childcare_policy",
      [
        {
          name: "Universal Free Childcare Act",
          explanation:
            "_Acht Cúraim Leanaí Saor Uilíoch_ — Free universal childcare from age 6 months; abolish all NCS means-testing.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Nordic Childcare Model Act",
          explanation:
            "NCS expanded to cover 80%+ of fees universally; statutory €5/hour parent cap.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "NCS Expansion Act",
          explanation:
            "Raise NCS subsidy ceilings; expand sponsor categories; increase AIM funding.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory NCS Act",
          explanation: "Maintain current NCS subsidy levels and universal sponsorship up to age 3.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Childcare Subsidy Act",
          explanation:
            "Tighten NCS means-testing; reduce universal sponsorship; rely on parental income tax relief.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Private Childcare Market Act",
          explanation:
            "Phase out NCS in favour of market-priced childcare with limited means-tested vouchers.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Family-Care-At-Home Act",
          explanation:
            "Repeal NCS; replace with home-care allowance encouraging stay-at-home parenting.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Gender Pay Gap and Equality Reform (new) ────────────────────────────────
  {
    _id: "ie_gender_equality",
    countryScope: "ie",
    name: "Gender Pay Gap and Equality Reform Act",
    description: "Sets pay-gap reporting thresholds and gender quotas",
    explanation:
      "Gender Pay Gap Information Act (2021) mandates reporting for employers >250. Gender quotas (40% female board membership for state boards, 30% for political parties). Ongoing debate on enforcement.",
    policyDomain: "social",
    subCategory: "Equality",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "genderEquality", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "genderEquality", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "social", metricId: "civicParticipation", weight: 0.3 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Children, Equality, Disability, Integration and Youth"),
    policyOptions: policyOptions(
      "ie_gender_equality",
      [
        {
          name: "Comprehensive Equality Act",
          explanation:
            "_Acht Cothromaíochta Cuimsitheach_ — Mandatory 50% gender quotas across all sectors; comprehensive pay-equity audit and enforcement.",
          stance: "left",
          economic: -3,
          social: -5,
        },
        {
          name: "Pay Gap Enforcement Act",
          explanation:
            "Lower pay-gap reporting threshold to 50 employees; enforcement fines; mandatory remedial plans.",
          stance: "left",
          economic: -2,
          social: -3,
        },
        {
          name: "Quota Expansion Act",
          explanation:
            "Extend gender quotas to private boards; 40% quotas for political party candidates.",
          stance: "left",
          economic: -1,
          social: -2,
        },
        {
          name: "Statutory Pay Gap Reporting Act",
          explanation: "Maintain current >250 employee threshold; voluntary remedial action.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light-Touch Reporting Act",
          explanation: "Raise pay-gap threshold to >500 employees; voluntary-only enforcement.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "Pay Gap Reporting Repeal Act",
          explanation:
            "Repeal mandatory pay-gap reporting; rely on free-market signalling and existing equality legislation.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "Traditional Family Values Act",
          explanation:
            "Repeal gender-equality quotas entirely; remove state mandates on gender-balance in public bodies.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ── Drug Policy Reform (new) ────────────────────────────────────────────────
  {
    _id: "ie_drug_policy",
    countryScope: "ie",
    name: "Misuse of Drugs Reform Act",
    description:
      "Sets the framework for personal-use possession, supply offences, and harm reduction",
    explanation:
      "Citizen's Assembly on Drugs (2023) recommended health-led approach. Currently possession remains criminal but Garda diversion options exist. Long debate on decriminalisation vs. legalisation.",
    policyDomain: "criminal_justice",
    subCategory: "Drug policy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "recidivismRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "recidivismRate", weight: 0.7 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: 0.5 },
      { metricCategoryId: "healthcare", metricId: "mentalHealthAccess", weight: 0.4 },
      { metricCategoryId: "publicSafety", metricId: "incarcerationRate", weight: 0.6 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.2 },
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Justice"),
    policyOptions: policyOptions(
      "ie_drug_policy",
      [
        {
          name: "Full Drug Legalisation Act",
          explanation:
            "_Acht Dlíthithe Drugaí_ — Legalise possession + regulated retail sale of all controlled substances; tax + regulate as alcohol.",
          stance: "left",
          economic: -2,
          social: -5,
        },
        {
          name: "Cannabis Legalisation Act",
          explanation:
            "Legalise cannabis possession and regulated retail; decriminalise all other personal-use possession.",
          stance: "left",
          economic: -1,
          social: -4,
        },
        {
          name: "Decriminalisation Act",
          explanation:
            "Implement Citizen's Assembly recommendation: decriminalise personal-use possession; health-led referral pathway.",
          stance: "left",
          economic: 0,
          social: -3,
        },
        {
          name: "Statutory Drugs Policy Act",
          explanation:
            "Maintain current Misuse of Drugs Act with expanded Garda Adult Caution Scheme for personal-use possession.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Enforcement Reinforcement Act",
          explanation:
            "Tighten possession sentencing; expand Garda Drugs Unit; mandatory minimum sentences for supply offences.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "War on Drugs Act",
          explanation:
            "Aggressive criminalisation; mandatory custodial sentences for possession; remove Adult Caution Scheme.",
          stance: "right",
          economic: 2,
          social: 4,
        },
        {
          name: "Maximum Prohibition Act",
          explanation:
            "Capital-offence-level sanctions for supply; mandatory custodial sentences for all drug offences including cannabis personal use.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR4 — ECONOMY, LABOUR, INFRASTRUCTURE (7 new types; housing+minwage rewrites)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── National Minimum Wage (rewrite — 7-option Living Wage axis) ─────────────
  {
    _id: "ie_minimum_wage",
    countryScope: "ie",
    name: "National Minimum Wage Act",
    description: "Sets the national minimum hourly wage rate",
    explanation:
      "Set by government on Low Pay Commission recommendations with a stated target of two-thirds median wage. Living wage estimates (~€14.80/hr) campaigned by SIPTU/ICTU.",
    policyDomain: "labour",
    subCategory: "Wages",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.2 },
    ],
    positions: dailCommitteePositions("Employment Affairs"),
    policyOptions: policyOptions(
      "ie_minimum_wage",
      [
        {
          name: "Living Wage Plus Act",
          explanation:
            "_Acht Pá Maireachtála Móide_ — €20/hr minimum, well above ICTU Living Wage estimates.",
          stance: "left",
          economic: -5,
          social: -3,
          minimumWageRate: 20,
        },
        {
          name: "Living Wage Act",
          explanation: "€17/hr minimum, matching ICTU Living Wage Technical Group estimate.",
          stance: "left",
          economic: -3,
          social: -2,
          minimumWageRate: 17,
        },
        {
          name: "Two-Thirds Median Target Act",
          explanation:
            "€15/hr minimum, hitting the two-thirds-of-median benchmark ahead of schedule.",
          stance: "left",
          economic: -2,
          social: -1,
          minimumWageRate: 15,
        },
        {
          name: "Statutory Minimum Wage Act",
          explanation:
            "Maintain the headline statutory rate per Low Pay Commission recommendation.",
          stance: "center",
          economic: 0,
          social: 0,
          minimumWageRate: 13.5,
        },
        {
          name: "Sub-Sector Differential Act",
          explanation:
            "Lower minimum wage for under-25 and hospitality/retail; permit sub-minimum training rates.",
          stance: "right",
          economic: 2,
          social: 1,
          minimumWageRate: 11,
        },
        {
          name: "Light-Touch Minimum Wage Act",
          explanation: "Reduce minimum wage to ease SME labour cost pressure.",
          stance: "right",
          economic: 3,
          social: 2,
          minimumWageRate: 9,
        },
        {
          name: "Minimum Wage Abolition Act",
          explanation:
            "Repeal national minimum wage; rely on collective bargaining and market wage-setting.",
          stance: "right",
          economic: 5,
          social: 3,
          minimumWageRate: 0,
        },
      ],
      "both"
    ),
  },

  // ── Workplace Relations Reform (new) ────────────────────────────────────────
  {
    _id: "ie_workers_rights",
    countryScope: "ie",
    name: "Workplace Relations Reform Act",
    description:
      "Sets workers' rights framework — sick pay, right to disconnect, collective bargaining",
    explanation:
      "Right to Request Remote Working (2023), statutory sick pay phased in 2023-2026, collective-bargaining recognition reform, right-to-disconnect code. WRC and Labour Court are the dispute-resolution channels.",
    policyDomain: "labour",
    subCategory: "Workers' rights",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "workLifeBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "workLifeBalance", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "productivityGrowth", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Enterprise, Trade and Employment"),
    policyOptions: policyOptions(
      "ie_workers_rights",
      [
        {
          name: "Comprehensive Workers Rights Act",
          explanation:
            "_Acht Cuimsitheach Cearta Oibrithe_ — Statutory collective-bargaining recognition; sectoral employment orders mandatory; 32hr week.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Living Sick Pay and Disconnect Act",
          explanation:
            "Statutory sick pay extended to 14 days at 100% earnings; binding right-to-disconnect with WRC enforcement.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Collective Bargaining Expansion Act",
          explanation:
            "Statutory union recognition; mandatory works councils for employers >50 employees.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Statutory Workplace Relations Act",
          explanation:
            "Maintain current statutory sick pay phasing and voluntary collective bargaining.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Employer Flexibility Act",
          explanation:
            "Roll back statutory sick pay to 3 days; voluntary right-to-disconnect; reduced WRC enforcement.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "At-Will Employment Act",
          explanation:
            "Introduce at-will employment for small employers (<50); reduce unfair-dismissal protections.",
          stance: "right",
          economic: 3,
          social: 3,
        },
        {
          name: "Maximum Labour Market Flexibility Act",
          explanation: "At-will employment universal; abolish WRC; repeal statutory sick pay.",
          stance: "right",
          economic: 5,
          social: 4,
        },
      ],
      "both"
    ),
  },

  // ── Apprenticeship and Workforce Development (new) ──────────────────────────
  {
    _id: "ie_workforce_development",
    countryScope: "ie",
    name: "Apprenticeship and Workforce Development Act",
    description: "Funds apprenticeships, SOLAS programmes, and lifelong learning",
    explanation:
      "Action Plan for Apprenticeship 2021-2025, SOLAS, ETBs, Skillnet Ireland. Apprenticeship registrations growing rapidly but from a low base; pre-apprenticeship pathways uneven across regions.",
    policyDomain: "education",
    subCategory: "Workforce development",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "apprenticeshipRate",
      scope: "national",
    },
    // §4.7 (P2a): workforceSkill secondary dropped — apprenticeshipRate (the
    // primary) is now an ENGINE input to workforceSkill (root pass-through).
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "apprenticeshipRate", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      // §4.7 (P2d): productivityGrowth secondary dropped — the primary root
      // feeds the engine TFP basket (root pass-through).
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    positions: dailCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ie_workforce_development",
      [
        {
          name: "Universal Lifelong Learning Act",
          explanation:
            "_Acht Foghlama ar Feadh an tSaoil Uilíoch_ — Statutory €5k personal learning account for every adult; lifelong learning entitlement.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Apprenticeship Universalisation Act",
          explanation:
            "Triple apprenticeship registrations; mandatory employer levy ring-fenced for SOLAS.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "FET Strategy Expansion Act",
          explanation:
            "Substantially expand ETB / SOLAS funding; free FET tuition extended to all adults.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Apprenticeship Plan Act",
          explanation:
            "Maintain current Action Plan for Apprenticeship trajectory and SOLAS funding.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Employer-Led Training Act",
          explanation:
            "Shift SOLAS funding to employer-led tax credit mechanism; reduce direct state funding.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market-Based Skills Act",
          explanation:
            "Phase out SOLAS apprenticeship funding; rely on market wage signals to drive skills allocation.",
          stance: "right",
          economic: 3,
          social: 1,
        },
        {
          name: "Minimal Workforce Programme Act",
          explanation:
            "Wind down SOLAS apprenticeship support; ETB further-education programmes privatised.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "economic"
    ),
  },

  // ── Enterprise Ireland SME Strategy (new) ───────────────────────────────────
  {
    _id: "ie_sme_support",
    countryScope: "ie",
    name: "Enterprise Ireland SME Strategy Act",
    description: "Funds Enterprise Ireland, IDA, and Local Enterprise Office programmes",
    explanation:
      "Enterprise Ireland (indigenous), IDA Ireland (FDI), Local Enterprise Offices. R&D tax credit (25%), Employment Investment Incentive Scheme (EIIS), Knowledge Development Box.",
    policyDomain: "economic",
    subCategory: "SME & enterprise",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "mncDependency", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Enterprise, Trade and Employment"),
    policyOptions: policyOptions(
      "ie_sme_support",
      [
        {
          name: "National Industrial Strategy Act",
          explanation:
            "_Acht Straitéise Tionsclaíoch Náisiúnta_ — Active state ownership in strategic sectors; National Investment Bank; pickle-the-winners.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "Indigenous Enterprise Champion Act",
          explanation:
            "Triple Enterprise Ireland funding; scale-up commitment for indigenous firms; equity instead of grants.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "EIIS / SCI Expansion Act",
          explanation:
            "Expand EIIS and Seed Capital Investment relief; raise R&D tax credit; new venture-debt programme.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory SME Support Act",
          explanation:
            "Maintain current Enterprise Ireland / LEO / IDA structure and funding levels.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Means-Tested Grant Reform Act",
          explanation:
            "Tighten Enterprise Ireland grant eligibility; replace grants with tax credit equivalents.",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          name: "Market-Led Enterprise Act",
          explanation:
            "Phase out grants; rely on R&D tax credit and EIIS only; reduce state direct investment.",
          stance: "right",
          economic: 3,
          social: 1,
        },
        {
          name: "Laissez-Faire Enterprise Act",
          explanation:
            "Wind down Enterprise Ireland; abolish grants entirely; market-only enterprise support.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "economic"
    ),
  },

  // ── National Development Plan Fiscal Stance (new) ───────────────────────────
  {
    _id: "ie_fiscal_stimulus",
    countryScope: "ie",
    name: "National Development Plan Fiscal Stance Act",
    description: "Sets capital-spending envelope and EU Stability Pact navigation",
    explanation:
      "The NDP 2021-30 envelope is €165bn. Stability and Growth Pact 3% deficit cap nominally binding (waived 2020-23 for COVID); 60% debt/GDP ceiling exceeded in practice. Recurring debate on counter-cyclical vs. structural fiscal stance.",
    policyDomain: "economic",
    subCategory: "Fiscal policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.7 },
      { metricCategoryId: "governance", metricId: "debtToGdp", weight: -0.5 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Finance"),
    policyOptions: policyOptions(
      "ie_fiscal_stimulus",
      [
        {
          name: "Counter-Cyclical Stimulus Act",
          explanation:
            "_Acht Spreagtha Frithchúrsach_ — Aggressive counter-cyclical capital spending; full deficit-spending in downturns.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "NDP Acceleration Act",
          explanation:
            "Substantially front-load NDP 2021-30 spending; bond-financed capital expansion.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Sectoral Investment Drive Act",
          explanation:
            "Above-NDP-envelope spending on housing/health/transport; navigate Stability Pact via investment carve-outs.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory NDP Stance Act",
          explanation: "Maintain current NDP envelope trajectory and Budget cycle discipline.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Counter-Cyclical Saving Act",
          explanation:
            "Run primary surpluses; build Future Ireland Fund balance; restrict capital spending growth.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Stability Pact Maximalism Act",
          explanation:
            "Substantial structural surplus target; debt/GDP reduction priority; freeze capital programmes.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Maximum Austerity Act",
          explanation: "Front-loaded austerity; full debt-reduction discipline; freeze NDP.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "economic"
    ),
  },

  // ── National Transport Strategy (new) ───────────────────────────────────────
  {
    _id: "ie_transport_rail",
    countryScope: "ie",
    name: "National Transport Strategy Act",
    description: "Sets BusConnects, MetroLink, and rail investment trajectory",
    explanation:
      "NTA Greater Dublin Area Transport Strategy, BusConnects, MetroLink (Dublin Metro), Iarnród Éireann electrification (DART+), intercity rail. Politically a regional-balance issue.",
    policyDomain: "infrastructure",
    subCategory: "Transport",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "publicTransit",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "publicTransit", weight: 1.0 },
      { metricCategoryId: "infrastructure", metricId: "transportEfficiency", weight: 0.5 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.4 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Transport"),
    policyOptions: policyOptions(
      "ie_transport_rail",
      [
        {
          name: "National Rail Revival Act",
          explanation:
            "_Acht Athbheochan na nIarnród Náisiúnta_ — Full nationalisation of public transport; reopen all closed lines; Western Rail Corridor.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "MetroLink Acceleration Act",
          explanation:
            "Front-load MetroLink; full DART+ rollout by 2030; double Iarnród Éireann capital expenditure.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "BusConnects Expansion Act",
          explanation:
            "Accelerate BusConnects across all cities; expand free-transport entitlements; rural transport doubling.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Transport Strategy Act",
          explanation: "Maintain current NTA / NDP transport envelope trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Cost-Constrained Transport Act",
          explanation:
            "Slow MetroLink delivery; rebalance toward roads investment; reduce public-transport subsidies.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Road-First Transport Act",
          explanation:
            "Pause MetroLink; prioritise motorway/national-roads investment; private-toll road expansion.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Private Toll Roads Act",
          explanation: "Privatise Iarnród Éireann and Dublin Bus; full toll-road transport model.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── National Broadband Plan (new) ───────────────────────────────────────────
  {
    _id: "ie_digital_infrastructure",
    countryScope: "ie",
    name: "National Broadband Plan Act",
    description: "Sets NBP rollout trajectory and gigabit-society targets",
    explanation:
      "NBP rollout (€2.7bn) is connecting 560,000 rural premises with fibre. Gigabit-society target by 2028. Politically charged around urban-rural equity, mobile blackspots, and the NBI contract.",
    policyDomain: "infrastructure",
    subCategory: "Digital",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "broadbandAccess", weight: 1.0 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.4 },
      // §4.7 (P2d): productivityGrowth secondary dropped — the primary root
      // feeds the engine TFP basket (root pass-through).
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Environment, Climate and Communications"),
    policyOptions: policyOptions(
      "ie_digital_infrastructure",
      [
        {
          name: "National Public Broadband Act",
          explanation:
            "_Acht Leathanbhanda Phoiblí Náisiúnta_ — State-owned broadband network; nationalise NBI; gigabit-to-every-premises by 2027.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "NBP Acceleration Act",
          explanation:
            "Front-load NBP rollout to complete by 2026; substantially expand mobile coverage subsidies.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Gigabit Society Acceleration Act",
          explanation:
            "Front-load gigabit-target spend; expand connectivity vouchers for low-income households.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Broadband Plan Act",
          explanation: "Maintain current NBP rollout trajectory and NBI contract terms.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Market-Led Broadband Act",
          explanation:
            "Reduce state subsidies; rely on private telco market to complete rollout; renegotiate NBI contract.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Private Broadband Only Act",
          explanation: "Phase out NBP state funding; privatise NBI; market-only delivery.",
          stance: "right",
          economic: 3,
          social: 1,
        },
        {
          name: "Minimal Broadband Subsidy Act",
          explanation: "Cancel NBP contract; wholly market-driven broadband infrastructure.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "economic"
    ),
  },

  // ── Regional Enterprise Development (new) ───────────────────────────────────
  {
    _id: "ie_regional_economic_development",
    countryScope: "ie",
    name: "Regional Enterprise Development Strategy Act",
    description:
      "Funds Western Development Commission, Regional Enterprise Plans, balanced development",
    explanation:
      "Regional Spatial and Economic Strategies (RSES), Western Development Commission, Regional Enterprise Plans (REPs), Project Ireland 2040 balanced-development framing.",
    policyDomain: "economic",
    subCategory: "Regional development",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "population", metricId: "urbanizationRate", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Rural and Community Development"),
    policyOptions: policyOptions(
      "ie_regional_economic_development",
      [
        {
          name: "National Regional Development Bank Act",
          explanation:
            "_Acht Banc Forbartha Náisiúnta Réigiúnaí_ — Establish state-owned regional development bank; mandatory FDI dispersal targets.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Western Investment Drive Act",
          explanation:
            "Triple Western Development Commission budget; statutory FDI dispersal targets for IDA.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Regional Enterprise Plans Expansion Act",
          explanation:
            "Substantially expand REP funding; statutory regional ringfencing in Enterprise Ireland grants.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Regional Strategy Act",
          explanation: "Maintain current RSES / REP / Project Ireland 2040 trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Hub-Concentration Act",
          explanation:
            "Concentrate enterprise support in regional cities (Cork, Limerick, Galway, Waterford); reduce rural-town subsidies.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Dublin-First Concentration Act",
          explanation:
            "Concentrate FDI and enterprise support in Greater Dublin; phase out regional ringfencing.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Market-Led Regional Concentration Act",
          explanation:
            "Wind down WDC, REPs, and regional ringfencing entirely; market-only enterprise location.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR5 — ENVIRONMENT, AGRICULTURE, RURAL (5 new + 1 rewrite)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Climate Action (rewrite — 7-option Climate Action Plan axis) ────────────
  {
    _id: "ie_climate_policy",
    countryScope: "ie",
    name: "Climate Action Bill",
    description: "Sets national carbon reduction targets and energy transition policies",
    explanation:
      "Climate Action Plan 2024 targets 51% emission cuts by 2030 and net-zero by 2050. Agricultural emissions (38% of national total) and transport are the main challenges. Carbon tax pathway €100/tonne by 2030.",
    policyDomain: "environment",
    subCategory: "Climate change",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 1.0 },
      { metricCategoryId: "environment", metricId: "agriEmissionsShare", weight: 0.6 },
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "environment", metricId: "climateResilience", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Environment and Climate Action"),
    policyOptions: policyOptions(
      "ie_climate_policy",
      [
        {
          name: "Emergency Decarbonisation Act",
          explanation:
            "_Acht Dí-charbónaithe Éigeandála_ — Statutory 2035 net-zero target; ban new fossil-fuel connections; mandatory methane cuts.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Climate Action Acceleration Act",
          explanation:
            "Front-load Climate Action Plan delivery; carbon tax accelerated to €150/tonne; sectoral targets binding.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Sectoral Targets Strengthening Act",
          explanation:
            "Binding sectoral emission ceilings; carbon tax to €100/tonne by 2030; LULUCF accounting.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Climate Action Plan Act",
          explanation:
            "Maintain current Climate Action Plan trajectory and €100/tonne carbon tax by 2030.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Carbon Tax Pause Act",
          explanation:
            "Pause carbon tax increases; soften sectoral targets; rely on voluntary industry commitments.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Voluntary Targets Act",
          explanation:
            "Replace binding emission targets with voluntary industry commitments; prioritise farm-income protection.",
          stance: "right",
          economic: 3,
          social: 3,
        },
        {
          name: "Climate Action Repeal Act",
          explanation:
            "Repeal Climate Action and Low Carbon Development Act 2021; withdraw from net-zero commitment.",
          stance: "right",
          economic: 5,
          social: 4,
        },
      ],
      "both"
    ),
  },

  // ── Offshore Wind / Renewable Energy (new) ──────────────────────────────────
  {
    _id: "ie_renewable_energy_target",
    countryScope: "ie",
    name: "Offshore Wind and Renewable Energy Act",
    description:
      "Sets renewable-electricity targets, foreshore licensing, and ORESS auction structure",
    explanation:
      "24 GW offshore wind target by 2030. Foreshore licensing under Maritime Area Planning Act 2021; ORESS auctions; Phase 2 enduring regime. Grid investment via EirGrid.",
    policyDomain: "environment",
    subCategory: "Energy",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "renewableEnergy", weight: 1.0 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.5 },
      { metricCategoryId: "infrastructure", metricId: "powerGridReliability", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Environment, Climate and Communications"),
    policyOptions: policyOptions(
      "ie_renewable_energy_target",
      [
        {
          name: "50 GW Offshore Wind Act",
          explanation:
            "_Acht 50 GW Gaoithe Mara_ — Double the 2030 target; mandatory grid expansion; state-owned ORESS bidder.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Floating Wind Acceleration Act",
          explanation:
            "Front-load floating-wind Phase 2 auctions; expand ORESS price floor; grid-investment doubling.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Grid Investment Drive Act",
          explanation:
            "Accelerate EirGrid PR5 capex; mandatory inter-tie expansion; community-energy ringfencing.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory 24 GW Target Act",
          explanation:
            "Maintain 24 GW by 2030 target with current auction cadence and grid investment.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Below-Target Renewable Act",
          explanation:
            "Reduce offshore wind target to 18 GW; rely on private financing; restrict subsidy levels.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Market-Led Renewables Act",
          explanation: "Phase out ORESS auctions; market-only renewable build-out; no state floor.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Fossil-Friendly Energy Mix Act",
          explanation:
            "Repeal offshore-wind targets; reauthorise new fossil-fuel licences; gas-first energy strategy.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "economic"
    ),
  },

  // ── CAP Implementation / Agricultural Subsidies (new) ───────────────────────
  {
    _id: "ie_agricultural_subsidies",
    countryScope: "ie",
    name: "Common Agricultural Policy Implementation Act",
    description: "Sets CAP Pillar 1 / Pillar 2 split and eco-scheme conditionality",
    explanation:
      "CAP Strategic Plan 2023-27 splits Pillar 1 (direct payments) and Pillar 2 (rural development). Eco-schemes, ACRES, Areas of Natural Constraint payments. Politically central in rural Ireland.",
    policyDomain: "economic",
    subCategory: "Agriculture",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "foodSecurity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "foodSecurity", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "capDependency", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.4 },
      { metricCategoryId: "environment", metricId: "agriEmissionsShare", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Agriculture, Food and the Marine"),
    policyOptions: policyOptions(
      "ie_agricultural_subsidies",
      [
        {
          name: "Agroecological Transition Act",
          explanation:
            "_Acht Aistrithe Agra-éiceolaíoch_ — Mandatory organic conversion; abolish Pillar 1 direct payments; eco-scheme-only support.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "Eco-Scheme Universalisation Act",
          explanation:
            "Convert Pillar 1 to eco-schemes only; substantially expand ACRES participation; mandatory hedgerow retention.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "ACRES Expansion Act",
          explanation:
            "Substantially expand ACRES and Areas of Natural Constraint payments; expand Pillar 2 budget.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory CAP Implementation Act",
          explanation:
            "Maintain current Pillar 1 / Pillar 2 split with current eco-scheme participation rates.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Pillar 1 Restoration Act",
          explanation:
            "Restore Pillar 1 direct-payment dominance; reduce eco-scheme conditionality; protect farm-income.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Beef and Dairy Maximisation Act",
          explanation:
            "Reduce environmental conditionality; expand beef/dairy CAP supports; phase out cross-compliance enforcement.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Free-Market Agriculture Act",
          explanation: "Wind down CAP top-ups; abolish ACRES; market-only farm income.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "economic"
    ),
  },

  // ── Food Vision Strategy (new) ──────────────────────────────────────────────
  {
    _id: "ie_food_security",
    countryScope: "ie",
    name: "Food Vision Strategy Act",
    description: "Sets the Food Vision 2030 framework for agri-food output and sustainability",
    explanation:
      "Food Vision 2030 succeeds Food Wise 2025. Beef-sector strategy, dairy expansion vs. methane-reduction tension, organic conversion target (10% by 2030), Origin Green sustainability certification.",
    policyDomain: "economic",
    subCategory: "Food policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "foodSecurity", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "foodSecurity", weight: -1.0 },
      { metricCategoryId: "environment", metricId: "agriEmissionsShare", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "tradeBalance", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "mncDependency", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Agriculture, Food and the Marine"),
    policyOptions: policyOptions(
      "ie_food_security",
      [
        {
          name: "Plant-Based Transition Act",
          explanation:
            "_Acht Aistrithe Bunaithe ar Phlandaí_ — Statutory shift away from livestock-dominated agriculture; plant-protein-led food strategy.",
          stance: "left",
          economic: -4,
          social: -3,
        },
        {
          name: "Methane Reduction Strategy Act",
          explanation:
            "Statutory dairy herd cap; methane-reduction targets binding on agri-food sector.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Origin Green Expansion Act",
          explanation:
            "Mandatory Origin Green certification; expand organic conversion target to 15%; tightened sustainability conditionality.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Food Vision Act",
          explanation: "Maintain current Food Vision 2030 trajectory and dairy/beef strategy.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Dairy Expansion Act",
          explanation:
            "Expand dairy herd; suspend methane-reduction conditionality; protect export-led beef sector.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Productivist Agriculture Act",
          explanation:
            "Maximise agricultural output; phase out organic targets; remove environmental conditionality.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Maximum Output Agriculture Act",
          explanation:
            "Repeal sustainability conditionality entirely; full productivist agriculture.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── LEADER and Rural Development (new) ──────────────────────────────────────
  {
    _id: "ie_rural_development",
    countryScope: "ie",
    name: "LEADER and Rural Development Programme Act",
    description:
      "Funds LEADER community-led development, Town & Village Renewal, and Údarás na Gaeltachta",
    explanation:
      "LEADER bottom-up community-led development, Town and Village Renewal Scheme, Údarás na Gaeltachta, broadband-rural integration. Politically central in rural-vs-urban framing.",
    policyDomain: "economic",
    subCategory: "Rural development",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "social", metricId: "irishLanguageStrength", weight: 0.3 },
      { metricCategoryId: "population", metricId: "urbanizationRate", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Rural and Community Development"),
    policyOptions: policyOptions(
      "ie_rural_development",
      [
        {
          name: "Comprehensive Rural Revival Act",
          explanation:
            "_Acht Athbheochan Tuaithe Cuimsitheach_ — Massive LEADER funding expansion; rural employment guarantee; Gaeltacht-jobs ringfence.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "LEADER Doubling Act",
          explanation:
            "Double LEADER budget; statutory rural-revitalisation targets; Town & Village Renewal scaled.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Gaeltacht and Western Investment Act",
          explanation: "Triple Údarás na Gaeltachta funding; expand Western Investment Fund.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory LEADER Programme Act",
          explanation: "Maintain current LEADER cycle, Town & Village Renewal, and Údarás budgets.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Targeted Rural Development Act",
          explanation:
            "Reduce LEADER blanket grants; market-only town renewal; restrict Údarás mandate.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Urban-First Investment Act",
          explanation:
            "Phase out LEADER; concentrate investment in regional cities; market-led rural development.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Market-Only Rural Strategy Act",
          explanation: "Wind down LEADER and Údarás entirely; market-only rural development.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Peatlands Conservation and Restoration (new) ────────────────────────────
  {
    _id: "ie_peat_bog_policy",
    countryScope: "ie",
    name: "Peatlands Conservation and Restoration Act",
    description: "Sets Bord na Móna just-transition, rewetting, and turf-cutting framework",
    explanation:
      "Bord na Móna just-transition (peat extraction ceased 2020), raised-bog rewetting, turf-cutting phase-out compensation. Politically very local-salience in midland counties.",
    policyDomain: "environment",
    subCategory: "Peatlands",
    nationalOnly: false,
    // RETARGET (Spec B, ex-Spec A): bog rewetting/conservation is fundamentally land
    // protection; carbonEmissions (windowed 1990, type "always") demoted secondary.
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "protectedLand",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "environment", metricId: "protectedLand", weight: 1.0 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: 0.6 },
      { metricCategoryId: "environment", metricId: "agriEmissionsShare", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Environment, Climate and Communications"),
    policyOptions: policyOptions(
      "ie_peat_bog_policy",
      [
        {
          name: "Total Peatlands Restoration Act",
          explanation:
            "_Acht Athchóirithe Iomláin na Mhóinte_ — Statutory rewetting of all raised bogs; ban all turf cutting; full compensation for cutters.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Raised Bog Rewetting Acceleration Act",
          explanation:
            "Front-load Bord na Móna just-transition rewetting; statutory bog restoration targets.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Turf-Cutter Compensation Expansion Act",
          explanation:
            "Expand turf-cutter compensation; statutory phase-out timeline for domestic cutting.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Peatlands Strategy Act",
          explanation:
            "Maintain current Bord na Móna just-transition and turf-cutting phase-out trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Continued Domestic Cutting Act",
          explanation:
            "Extend turf-cutting permissions for domestic use; pause rewetting in private holdings.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "Bog Cutters Rights Act",
          explanation:
            "Statutory right to cut turf on traditional plots; reverse Habitats Directive enforcement on protected bogs.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "Full Peat Extraction Restoration Act",
          explanation:
            "Reauthorise commercial peat extraction; repeal Habitats Directive enforcement on raised bogs.",
          stance: "right",
          economic: 3,
          social: 4,
        },
      ],
      "both"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR6 — DEFENCE, FOREIGN AFFAIRS, JUSTICE, GOVERNANCE (8 new types)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Defence Forces Spending (new) ───────────────────────────────────────────
  {
    _id: "ie_defence_spending",
    countryScope: "ie",
    name: "Defence Forces Spending Act",
    description: "Sets the Defence Forces Level of Ambition (LOA) framework and budget envelope",
    explanation:
      "Defence Forces Level of Ambition framework. Ireland spends ~0.2% of GNI* on defence, among the lowest in the EU. Commission on the Defence Forces (2022) recommended LOA 2 (€1.5bn) or LOA 3 (€3bn).",
    policyDomain: "defense",
    subCategory: "Defence spending",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "unityReferendumSupport", weight: -0.2 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: dailCommitteePositions("Foreign Affairs and Defence"),
    policyOptions: policyOptions(
      "ie_defence_spending",
      [
        {
          name: "Defence Force Abolition Act",
          explanation:
            "_Acht Díbhe na bhFórsaí Cosanta_ — Phase out Defence Forces; constitutional reaffirmation of neutrality; UN-only operational mandate.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Demilitarisation Act",
          explanation:
            "Substantial Defence Forces drawdown; cancel LOA 2 capital programme; peacekeeping-only mandate.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Minimal Defence Forces Act",
          explanation:
            "Below-LOA-2 spending; restrict Defence Forces to peacekeeping and EEZ patrol.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Defence Spending Act",
          explanation: "Maintain current LOA 2 trajectory and ~0.2% GNI* spending floor.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "LOA 2 Implementation Act",
          explanation:
            "Implement LOA 2 (€1.5bn); substantial Naval Service expansion; double Air Corps fleet.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "LOA 3 Implementation Act",
          explanation:
            "Implement LOA 3 (€3bn); full Commission on the Defence Forces recommendations; air-defence radar capability.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "NATO-Standard Defence Spending Act",
          explanation:
            "_Acht Caiteachais Cosanta NATO_ — 2% GNI* defence spending; full LOA 3 with conventional and cyber capability.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Constitutional Neutrality (new) ─────────────────────────────────────────
  {
    _id: "ie_neutrality_posture",
    countryScope: "ie",
    name: "Constitutional Neutrality Doctrine Act",
    description: "Sets the framework for the triple-lock and EU CSDP / NATO posture",
    explanation:
      "Triple-lock (UN mandate + Government + Dáil approval) for overseas troop deployments. Article 28.3 referendum requirement for declaration of war. Long-running debate on EU CSDP integration.",
    policyDomain: "defense",
    subCategory: "Neutrality doctrine",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "unityReferendumSupport",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "unityReferendumSupport", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: -0.3 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.3 },
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 0.2 },
      { metricCategoryId: "governance" as const, metricId: "militaryReadiness", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Foreign Affairs and Defence"),
    policyOptions: policyOptions(
      "ie_neutrality_posture",
      [
        {
          name: "Constitutional Neutrality Lock Act",
          explanation:
            "_Acht Glais Bhunreachtúil na Neodrachta_ — Constitutional amendment hardening neutrality; ban EU CSDP / NATO PfP participation.",
          stance: "left",
          economic: -3,
          social: -5,
        },
        {
          name: "Triple-Lock Strengthening Act",
          explanation:
            "Tighten triple-lock; statutory bar on EU CSDP integration; affirm UN-only mandate.",
          stance: "left",
          economic: -2,
          social: -4,
        },
        {
          name: "Statutory Neutrality Reinforcement Act",
          explanation:
            "Statutory non-aligned posture; participation in EU CSDP limited to non-combat.",
          stance: "left",
          economic: -1,
          social: -2,
        },
        {
          name: "Statutory Triple-Lock Act",
          explanation:
            "Maintain current triple-lock + non-aligned posture; selective EU CSDP participation.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "EU Defence Integration Act",
          explanation:
            "Soften triple-lock; participate in EU CSDP including PESCO mission-deployable units.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "NATO Partnership for Peace Plus Act",
          explanation:
            "Active PfP engagement; consider NATO-aligned status; replace triple-lock with dual-lock (Government + Dáil only).",
          stance: "right",
          economic: 2,
          social: 4,
        },
        {
          name: "NATO Membership Act",
          explanation:
            "Constitutional referendum on full NATO membership; abandon non-alignment doctrine.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ── Irish Aid and ODA Strategy (new) ────────────────────────────────────────
  {
    _id: "ie_foreign_aid_diplomacy",
    countryScope: "ie",
    name: "Irish Aid and ODA Strategy Act",
    description:
      "Sets the framework for Official Development Assistance and multilateral engagement",
    explanation:
      "Irish Aid manages ODA — currently ~0.3% of GNI* against the 0.7% UN target. A Better World policy framework (2019). UN Security Council non-permanent term 2021-22 highlighted Irish diplomatic profile.",
    policyDomain: "foreign_policy",
    subCategory: "Foreign aid",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "publicTrust", weight: -0.4 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Foreign Affairs and Defence"),
    policyOptions: policyOptions(
      "ie_foreign_aid_diplomacy",
      [
        {
          name: "1% GNI ODA Act",
          explanation:
            "_Acht 1% GNI Cúnaimh_ — Statutory 1% GNI* ODA target; expand to climate-justice financing for global south.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "0.7% UN Target Hit Act",
          explanation:
            "Front-load Irish Aid to hit 0.7% GNI* UN target by 2030; expand multilateral commitments.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "A Better World Expansion Act",
          explanation:
            "Substantially expand Irish Aid programme; multilateral preference; gender-equality and climate-justice priorities.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Irish Aid Strategy Act",
          explanation: "Maintain current A Better World policy and ~0.3% GNI* ODA spend.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Trade-Linked Aid Act",
          explanation:
            "Pivot Irish Aid to bilateral commercial-diplomacy focus; emphasise tied aid and Enterprise Ireland linkage.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Minimal ODA Act",
          explanation: "Reduce ODA to 0.15% of GNI*; humanitarian-emergency only.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Irish Aid Abolition Act",
          explanation: "Wind down Irish Aid entirely; eliminate ODA budget line.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── National Cyber Security Centre (new) ────────────────────────────────────
  {
    _id: "ie_cybersecurity",
    countryScope: "ie",
    name: "National Cyber Security Centre Act",
    description: "Sets the framework for NCSC mandate, CNI designation, and NIS2 transposition",
    explanation:
      "NCSC (within DECC) is the national CSIRT. HSE 2021 ransomware incident exposed under-capacity. NIS2 transposition, critical-infrastructure designation under Cybersecurity Strategy.",
    policyDomain: "defense",
    subCategory: "Cybersecurity",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.1 },
    ],
    positions: dailCommitteePositions("Environment, Climate and Communications"),
    policyOptions: policyOptions(
      "ie_cybersecurity",
      [
        {
          name: "National Cyber Command Act",
          explanation:
            "_Acht Ceannasaíocht Náisiúnta Chibearshlándála_ — Statutory cyber-defence command with offensive cyber capability.",
          stance: "left",
          economic: -4,
          social: -2,
        },
        {
          name: "NCSC Major Expansion Act",
          explanation:
            "Triple NCSC headcount; binding CNI designation for telcos, utilities, financial services.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "NIS2 Maximalist Implementation Act",
          explanation:
            "Expansive NIS2 transposition; comprehensive CNI designation; mandatory incident reporting.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory NCSC Capacity Act",
          explanation: "Maintain current NCSC trajectory and NIS2 transposition pace.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light-Touch NIS2 Implementation Act",
          explanation:
            "Minimum NIS2 transposition; voluntary CNI designation; rely on private-sector security spend.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Market-Led Cybersecurity Act",
          explanation:
            "Reduce NCSC mandate; rely on private cyber-insurance market; outsource CSIRT to private sector.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "NCSC Abolition Act",
          explanation: "Wind down NCSC; entirely private-market cyber defence.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── An Garda Síochána Reform (new) ──────────────────────────────────────────
  {
    _id: "ie_garda_policing",
    countryScope: "ie",
    name: "An Garda Síochána Reform Act",
    description: "Sets the Garda Operating Model, oversight, and force-structure direction",
    explanation:
      "Commission on the Future of Policing in Ireland (2018) drove Operating Model reform. Policing Authority oversight, body-cam deployment, community policing, recruitment shortages.",
    policyDomain: "criminal_justice",
    subCategory: "Policing",
    nationalOnly: false,
    effectTarget: { metricCategoryId: "publicSafety", metricId: "crimeRate", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: -0.6 },
      { metricCategoryId: "publicSafety", metricId: "policePerCapita", weight: -0.5 },
      { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "corruptionIndex", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Justice"),
    policyOptions: policyOptions(
      "ie_garda_policing",
      [
        {
          name: "Community Policing Maximalist Act",
          explanation:
            "_Acht Pólaíocht Pobail Uasmhéid_ — Restructure Gardaí toward community-policing-only model; demilitarise; restrict armed units.",
          stance: "left",
          economic: -3,
          social: -3,
        },
        {
          name: "Operating Model Acceleration Act",
          explanation:
            "Front-load Commission on Future of Policing recommendations; substantial community-policing expansion.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Garda Recruitment Drive Act",
          explanation:
            "Double Garda recruitment; mandatory body-cams; strengthen Policing Authority and GSOC powers.",
          stance: "left",
          economic: -1,
          social: -1,
        },
        {
          name: "Statutory Operating Model Act",
          explanation:
            "Maintain current Operating Model implementation pace and Garda strength target.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Tougher Policing Act",
          explanation:
            "Increase armed-unit deployment; expand stop-and-search powers; reduce GSOC oversight scope.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Maximum Enforcement Act",
          explanation:
            "Aggressive policing posture; expand armed Special Detective Unit; reduce community-policing emphasis.",
          stance: "right",
          economic: 3,
          social: 4,
        },
        {
          name: "Militarised Policing Act",
          explanation:
            "Routine armed patrols; expand surveillance powers; reduce Policing Authority and GSOC oversight to minimum.",
          stance: "right",
          economic: 5,
          social: 5,
        },
      ],
      "both"
    ),
  },

  // ── Criminal Justice and SCC Reform (new) ───────────────────────────────────
  {
    _id: "ie_criminal_justice",
    countryScope: "ie",
    name: "Criminal Justice and Special Criminal Court Reform Act",
    description: "Sets the framework for sentencing, bail, SCC scope, and Probation Service",
    explanation:
      "Special Criminal Court non-jury trial reviews. Bail laws, sentencing guidelines, Probation Service capacity. Prison overcrowding chronic. Spent Convictions reform debate.",
    policyDomain: "criminal_justice",
    subCategory: "Criminal justice",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "recidivismRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "publicSafety", metricId: "recidivismRate", weight: 1.0 },
      { metricCategoryId: "publicSafety", metricId: "incarcerationRate", weight: 0.5 },
      { metricCategoryId: "publicSafety", metricId: "crimeRate", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "corruptionIndex", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: dailCommitteePositions("Justice"),
    policyOptions: policyOptions(
      "ie_criminal_justice",
      [
        {
          name: "Restorative Justice Universalisation Act",
          explanation:
            "_Acht Ceartais Athchóirithigh Uilíoch_ — Restorative-justice-only model for non-violent offences; abolish Special Criminal Court.",
          stance: "left",
          economic: -3,
          social: -5,
        },
        {
          name: "Probation Expansion Act",
          explanation:
            "Triple Probation Service capacity; presumption against custody under 2 years; SCC subject to sunset review.",
          stance: "left",
          economic: -2,
          social: -3,
        },
        {
          name: "Sentencing Reform Act",
          explanation:
            "Statutory sentencing guidelines reducing custodial sentencing; expand suspended-sentence eligibility.",
          stance: "left",
          economic: -1,
          social: -2,
        },
        {
          name: "Statutory Criminal Justice Act",
          explanation:
            "Maintain current sentencing guidelines, Special Criminal Court, and Probation Service trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Bail Tightening Act",
          explanation:
            "Mandatory bail refusal for serious offences; expand SCC remit; tightened sentencing guidelines.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "Mandatory Minimum Sentences Act",
          explanation:
            "Mandatory minimum sentencing across serious offences; tougher SCC role; reduced parole eligibility.",
          stance: "right",
          economic: 3,
          social: 4,
        },
        {
          name: "Three-Strikes Sentencing Act",
          explanation:
            "Mandatory life-term three-strikes provision; expand SCC to all organised-crime matters.",
          stance: "right",
          economic: 5,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ── Standards in Public Office Reform (new) ─────────────────────────────────
  {
    _id: "ie_government_ethics",
    countryScope: "ie",
    name: "Standards in Public Office Reform Act",
    description: "Sets SIPO scope, lobbying register enforcement, and post-employment cooling-off",
    explanation:
      "SIPO powers and remit, lobbying register enforcement, post-employment cooling-off rules. Recurring scandals (Cervical Check, Apple-state-aid, RTÉ governance) drive periodic reform.",
    policyDomain: "governance",
    subCategory: "Government ethics",
    nationalOnly: true,
    // §4.7 (P4): ethics laws are transparency-INSTITUTION mechanisms — the
    // engine derives corruption from the transparency root.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.5 },
      { metricCategoryId: "social", metricId: "civicParticipation", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Public Administration and Petitions"),
    policyOptions: policyOptions(
      "ie_government_ethics",
      [
        {
          name: "Comprehensive Anti-Corruption Act",
          explanation:
            "_Acht Frith-Éillithe Cuimsitheach_ — Permanent anti-corruption inspectorate; lifetime post-employment ban for Ministers; full beneficial-ownership disclosure.",
          stance: "left",
          economic: -4,
          social: -4,
        },
        {
          name: "SIPO Empowerment Act",
          explanation:
            "Triple SIPO budget; binding lobbying register enforcement; 3-year ministerial post-employment cooling-off.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Lobbying Reform Act",
          explanation:
            "Strengthen Lobbying Register; expand SIPO investigation powers; mandatory ethical training for Oireachtas members.",
          stance: "left",
          economic: -1,
          social: -1,
        },
        {
          name: "Statutory Standards in Public Office Act",
          explanation:
            "Maintain current SIPO framework with annual cooling-off and lobbying register.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Light-Touch Ethics Act",
          explanation:
            "Reduce SIPO mandate; voluntary lobbying disclosure; 6-month cooling-off only.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "Deregulated Lobbying Act",
          explanation:
            "Repeal Lobbying Register; rely on free-press scrutiny; minimal SIPO mandate.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "Ethics Repeal Act",
          explanation:
            "Wind down SIPO; rely on criminal-law sanctions for outright corruption only.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "both"
    ),
  },

  // ── Electoral Commission and Seanad Reform (new) ────────────────────────────
  {
    _id: "ie_electoral_reform",
    countryScope: "ie",
    name: "Electoral Commission and Seanad Reform Act",
    description: "Sets the framework for An Coimisiún Toghcháin remit and Seanad structure",
    explanation:
      "An Coimisiún Toghcháin (Electoral Commission, 2023) consolidates referendum, register, and boundary functions. Long-debated Seanad reform (direct election expansion). PR-STV electoral system review.",
    policyDomain: "governance",
    subCategory: "Electoral reform",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "voterTurnout", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
      { metricCategoryId: "social", metricId: "civicParticipation", weight: 0.5 },
      { metricCategoryId: "governance", metricId: "publicTrust", weight: 0.4 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Public Administration and Petitions"),
    policyOptions: policyOptions(
      "ie_electoral_reform",
      [
        {
          name: "Direct Democracy Expansion Act",
          explanation:
            "_Acht Forleathnaithe na Daonlathais Dhírigh_ — Citizens' Assembly recommendations directly to referendum; ranked-choice all chambers.",
          stance: "left",
          economic: -3,
          social: -4,
        },
        {
          name: "Universal Seanad Election Act",
          explanation:
            "Open Seanad election to all citizens (replacing vocational panels); mandatory civic education curriculum.",
          stance: "left",
          economic: -2,
          social: -3,
        },
        {
          name: "Electoral Commission Empowerment Act",
          explanation:
            "Strengthen An Coimisiún Toghcháin powers; statutory mis/disinformation oversight; postal-voting universalisation.",
          stance: "left",
          economic: -1,
          social: -2,
        },
        {
          name: "Statutory Electoral Commission Act",
          explanation:
            "Maintain current An Coimisiún Toghcháin remit and Seanad vocational-panel structure.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Seanad Reduction Act",
          explanation:
            "Reduce Seanad to advisory chamber only; cut Taoiseach's-nominees from 11 to 5.",
          stance: "right",
          economic: 1,
          social: 2,
        },
        {
          name: "Seanad Abolition Act",
          explanation: "Constitutional referendum to abolish Seanad; unicameral Dáil only.",
          stance: "right",
          economic: 2,
          social: 3,
        },
        {
          name: "First-Past-the-Post Reform Act",
          explanation:
            "Constitutional referendum to replace PR-STV with FPTP; abolish Seanad simultaneously.",
          stance: "right",
          economic: 3,
          social: 5,
        },
      ],
      "social"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR7 — IMMIGRATION (3 new types)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── International Protection and IPAS Reform (new) ──────────────────────────
  {
    _id: "ie_immigration_asylum",
    countryScope: "ie",
    name: "International Protection and IPAS Reform Act",
    description: "Sets the framework for asylum processing and Direct Provision replacement",
    explanation:
      "White Paper to End Direct Provision (2021) commits to replace DP with not-for-profit accommodation by 2024 (delayed). IPAS capacity strained by Ukraine-displaced and asylum-seeker numbers. Processing-time scandals.",
    policyDomain: "immigration",
    subCategory: "Asylum policy",
    nationalOnly: true,
    // RETARGET (Spec B, ex-Spec A): asylum/immigration policy's primary lever is
    // the migration inflow; directProvisionLoad (windowed 2000) demoted secondary.
    effectTarget: {
      metricCategoryId: "population",
      metricId: "migrationRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "population", metricId: "migrationRate", weight: 1.0 },
      { metricCategoryId: "governance", metricId: "directProvisionLoad", weight: 0.4 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: -0.4 },
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 0.4 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      // Right-lane axis metric: tightening (right) raises borderSecurity.
      { metricCategoryId: "governance", metricId: "borderSecurity", weight: -0.5 },
    ],
    positions: dailCommitteePositions("Children, Equality, Disability, Integration and Youth"),
    policyOptions: policyOptions(
      "ie_immigration_asylum",
      [
        {
          name: "Open-Border Sanctuary Act",
          explanation:
            "_Acht Tearmainn Oscailte_ — Statutory sanctuary policy; rapid recognition; full access to housing/health/welfare from day one.",
          stance: "left",
          economic: -5,
          social: -4,
        },
        {
          name: "Direct Provision Replacement Act",
          explanation:
            "Front-load White Paper to End Direct Provision; statutory not-for-profit accommodation by 2026; 12-month processing target.",
          stance: "left",
          economic: -3,
          social: -3,
        },
        {
          name: "IPAS Service Quality Act",
          explanation:
            "Substantially expand IPAS accommodation capacity; statutory standards; expedite processing under 18 months.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Statutory IPAS Act",
          explanation: "Maintain current IPAS structure with phased Direct Provision replacement.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Stricter Asylum Processing Act",
          explanation:
            "Tighten manifestly-unfounded determinations; accelerated returns; expand safe-country list.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Detention-First Asylum Act",
          explanation:
            "Mandatory detention pending determination; restrict family reunification; reduce social-welfare entitlement.",
          stance: "right",
          economic: 3,
          social: 4,
        },
        {
          name: "Asylum Lockdown Act",
          explanation:
            "Repeal International Protection Act 2015; minimum-treaty-floor processing; mandatory return.",
          stance: "right",
          economic: 5,
          social: 5,
        },
      ],
      "both"
    ),
  },

  // ── Critical Skills and Employment Permits (new) ────────────────────────────
  {
    _id: "ie_work_visas",
    countryScope: "ie",
    name: "Critical Skills and Employment Permits Act",
    description: "Sets the framework for Critical Skills, General Employment Permit, and Stamp 4",
    explanation:
      "Critical Skills Employment Permit list (high-skilled), General Employment Permit caps, Stamp 4 family-reunification rules. Post-Brexit increase in EU professionals applying. Ineligible Occupations List under review.",
    policyDomain: "immigration",
    subCategory: "Work permits",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "fdiPipelineStrength",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "fdiPipelineStrength", weight: 0.7 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "mncDependency", weight: -0.4 },
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.4 },
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 0.3 },
      // Work-permit volume is a labor-migration inflow → migrationRate driver (§4.6).
      { metricCategoryId: "population", metricId: "migrationRate", weight: 0.4 },
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    positions: dailCommitteePositions("Enterprise, Trade and Employment"),
    policyOptions: policyOptions(
      "ie_work_visas",
      [
        {
          name: "Open Skilled-Migration Act",
          explanation:
            "_Acht Imirce Scileanna Oscailte_ — Abolish General Employment Permit cap; statutory Stamp 4 fast-track for all permit holders.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "Critical Skills Expansion Act",
          explanation:
            "Substantially expand Critical Skills list; shorten residency requirement for naturalisation; family-reunification expansion.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "Permit System Liberalisation Act",
          explanation:
            "Raise General Employment Permit cap; shorten labour-market needs test; expand Stamp 4 eligibility.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Employment Permits Act",
          explanation:
            "Maintain current Critical Skills / General Employment Permit structure and cap.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Tighter Permit Allocation Act",
          explanation:
            "Tighten General Employment Permit cap; expand Ineligible Occupations List; longer labour-market needs test.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Restrictive Work Visa Act",
          explanation:
            "Reduce Critical Skills list to core ICT / healthcare only; restrict family reunification; rigid quota.",
          stance: "right",
          economic: 3,
          social: 3,
        },
        {
          name: "Closed-Door Employment Permits Act",
          explanation: "Phase out non-EEA work permits; rely on indigenous + EU labour only.",
          stance: "right",
          economic: 5,
          social: 4,
        },
      ],
      "both"
    ),
  },

  // ── New Communities Integration Strategy (new) ──────────────────────────────
  {
    _id: "ie_integration_programs",
    countryScope: "ie",
    name: "New Communities Integration Strategy Act",
    description: "Sets the framework for ESOL, naturalisation, and Migrant Integration Strategy",
    explanation:
      "Migrant Integration Strategy 2017-21 (lapsed; successor consultation underway). ESOL English-language provision, ECCE for migrant children, naturalisation pathways, Black and Irish initiatives.",
    policyDomain: "immigration",
    subCategory: "Integration",
    nationalOnly: false,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foreignWorkerIntegration",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "foreignWorkerIntegration", weight: 1.0 },
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.5 },
      { metricCategoryId: "social", metricId: "socialMobility", weight: 0.4 },
      { metricCategoryId: "social", metricId: "irishLanguageStrength", weight: -0.2 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Children, Equality, Disability, Integration and Youth"),
    policyOptions: policyOptions(
      "ie_integration_programs",
      [
        {
          name: "Universal Integration Programme Act",
          explanation:
            "_Acht Lánpháirtithe Uilíoch_ — Statutory right to ESOL English / Irish-language training; civics; free naturalisation.",
          stance: "left",
          economic: -5,
          social: -4,
        },
        {
          name: "Naturalisation Fast-Track Act",
          explanation:
            "Shorten residency requirement to 3 years; expand ESOL funding; statutory recognition of overseas qualifications.",
          stance: "left",
          economic: -3,
          social: -3,
        },
        {
          name: "Migrant Integration Strategy Plus Act",
          explanation:
            "Strengthened successor Migrant Integration Strategy with binding sectoral commitments.",
          stance: "left",
          economic: -2,
          social: -2,
        },
        {
          name: "Statutory Integration Strategy Act",
          explanation:
            "Replace lapsed Migrant Integration Strategy with comparable successor framework.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Conditional Integration Act",
          explanation:
            "Tighten naturalisation testing; English-language requirement for permanent residency; reduce ESOL grant funding.",
          stance: "right",
          economic: 2,
          social: 2,
        },
        {
          name: "Assimilationist Integration Act",
          explanation:
            "Mandatory civic-integration testing; restrict dual nationality; replace ESOL with paid-for private provision.",
          stance: "right",
          economic: 3,
          social: 4,
        },
        {
          name: "Minimal Integration Act",
          explanation:
            "Wind down integration funding; restrict naturalisation to long-term residents with high income thresholds.",
          stance: "right",
          economic: 5,
          social: 5,
        },
      ],
      "both"
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PR8 — REGIONAL (NUTS-III) — 4 state-scoped types
  //  All use allowedScope: "state" and aggregate into per-region statePolicies.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Regional Health Services Delivery (new, regional) ───────────────────────
  {
    _id: "ie_regional_health",
    countryScope: "ie",
    name: "Regional Health Services Delivery Act",
    description: "Sets regional HSE network funding and community-health investment per RHA",
    explanation:
      "HSE Regional Health Areas (RHAs) implementation underway since 2023. Six geographic areas with regional health-network governance. Regional hospital-network configuration, GP coverage, community health-network funding.",
    policyDomain: "healthcare",
    subCategory: "Regional health",
    allowedScope: "state",
    // RETARGET (Spec B, ex-Spec A): regional health capacity is best expressed by
    // physician provision; hseWaitingListMonths (windowed 2005) demoted secondary.
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "physicianRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "healthcare", metricId: "physicianRate", weight: 1.0 },
      { metricCategoryId: "healthcare", metricId: "hseWaitingListMonths", weight: 0.4 },
      { metricCategoryId: "healthcare", metricId: "publicHealthPreparedness", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Health"),
    policyOptions: policyOptions(
      "ie_regional_health",
      [
        {
          name: "Regional Universal Healthcare Act",
          explanation:
            "_Acht Sláinte Uilíoch Réigiúnaí_ — Regional health network with full universal-coverage capacity; substantial RHA investment.",
          stance: "left",
          economic: -5,
          social: -2,
        },
        {
          name: "RHA Acceleration Act",
          explanation:
            "Front-load RHA implementation; substantial community health network expansion.",
          stance: "left",
          economic: -3,
          social: -1,
        },
        {
          name: "Regional Health Investment Act",
          explanation:
            "Above-statutory regional health spending; expand regional hospital networks.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory RHA Implementation Act",
          explanation:
            "Maintain current RHA implementation pace and regional hospital network configuration.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Cost-Constrained Regional Health Act",
          explanation:
            "Slow RHA rollout; consolidate regional hospital services; private-sector capacity expansion.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Market-Led Regional Health Act",
          explanation:
            "Reduce regional public-health spending; private-hospital expansion; market-led capacity.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Minimal Regional Health Act",
          explanation:
            "Wind down RHA structure; centralised funding only with private-provider delivery.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Regional Housing Strategy (new, regional) ───────────────────────────────
  {
    _id: "ie_regional_housing",
    countryScope: "ie",
    name: "Regional Housing Strategy Act",
    description: "Sets RSES housing targets, LDA activation, and AHB pipeline per region",
    explanation:
      "Regional Spatial and Economic Strategies (RSES) set regional housing targets. Land Development Agency activates publicly-owned land for affordable cost-rental. Approved Housing Bodies (AHBs) deliver social and cost-rental.",
    policyDomain: "housing",
    subCategory: "Regional housing",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingCompletionsRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "housingCompletionsRate", weight: 1.0 },
      { metricCategoryId: "social", metricId: "housingAffordability", weight: 0.5 },
      { metricCategoryId: "social", metricId: "vacantPropertyRate", weight: 0.4 },
      { metricCategoryId: "social", metricId: "rentalPressureIndex", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Housing"),
    policyOptions: policyOptions(
      "ie_regional_housing",
      [
        {
          name: "Vienna-Model Regional Housing Act",
          explanation:
            "_Acht Tithíochta Vienna Réigiúnaí_ — Statutory regional cost-rental targets; mass LDA activation; AHB delivery doubled.",
          stance: "left",
          economic: -5,
          social: -3,
        },
        {
          name: "RSES Acceleration Act",
          explanation:
            "Front-load RSES housing targets; statutory regional LDA presence; expand AHB approval pathways.",
          stance: "left",
          economic: -3,
          social: -2,
        },
        {
          name: "LDA Cost-Rental Expansion Act",
          explanation:
            "Substantially expand LDA cost-rental in regional cities; statutory AHB pipeline.",
          stance: "left",
          economic: -2,
          social: -1,
        },
        {
          name: "Statutory Regional Housing Plan Act",
          explanation: "Maintain current RSES housing targets and LDA / AHB activation pace.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Market-Led Regional Housing Act",
          explanation:
            "Reduce LDA mandate; market-only supply in regional towns; planning deregulation.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Regional Planning Deregulation Act",
          explanation: "Repeal RSES targets; market-only regional planning; reduce AHB role.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Pure Laissez-Faire Regional Act",
          explanation:
            "Wind down LDA, AHB pipeline, and RSES targets entirely; market-only regional supply.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Regional Transport Infrastructure (new, regional) ───────────────────────
  {
    _id: "ie_regional_transport",
    countryScope: "ie",
    name: "Regional Transport Infrastructure Act",
    description:
      "Sets Connecting Ireland rural mobility, regional rail, and LIS funding per region",
    explanation:
      "NTA regional plans, Connecting Ireland Rural Mobility, Local Improvement Schemes (LIS) for regional roads. TFI Local Link, regional rail-line investment.",
    policyDomain: "infrastructure",
    subCategory: "Regional transport",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "publicTransit",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "infrastructure", metricId: "publicTransit", weight: 0.8 },
      { metricCategoryId: "infrastructure", metricId: "transportEfficiency", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.5 },
      { metricCategoryId: "infrastructure", metricId: "roadCondition", weight: -0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Transport"),
    policyOptions: policyOptions(
      "ie_regional_transport",
      [
        {
          name: "Universal Rural Transport Act",
          explanation:
            "_Acht Iompair Tuaithe Uilíoch_ — Free regional public-transport; statutory rural-mobility entitlement; full TFI Local Link expansion.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Connecting Ireland Doubling Act",
          explanation:
            "Double Connecting Ireland Rural Mobility funding; reopen Western Rail Corridor; expand intercity rail.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Regional Rail Investment Act",
          explanation:
            "Substantial regional-rail capital expenditure; expanded TFI integration; LIS quadrupling.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Regional Transport Plan Act",
          explanation:
            "Maintain current NTA regional plans, Connecting Ireland trajectory, and LIS funding.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Roads-First Regional Transport Act",
          explanation:
            "Rebalance funding toward regional motorways; reduce subsidies on rural public transport.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Toll-Road Regional Act",
          explanation:
            "Privatise selected regional rail; expand toll-roads as primary regional infrastructure.",
          stance: "right",
          economic: 3,
          social: 2,
        },
        {
          name: "Market-Only Regional Mobility Act",
          explanation:
            "Phase out subsidised regional transport; toll-roads and market-only services.",
          stance: "right",
          economic: 5,
          social: 3,
        },
      ],
      "both"
    ),
  },

  // ── Regional Skills Forum Strategy (new, regional) ──────────────────────────
  {
    _id: "ie_regional_skills",
    countryScope: "ie",
    name: "Regional Skills Forum Strategy Act",
    description: "Sets Regional Skills Fora, FET Strategy, and ETB capital programme per region",
    explanation:
      "Regional Skills Fora, Further Education and Training (FET) Strategy, Skillnet Ireland regional networks. ETB capital programme, regional apprenticeship centres.",
    policyDomain: "education",
    subCategory: "Regional skills",
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "apprenticeshipRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "education", metricId: "apprenticeshipRate", weight: 1.0 },
      { metricCategoryId: "education", metricId: "workforceSkill", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "ruralRevitalization", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.3 },
      { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.3 },
    ],
    positions: dailCommitteePositions("Education"),
    policyOptions: policyOptions(
      "ie_regional_skills",
      [
        {
          name: "Universal Regional FET Entitlement Act",
          explanation:
            "_Acht Teidlíochta FET Réigiúnaí Uilíoch_ — Statutory regional lifelong-learning entitlement; free regional FET to age 65.",
          stance: "left",
          economic: -5,
          social: -1,
        },
        {
          name: "Regional Skills Hub Expansion Act",
          explanation:
            "Triple Regional Skills Forum budget; statutory regional apprenticeship-centre presence.",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          name: "Skillnet Regional Doubling Act",
          explanation: "Double Skillnet Ireland regional networks; expand FET capital programme.",
          stance: "left",
          economic: -2,
          social: 0,
        },
        {
          name: "Statutory Regional Skills Strategy Act",
          explanation:
            "Maintain current Regional Skills Fora, FET Strategy, and ETB capital trajectory.",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          name: "Employer-Led Regional Skills Act",
          explanation:
            "Replace Regional Skills Fora with employer-led funding mechanisms; reduce ETB direct grants.",
          stance: "right",
          economic: 2,
          social: 1,
        },
        {
          name: "Market-Based Regional Skills Act",
          explanation:
            "Phase out Regional Skills Fora; private training providers; voucher-based regional skills support.",
          stance: "right",
          economic: 3,
          social: 1,
        },
        {
          name: "Minimal Regional Skills Programme Act",
          explanation: "Wind down regional skills mandate entirely; market-only FET.",
          stance: "right",
          economic: 5,
          social: 2,
        },
      ],
      "economic"
    ),
  },

  // ── P6a: Recruitment / National Service (militaryReadiness + conscription axis home) ──
  {
    _id: "ie_defence_recruitment",
    countryScope: "ie",
    name: "Defence Forces Recruitment Act",
    description:
      "Defence Forces recruitment, retention, and the reserve - within the neutrality tradition",
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
    positions: dailCommitteePositions("Defence"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "ie_defence_recruitment",
        [
          { name: "Minimal Defence Establishment Act", stance: "left", effectDirection: -1 },
          { name: "Volunteer Defence Act", stance: "left", effectDirection: -1 },
          { name: "Professional Defence Forces Act", stance: "left", effectDirection: -1 },
          { name: "Recruitment Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Reserve Defence Expansion Act", stance: "right", effectDirection: 1 },
          { name: "National Service Pathways Act", stance: "right", effectDirection: 1 },
          { name: "Universal Service Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Reduce the Defence Forces to a minimal establishment focused on aid to the civil power",
          "Maintain a small volunteer force with improved pay following the commission recommendations",
          "Professionalize with substantial retention allowances and naval service crewing priority",
          "Continue current recruitment campaigns and cadetship intake levels",
          "Expand the Reserve Defence Force with employer protections and training bounties",
          "Introduce a voluntary national service year with defence and civil options",
          "Institute universal service obligations notwithstanding the neutrality tradition",
        ][i],
      })),
      [2, 4, 7, 10, 16, 26, 40]
    ),
    source: "seed",
    isPermanent: true,
  },
  // ── P6a: media/press wiring home (pressFreedom + stateMediaControl) ──
  {
    _id: "ie_media_press",
    countryScope: "ie",
    name: "Media and Press Freedom Act",
    description:
      "Press regulation, public broadcaster governance, defamation reform, and media plurality",
    policyDomain: "mediaInformation",
    subCategory: "Media / press",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "national",
    },
    effectTargetsWeighted: [
      { metricCategoryId: "mediaInformation", metricId: "pressFreedom", weight: 1.0 },
      // negative weight: a press-restrictive direction raises state control.
      { metricCategoryId: "mediaInformation", metricId: "stateMediaControl", weight: -0.5 },
      { metricCategoryId: "governance", metricId: "governmentTransparency", weight: 0.3 },
    ],
    positions: dailCommitteePositions("Media"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "ie_media_press",
        [
          { name: "Press Freedom Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Media Plurality Act", stance: "left", effectDirection: 1 },
          { name: "Defamation Reform Act", stance: "left", effectDirection: 1 },
          { name: "Media Standards Act", stance: "center", effectDirection: 0 },
          { name: "Broadcast Standards Enforcement Act", stance: "right", effectDirection: -1 },
          { name: "Media Accountability Act", stance: "right", effectDirection: -1 },
          { name: "State Broadcasting Oversight Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Constitutional-strength press protections, abolish criminal defamation, and shield journalistic sources absolutely",
          "Break up media concentration, fund independent local journalism, and strengthen public broadcaster editorial independence",
          "Reform defamation law to end strategic lawsuits against reporting and cap awards",
          "Maintain the press council framework with balanced regulation and a stable broadcaster licence settlement",
          "Tighten broadcast moderation standards with enforceable sanctions on outlets",
          "Expand regulatory oversight of editorial standards and online publication",
          "Place state-appointed oversight boards across broadcasting with content compliance powers",
        ][i],
      })),
      [3, 2, 2, 1, 1, 1, 1]
    ),
    source: "seed",
    isPermanent: true,
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  Default spending calibration (added 2026-06-03, fix/default-laws)
// ────────────────────────────────────────────────────────────────────────────
//  Attach `budgetCategory` + per-capita costs to IE spending programs so the
//  national budget seeds a full set of expenditure lines (mirrors how US/UK/JP
//  seed default spending). Without this, IE generated no spending laws and its
//  budget showed 0 expenditure.
//
//  Index 3 (the seeded default per COUNTRY_POLICY_CONFIGS.ie) anchors each
//  baseline; the curve grades costs toward the higher-spending option
//  (EXPANSION = bigger government at the left/idx-0 end; HAWKISH = at the
//  right/idx-6 end, used for defence/security where "more" sits right).
//  Baselines are EUR per capita; their Σ(baseline × population) per category is
//  reconciled into NATIONAL_BUDGET_SEED_CONFIGS.IE.baselineSpendingByCategory.
//
//  Regulatory / rule-only types (minimum wage, electoral reform, ethics,
//  neutrality, gender equality, immigration rules, drug/curriculum policy) are
//  intentionally omitted — no standing expenditure line, matching US/UK.
// ════════════════════════════════════════════════════════════════════════════
const IE_EXPANSION_CURVE = [1.6, 1.35, 1.15, 1.0, 0.8, 0.6, 0.4];
const IE_HAWKISH_CURVE = [0.4, 0.6, 0.8, 1.0, 1.15, 1.35, 1.6];

const IE_SPENDING_CALIBRATION: Record<
  string,
  { category: string; baseline: number; curve: number[] }
> = {
  // ── Health ────────────────────────────────────────────────────────────────
  ie_healthcare_policy: { category: "health", baseline: 3530, curve: IE_EXPANSION_CURVE },
  ie_public_health: { category: "health", baseline: 390, curve: IE_EXPANSION_CURVE },
  ie_mental_health: { category: "health", baseline: 255, curve: IE_EXPANSION_CURVE },
  ie_elder_care: { category: "health", baseline: 627, curve: IE_EXPANSION_CURVE },
  // ── Education ─────────────────────────────────────────────────────────────
  ie_education_funding: { category: "education", baseline: 1470, curve: IE_EXPANSION_CURVE },
  ie_higher_education: { category: "education", baseline: 390, curve: IE_EXPANSION_CURVE },
  ie_research_science: { category: "education", baseline: 176, curve: IE_EXPANSION_CURVE },
  ie_workforce_development: { category: "education", baseline: 118, curve: IE_EXPANSION_CURVE },
  // ── Social Protection ─────────────────────────────────────────────────────
  ie_state_pensions: { category: "socialProtection", baseline: 1765, curve: IE_EXPANSION_CURVE },
  ie_unemployment_benefits: {
    category: "socialProtection",
    baseline: 882,
    curve: IE_EXPANSION_CURVE,
  },
  ie_working_family_payment: {
    category: "socialProtection",
    baseline: 78,
    curve: IE_EXPANSION_CURVE,
  },
  ie_parental_leave: { category: "socialProtection", baseline: 196, curve: IE_EXPANSION_CURVE },
  ie_childcare_policy: { category: "socialProtection", baseline: 196, curve: IE_EXPANSION_CURVE },
  // ── Housing ───────────────────────────────────────────────────────────────
  ie_housing_policy: { category: "housing", baseline: 1373, curve: IE_EXPANSION_CURVE },
  // ── Transport & Climate ───────────────────────────────────────────────────
  ie_transport_rail: { category: "transport", baseline: 490, curve: IE_EXPANSION_CURVE },
  ie_digital_infrastructure: { category: "transport", baseline: 118, curve: IE_EXPANSION_CURVE },
  ie_climate_policy: { category: "transport", baseline: 294, curve: IE_EXPANSION_CURVE },
  ie_renewable_energy_target: { category: "transport", baseline: 157, curve: IE_EXPANSION_CURVE },
  ie_peat_bog_policy: { category: "transport", baseline: 59, curve: IE_EXPANSION_CURVE },
  // ── Defence ───────────────────────────────────────────────────────────────
  ie_defence_spending: { category: "defense", baseline: 235, curve: IE_HAWKISH_CURVE },
  ie_cybersecurity: { category: "defense", baseline: 20, curve: IE_HAWKISH_CURVE },
  // ── Other departmental ────────────────────────────────────────────────────
  ie_sme_support: { category: "other", baseline: 294, curve: IE_EXPANSION_CURVE },
  ie_fiscal_stimulus: { category: "other", baseline: 196, curve: IE_EXPANSION_CURVE },
  ie_regional_economic_development: { category: "other", baseline: 196, curve: IE_EXPANSION_CURVE },
  ie_agricultural_subsidies: { category: "other", baseline: 392, curve: IE_EXPANSION_CURVE },
  ie_food_security: { category: "other", baseline: 59, curve: IE_EXPANSION_CURVE },
  ie_rural_development: { category: "other", baseline: 196, curve: IE_EXPANSION_CURVE },
  ie_foreign_aid_diplomacy: { category: "other", baseline: 451, curve: IE_EXPANSION_CURVE },
  ie_garda_policing: { category: "other", baseline: 431, curve: IE_HAWKISH_CURVE },
  ie_criminal_justice: { category: "other", baseline: 98, curve: IE_HAWKISH_CURVE },
};

const ieCalibratedIds = new Set<string>();
for (const lt of ieLegislationTypes) {
  const cal = IE_SPENDING_CALIBRATION[lt._id];
  if (!cal) continue;
  const options = lt.policyOptions ?? [];
  if (options.length !== cal.curve.length) {
    throw new Error(
      `IE spending calibration for ${lt._id}: expected ${cal.curve.length} options, got ${options.length}`
    );
  }
  lt.budgetCategory = cal.category;
  lt.policyOptions = withPerCapitaCosts(
    options,
    cal.curve.map((m) => Math.round(cal.baseline * m))
  );
  ieCalibratedIds.add(lt._id);
}
// Guard against a mistyped calibration key silently under-seeding spending.
const ieUnmatched = Object.keys(IE_SPENDING_CALIBRATION).filter((id) => !ieCalibratedIds.has(id));
if (ieUnmatched.length > 0) {
  throw new Error(`IE spending calibration references unknown type ids: ${ieUnmatched.join(", ")}`);
}
