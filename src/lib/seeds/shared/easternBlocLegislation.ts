import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import { policyOptions, taxRateOptions } from "../reference/policyOptionHelpers";

type CountryScope = NonNullable<LegislationType["countryScope"]>;
type ChamberKey = LegislationType["positions"][number]["chamber"];

/**
 * Shared dual-scenario legislation generator for the Warsaw-Pact one-party states
 * (HU/PL/RO/YU/BG/BY/CS/BAL). Each lever spans keeping the socialist planned
 * economy / one-party state (the left/default ends) vs reform → market +
 * multiparty democracy (the right ends, pairing with collapseTargetSystem).
 *
 * economic axis: -5 plan/state … +5 market. social axis: -5 secular/liberal …
 * +5 traditional. effectTargetsWeighted is signed relative to LEFT (+1) so the
 * reform (right) options carry the natural-metric upside (passes policySymmetry).
 *
 * Country-specific historical flavour is supplied via `opts` (the ruling party,
 * the reform-programme name, etc.); the structural set is identical so the budget
 * `taxPolicyIds` and the engine behave consistently across the bloc.
 */
export interface EasternBlocLegislationOpts {
  /** Legislation id prefix, e.g. "hu" → "hu_enterprise_levy". */
  prefix: string;
  /** countryScope union value, e.g. "hu". */
  scope: CountryScope;
  /** Lower-chamber key for committee positions, e.g. "nationalAssembly". */
  chamberKey: ChamberKey;
  /** Ruling party flavour for the political-system lever, e.g. "the MSZMP". */
  rulingParty: string;
  /** Reform-programme flavour for the economic-system lever, e.g. "the New Economic Mechanism". */
  reformProgramme: string;
  /** Standard (default) tax rates. */
  rates?: {
    enterprise?: number;
    income?: number;
    product?: number;
    social?: number;
  };
}

export function makeEasternBlocLegislation(opts: EasternBlocLegislationOpts): LegislationType[] {
  const { prefix, scope, chamberKey, rulingParty, reformProgramme } = opts;
  const r = { enterprise: 55, income: 12, product: 16, social: 20, ...(opts.rates ?? {}) };
  const pos = (label: string): LegislationType["positions"] => [
    { positionId: `${prefix}_chair`, name: `Chair, Committee on ${label}`, chamber: chamberKey },
    {
      positionId: `${prefix}_vice`,
      name: `Vice-Chair, Committee on ${label}`,
      chamber: chamberKey,
    },
  ];

  return [
    {
      _id: `${prefix}_enterprise_levy`,
      countryScope: scope,
      name: "Enterprise Surplus Remittance Statute",
      description: "Sets how state-enterprise surplus is taxed or remitted",
      explanation:
        "How the state extracts the surplus of the socialist enterprises — from total remittance under the plan to a light corporate tax under market reform.",
      policyDomain: "tax",
      subCategory: "Enterprise",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: 0.4 },
      ],
      positions: pos("Planning"),
      taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
      policyOptions: taxRateOptions(`${prefix}_enterprise_levy`, [
        {
          rate: 0,
          name: "Full Privatization Act",
          description: "Sell enterprises; no state surplus claim",
          stance: "right",
          economic: 5,
          social: 0,
        },
        {
          rate: 15,
          name: "Market Corporate Tax",
          description: "A light corporate tax on privatised firms",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          rate: 30,
          name: "Mixed Enterprise Levy",
          description: "Partial autonomy with a profit levy",
          stance: "right",
          economic: 1,
          social: 0,
        },
        {
          rate: r.enterprise,
          name: "Enterprise Surplus Remittance Statute",
          description: "The plan remits enterprise surplus to the state",
          stance: "left",
          economic: -3,
          social: 0,
        },
        {
          rate: 70,
          name: "Total Surplus Remittance",
          description: "Full central appropriation of enterprise surplus",
          stance: "left",
          economic: -5,
          social: 0,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_income_tax`,
      countryScope: scope,
      name: "Citizens' Income Tax Statute",
      description: "Sets the personal income tax rate",
      explanation:
        "Wage taxation, low and flat under the plan; a lever toward relief or redistribution.",
      policyDomain: "tax",
      subCategory: "Personal taxation",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "medianIncome", weight: 1.0 },
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      ],
      positions: pos("Finance"),
      taxRateChange: { scope: "federal", taxType: "incomeTax" },
      policyOptions: taxRateOptions(`${prefix}_income_tax`, [
        {
          rate: 0,
          name: "Abolish Income Tax Act",
          description: "Eliminate the wage tax",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          rate: r.income,
          name: "Citizens' Income Tax Statute",
          description: "The low flat wage tax",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          rate: 30,
          name: "Progressive Income Tax Act",
          description: "A progressive schedule",
          stance: "left",
          economic: -2,
          social: 0,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_product_tax`,
      countryScope: scope,
      name: "Product Tax Schedule",
      description: "Sets the indirect product/turnover tax",
      explanation: "The turnover tax embedded in administered prices.",
      policyDomain: "tax",
      subCategory: "Consumption taxation",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.6 },
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
      ],
      positions: pos("Finance"),
      taxRateChange: { scope: "federal", taxType: "salesTax" },
      policyOptions: taxRateOptions(`${prefix}_product_tax`, [
        {
          rate: 0,
          name: "Abolish Product Tax Act",
          description: "Eliminate the turnover tax",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          rate: 8,
          name: "Market VAT",
          description: "A market-style consumption tax",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          rate: r.product,
          name: "Product Tax Schedule",
          description: "The plan's turnover tax",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          rate: 26,
          name: "Maximal Turnover Tax",
          description: "High turnover extraction for the budget",
          stance: "left",
          economic: -2,
          social: 0,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_social_insurance`,
      countryScope: scope,
      name: "Unified Social Insurance Statute",
      description: "Sets social-insurance contributions",
      explanation: "The trade-union-administered unified social insurance.",
      policyDomain: "tax",
      subCategory: "Social contributions",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "social", metricId: "socialMobility", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.6 },
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.4 },
      ],
      positions: pos("Labour"),
      taxRateChange: { scope: "federal", taxType: "payrollTax" },
      policyOptions: taxRateOptions(`${prefix}_social_insurance`, [
        {
          rate: 10,
          name: "Private Insurance Act",
          description: "Shift to private/market insurance",
          stance: "right",
          economic: 3,
          social: 0,
        },
        {
          rate: r.social,
          name: "Unified Social Insurance Statute",
          description: "The standard unified contribution",
          stance: "center",
          economic: 0,
          social: 0,
        },
        {
          rate: 32,
          name: "Expanded Social Insurance Act",
          description: "Raise contributions to expand benefits",
          stance: "left",
          economic: -2,
          social: 0,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_foreign_trade`,
      countryScope: scope,
      name: "Foreign Trade Monopoly Statute",
      description: "Sets the state monopoly over foreign trade",
      explanation:
        "The state foreign-trade monopoly vs opening to Western trade and convertibility.",
      policyDomain: "tax",
      subCategory: "Trade",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "tradeBalance", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.7 },
        { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.3 },
      ],
      positions: pos("Trade"),
      taxRateChange: { scope: "federal", taxType: "tariffs" },
      policyOptions: taxRateOptions(`${prefix}_foreign_trade`, [
        {
          rate: 0,
          name: "Open Trade Act",
          description: "Abolish the monopoly; open to Western trade",
          stance: "right",
          economic: 4,
          social: 0,
        },
        {
          rate: 10,
          name: "Managed Opening",
          description: "Selective trade liberalisation",
          stance: "right",
          economic: 2,
          social: 0,
        },
        {
          rate: 25,
          name: "Foreign Trade Monopoly Statute",
          description: "The state monopoly over all foreign trade",
          stance: "left",
          economic: -3,
          social: 0,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_economic_system`,
      countryScope: scope,
      name: "Economic Order Law",
      description: "Sets central planning vs market reform",
      explanation: `The core choice: the socialist planned economy vs market reform and privatisation (${reformProgramme}).`,
      policyDomain: "economic",
      subCategory: "System",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.9 },
        { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.6 },
      ],
      positions: pos("Planning"),
      policyOptions: policyOptions(
        `${prefix}_economic_system`,
        [
          {
            name: "Market Economy",
            explanation: "Full transition to a market economy",
            stance: "right",
            economic: 5,
            social: 0,
          },
          {
            name: "Market Transition",
            explanation: "Privatise and free prices",
            stance: "right",
            economic: 3,
            social: 0,
          },
          {
            name: `Reform Socialism (${reformProgramme})`,
            explanation: "Enterprise autonomy within a reformed plan",
            stance: "right",
            economic: 1,
            social: 0,
          },
          {
            name: "Economic Order Law",
            explanation: "Orthodox central planning",
            stance: "left",
            economic: -4,
            social: 0,
          },
          {
            name: "Total Centralisation",
            explanation: "Maximal central control of the economy",
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
    {
      _id: `${prefix}_political_system`,
      countryScope: scope,
      name: "Leading Role Statute",
      description: "Sets the ruling party's monopoly vs multiparty democracy",
      explanation: `${rulingParty}'s constitutionally-enshrined leading role vs free multiparty elections and democratisation.`,
      policyDomain: "governance",
      subCategory: "System",
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
      positions: pos("Constitution"),
      policyOptions: policyOptions(
        `${prefix}_political_system`,
        [
          {
            name: "Free Multiparty Elections",
            explanation: "Full democratisation with contested elections",
            stance: "left",
            economic: 0,
            social: -5,
          },
          {
            name: "Multiparty Democracy",
            explanation: "Legalise opposition parties",
            stance: "left",
            economic: 0,
            social: -3,
          },
          {
            name: "Limited Pluralism",
            explanation: "Give the bloc parties real autonomy",
            stance: "left",
            economic: 0,
            social: -1,
          },
          {
            name: "Leading Role Statute",
            explanation: `${rulingParty}'s constitutional monopoly`,
            stance: "right",
            economic: 0,
            social: 3,
          },
          {
            name: "Vanguard Dictatorship",
            explanation: "Tighten the party's grip on all institutions",
            stance: "right",
            economic: 0,
            social: 4,
          },
        ],
        "social"
      ),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_price_controls`,
      countryScope: scope,
      name: "Price Regulation Statute",
      description: "Sets administered prices vs free pricing",
      explanation: "Subsidised, fixed prices for food, rent and transport vs market pricing.",
      policyDomain: "economic",
      subCategory: "Prices",
      nationalOnly: true,
      effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.7 },
        { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.3 },
      ],
      positions: pos("Prices"),
      policyOptions: policyOptions(
        `${prefix}_price_controls`,
        [
          {
            name: "Full Price Liberalisation",
            explanation: "Free all prices to the market",
            stance: "right",
            economic: 4,
            social: 0,
          },
          {
            name: "Partial Decontrol",
            explanation: "Free non-essential prices",
            stance: "right",
            economic: 2,
            social: 0,
          },
          {
            name: "Price Regulation Statute",
            explanation: "Administered, subsidised prices",
            stance: "left",
            economic: -2,
            social: 0,
          },
          {
            name: "Frozen Prices & Rationing",
            explanation: "Hard price freeze with allocation",
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
  ];
}

/** Standard COUNTRY_POLICY_CONFIGS defaults/optionIndexes for an Eastern-bloc set. */
export function easternBlocPolicyConfig(prefix: string) {
  return {
    defaults: {
      [`${prefix}_enterprise_levy`]: { economic: -3, social: 0 },
      [`${prefix}_income_tax`]: { economic: 0, social: 0 },
      [`${prefix}_product_tax`]: { economic: 0, social: 0 },
      [`${prefix}_social_insurance`]: { economic: 0, social: 0 },
      [`${prefix}_foreign_trade`]: { economic: -3, social: 0 },
      [`${prefix}_economic_system`]: { economic: -4, social: 0 },
      [`${prefix}_political_system`]: { economic: 0, social: 3 },
      [`${prefix}_price_controls`]: { economic: -3, social: 0 },
    },
    optionIndexes: {
      [`${prefix}_enterprise_levy`]: 3, // Enterprise Surplus Remittance Statute
      [`${prefix}_income_tax`]: 1, // Citizens' Income Tax Statute
      [`${prefix}_product_tax`]: 2, // Product Tax Schedule
      [`${prefix}_social_insurance`]: 1, // Unified Social Insurance Statute
      [`${prefix}_foreign_trade`]: 2, // Foreign Trade Monopoly Statute
      [`${prefix}_economic_system`]: 3, // Economic Order Law (orthodox plan)
      [`${prefix}_political_system`]: 3, // Leading Role Statute
      [`${prefix}_price_controls`]: 2, // Price Regulation Statute
    },
    taxPolicyIds: {
      incomeTax: `${prefix}_income_tax`,
      domesticCorporateTax: `${prefix}_enterprise_levy`,
      payrollTax: `${prefix}_social_insurance`,
      tariffs: `${prefix}_foreign_trade`,
      salesTax: `${prefix}_product_tax`,
    },
  };
}

/**
 * Per-lever option index overrides for a country's 1953 position. Anything left
 * unset takes the Stalinist default below.
 */
export interface EasternBlocPolicy1953Overrides {
  enterpriseLevy?: number;
  incomeTax?: number;
  productTax?: number;
  socialInsurance?: number;
  foreignTrade?: number;
  economicSystem?: number;
  politicalSystem?: number;
  priceControls?: number;
}

/**
 * 1953 (high-Stalinist) variant of {@link easternBlocPolicyConfig}.
 *
 * SEED INDEPENDENCE — authored for 1953, not scaled from the 1979 table.
 *
 * The shared config above encodes the *settled* bloc of the Brezhnev years:
 * orthodox planning, the leading role, administered prices. 1953 sits one notch
 * harder on almost every lever — total surplus remittance rather than the
 * standing levy, maximal turnover tax, total centralisation rather than the
 * ordinary plan, vanguard dictatorship rather than the constitutional leading
 * role, and frozen prices with rationing rather than ordinary price regulation.
 *
 * The two tax levers that do NOT move are deliberate: personal income tax stayed
 * trivial (the state set wages directly, so taxing them back was pointless) and
 * the foreign-trade monopoly was already absolute in the 1979 table — there is
 * no harder option to select.
 *
 * `overrides` exists because the bloc was not uniform in 1953. Yugoslavia had
 * been outside it since the 1948 split and is the large exception; see the
 * per-country entries in basePolicies1953.
 */
export function easternBlocPolicyConfig1953(
  prefix: string,
  overrides: EasternBlocPolicy1953Overrides = {}
) {
  const idx = {
    enterpriseLevy: 4, // Total Surplus Remittance
    incomeTax: 1, // Citizens' Income Tax Statute (unchanged — wages set directly)
    productTax: 3, // Maximal Turnover Tax
    socialInsurance: 1, // Unified Social Insurance Statute
    foreignTrade: 2, // Foreign Trade Monopoly Statute (already maximal)
    economicSystem: 4, // Total Centralisation
    politicalSystem: 4, // Vanguard Dictatorship
    priceControls: 3, // Frozen Prices & Rationing
    ...overrides,
  };
  // Economic lean tracks how far each lever sits from the market end.
  const planLean = (i: number, maxIdx: number) => Math.round(-5 + (5 * (maxIdx - i)) / maxIdx) + 1;
  return {
    defaults: {
      [`${prefix}_enterprise_levy`]: { economic: planLean(idx.enterpriseLevy, 4), social: 0 },
      [`${prefix}_income_tax`]: { economic: 0, social: 0 },
      [`${prefix}_product_tax`]: { economic: 0, social: 0 },
      [`${prefix}_social_insurance`]: { economic: 0, social: 0 },
      [`${prefix}_foreign_trade`]: { economic: -3, social: 0 },
      [`${prefix}_economic_system`]: { economic: idx.economicSystem >= 4 ? -5 : -4, social: 0 },
      [`${prefix}_political_system`]: { economic: 0, social: idx.politicalSystem >= 4 ? 4 : 3 },
      [`${prefix}_price_controls`]: { economic: idx.priceControls >= 3 ? -4 : -3, social: 0 },
    },
    optionIndexes: {
      [`${prefix}_enterprise_levy`]: idx.enterpriseLevy,
      [`${prefix}_income_tax`]: idx.incomeTax,
      [`${prefix}_product_tax`]: idx.productTax,
      [`${prefix}_social_insurance`]: idx.socialInsurance,
      [`${prefix}_foreign_trade`]: idx.foreignTrade,
      [`${prefix}_economic_system`]: idx.economicSystem,
      [`${prefix}_political_system`]: idx.politicalSystem,
      [`${prefix}_price_controls`]: idx.priceControls,
    },
    taxPolicyIds: {
      incomeTax: `${prefix}_income_tax`,
      domesticCorporateTax: `${prefix}_enterprise_levy`,
      payrollTax: `${prefix}_social_insurance`,
      tariffs: `${prefix}_foreign_trade`,
      salesTax: `${prefix}_product_tax`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spending-side legislation (ticket: "the Warsaw-Pact six spend nothing").
//
// PROBLEM. The 8 levers above are all revenue/system levers — none of them ever
// carries a budgetCategory or a cost. Because `calculateFederalSpending`
// (src/lib/budget/spending.ts) only falls back to the static
// `baselineSpendingByCategory` when NO enacted law books ANY cost, and the
// fallback is all-or-nothing, these six countries' spending has been a frozen
// dollar constant for the whole game — invisible to any policy choice, and
// (since revenue tracks GDP growth while spending does not) their debt/GDP
// ratchets monotonically over a long game.
//
// FIX. `makeEasternBlocSpendingLegislation` mints one spending LegislationType
// per authored baseline category (see `makeEasternBlocBudget1953`'s
// `baselineSpendingByCategory`: defense 7%, socialSecurity 8%, healthcare 4%,
// education 5%, infrastructure 18%, other 7% of GDP, plus a `stateGrants`-
// routed grant law at 5% GDP — ~54% GDP total, matching the factory's own
// "~52% GDP revenue against ~54% authored spend" comment). Each type carries a
// 5-option austerity↔expansion ladder (index 0 = most-market/least-spend,
// index 4 = most-state/most-spend, matching the existing 8 levers' own
// right-first ordering) with the CENTER option (index 2, economic score 0)
// landing exactly on the authored 1953 share — so a fresh seed's default
// enactment (which falls back to the closest-to-(0,0) option whenever a
// country config does not explicitly override it — see
// `easternBlocSpendingPolicyConfig1953` below, which pins it explicitly)
// reproduces the authored baseline to the cent, while choosing a different
// option genuinely moves the booked cost.
//
// Cost class: gdpFraction (era-aware runtime path — see
// legislationCostCatalog.ts). Every option ALSO carries the legacy
// `annualCostPerCapita` field (= fraction × gdp ÷ population, computed from
// the SAME per-country gdp/population passed to `makeEasternBlocBudget1953`),
// because `deriveEnactedLaws`/`deriveSpending` in budgets.ts (seed-generation
// time) call `calculatePolicyOptionAnnualCost` WITHOUT a `year` in context, so
// the era-aware branch is inert there and the legacy per-capita field is what
// actually prices the seed. None of these six countries has a
// `COST_SCALE_ANCHORS` entry, so the legacy scale is 1 — the per-capita figure
// prices exactly the same %GDP the era-aware runtime path would.
//
// Sourcing (order-of-magnitude, not exact-to-the-percent — the real archives
// are not public to that precision): Fiat/Kaser-style estimates of Stalinist
// five-year-plan investment put capital formation at roughly a fifth of net
// material product in the early 1950s satellites, heaviest in Poland/
// Czechoslovakia's forced heavy-industry drives (Montias, "Central Planning in
// Poland"); trade-union-administered social insurance (pensions, disability,
// family allowances) ran a high-single-digit share (Holzman, "Soviet
// Taxation"); satellite defense burdens sat below the USSR's own (~20% NMP,
// per the CIA Bergson estimate already cited in `makeEasternBlocBudget1953`)
// but above peacetime Western norms, consistent with the ~7% used here;
// health/education were in the middle of their 1950s expansion drives. These
// are the SAME order-of-magnitude figures already authored into
// `makeEasternBlocBudget1953` — this factory does not re-derive them, it only
// gives them a law to attach to.
export interface EasternBlocSpendingOpts {
  /** Legislation id prefix, e.g. "hu" → "hu_infrastructure_investment". */
  prefix: string;
  /** countryScope union value, e.g. "hu". */
  scope: CountryScope;
  /** Lower-chamber key for committee positions, e.g. "nationalAssembly". */
  chamberKey: ChamberKey;
  /** 1953 national GDP, local currency — MUST match the country's
   *  `makeEasternBlocBudget1953` call in budgets.ts (guarded by a test). */
  gdp: number;
  /** 1953 national population — MUST match the country's
   *  `makeEasternBlocBudget1953` call in budgets.ts (guarded by a test). */
  population: number;
  /** The country's active investment-plan name, e.g. "the Six-Year Plan (1950-55)". */
  planName: string;
  /**
   * Yugoslavia only: frame investment/grants as administered through workers'
   * self-management councils rather than a central ministry — the 1950 Basic
   * Law on workers' self-management had already handed enterprises to workers'
   * councils by 1953 (see easternBlocPolicyConfig1953's YU override comment).
   */
  selfManagement?: boolean;
}

interface SpendingLadderStep {
  /** Share of GDP this option books (gdpCostFraction === annualCostPerCapita × population ÷ gdp). */
  fraction: number;
  name: string;
  explanation: string;
  stance: "left" | "center" | "right";
  economic: number;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Build a 5-option austerity(right)->expansion(left) ladder with gdpFraction costs. */
function spendingLadder(
  typeId: string,
  gdp: number,
  population: number,
  steps: SpendingLadderStep[]
): LegislationPolicyOption[] {
  const built = policyOptions(
    typeId,
    steps.map((s) => ({
      name: s.name,
      explanation: s.explanation,
      stance: s.stance,
      economic: s.economic,
      social: 0,
    })),
    "economic"
  );
  return built.map((o, i) => {
    const fraction = steps[i]!.fraction;
    return {
      ...o,
      gdpCostFraction: round5(fraction),
      annualCostPerCapita: population > 0 ? Math.round((fraction * gdp) / population) : 0,
    };
  });
}

export function makeEasternBlocSpendingLegislation(
  opts: EasternBlocSpendingOpts
): LegislationType[] {
  const { prefix, scope, chamberKey, gdp, population, planName, selfManagement } = opts;

  const posSpending = (label: string): LegislationType["positions"] => [
    {
      positionId: `${prefix}_spend_chair`,
      name: `Chair, Committee on ${label}`,
      chamber: chamberKey,
    },
    {
      positionId: `${prefix}_spend_vice`,
      name: `Vice-Chair, Committee on ${label}`,
      chamber: chamberKey,
    },
  ];

  const econFreedom = { metricCategoryId: "economic" as const, metricId: "economicFreedom" };

  const grantAdmin = selfManagement
    ? "channelled through republican and communal self-management bodies rather than a central ministry"
    : "administered through the central ministries and regional national councils";

  return [
    {
      _id: `${prefix}_infrastructure_investment`,
      countryScope: scope,
      name: "State Investment Plan Statute",
      description:
        "Sets the scale of state capital investment in heavy industry and infrastructure",
      explanation: `Funds ${planName} — capital investment in heavy industry, power, rail, and construction${selfManagement ? ", channelled through the workers' self-management councils rather than a central ministry" : ""}. Investment builds capacity and prestige projects but competes with consumer goods and widens the deficit.`,
      policyDomain: "infrastructure",
      subCategory: "Capital investment",
      nationalOnly: true,
      budgetCategory: "infrastructure",
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.6 },
        { metricCategoryId: "economic", metricId: "tradeBalance", weight: 0.3 },
        { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.2 },
        { ...econFreedom, weight: -0.15 },
      ],
      positions: posSpending("Planning"),
      policyOptions: spendingLadder(`${prefix}_infrastructure_investment`, gdp, population, [
        {
          fraction: 0.09,
          name: "Investment Freeze Act",
          explanation: "Halt new capital projects; divert funds to consumer goods",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.13,
          name: "Investment Retrenchment Act",
          explanation: "Scale back the plan's capital-investment projects",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.18,
          name: "State Investment Plan Statute",
          explanation: `${planName}'s authored capital-investment envelope`,
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.22,
          name: "Accelerated Plan Act",
          explanation: "Expand the plan's capital-investment targets",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.26,
          name: "Forced Industrialisation Act",
          explanation: "Maximal forced-pace industrialisation investment",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_social_security_fund`,
      countryScope: scope,
      name: "State Pension and Disability Fund Statute",
      description: "Sets the generosity of state pensions, disability, and family allowances",
      explanation:
        "Funds old-age pensions, disability benefits, and family allowances administered through the trade-union social-insurance apparatus. Generosity protects workers and pensioners but strains the budget.",
      policyDomain: "social",
      subCategory: "Pensions and family allowances",
      nationalOnly: true,
      budgetCategory: "socialSecurity",
      // §4.7 (socialSpendingSweep.test.ts): a socialSecurity-budget funding law
      // must NOT target the income/poverty cluster directly (povertyRate,
      // socialMobility, etc.) — the engine's social-spending channel already
      // drives those readouts from `spending.byCategory.socialSecurity` itself.
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
        { ...econFreedom, weight: -0.15 },
      ],
      positions: posSpending("Labour"),
      policyOptions: spendingLadder(`${prefix}_social_security_fund`, gdp, population, [
        {
          fraction: 0.04,
          name: "Contribution Freeze Act",
          explanation: "Freeze pension and disability benefit levels",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.06,
          name: "Benefit Retrenchment Act",
          explanation: "Trim pension and family-allowance schedules",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.08,
          name: "State Pension and Disability Fund Statute",
          explanation: "The authored trade-union benefit schedule",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.1,
          name: "Benefit Expansion Act",
          explanation: "Raise pensions and family allowances",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.12,
          name: "Universal Social Provision Act",
          explanation: "Maximal cradle-to-grave benefit provision",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_defense_appropriations`,
      countryScope: scope,
      name: "National Defence Appropriations Act",
      description: "Sets the level of military and internal-security spending",
      explanation:
        "Funds the standing army, air defence, and internal-security apparatus. Higher spending builds capability against external threat and internal unrest but draws from the civilian plan.",
      policyDomain: "defense",
      subCategory: "Military and internal security",
      nationalOnly: true,
      budgetCategory: "defense",
      effectTarget: {
        metricCategoryId: "publicSafety",
        metricId: "publicSafetyConfidence",
        scope: "national",
      },
      effectTargetsWeighted: [
        { metricCategoryId: "publicSafety", metricId: "publicSafetyConfidence", weight: 0.5 },
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "publicSafety", metricId: "violentCrimeRate", weight: -0.2 },
        { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.1 },
      ],
      positions: posSpending("Defence"),
      policyOptions: spendingLadder(`${prefix}_defense_appropriations`, gdp, population, [
        {
          fraction: 0.03,
          name: "Demobilisation Act",
          explanation: "Cut the standing forces to a cadre",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.05,
          name: "Force Reduction Act",
          explanation: "Trim the standing forces",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.07,
          name: "National Defence Appropriations Act",
          explanation: "The authored force level and equipment programme",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.09,
          name: "Force Buildup Act",
          explanation: "Expand the standing forces and re-equip",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.11,
          name: "Total Militarisation Act",
          explanation: "Maximal war-footing mobilisation",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_public_health_service`,
      countryScope: scope,
      name: "Public Health Service Statute",
      description: "Sets funding for the state clinic and hospital network",
      explanation:
        "Funds the free state polyclinic and hospital network. Expansion improves health outcomes and legitimises the regime but strains the budget.",
      policyDomain: "healthcare",
      subCategory: "Public health service",
      nationalOnly: true,
      budgetCategory: "healthcare",
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.4 },
        { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
        { ...econFreedom, weight: -0.15 },
      ],
      positions: posSpending("Health"),
      policyOptions: spendingLadder(`${prefix}_public_health_service`, gdp, population, [
        {
          fraction: 0.02,
          name: "Clinic Consolidation Act",
          explanation: "Consolidate clinics and cut the health budget",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.03,
          name: "Health Budget Retrenchment Act",
          explanation: "Trim the polyclinic and hospital budget",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.04,
          name: "Public Health Service Statute",
          explanation: "The authored free polyclinic and hospital network",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.05,
          name: "Health Network Expansion Act",
          explanation: "Expand the polyclinic and hospital network",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.06,
          name: "Universal Health Mobilisation Act",
          explanation: "Maximal health-system mobilisation",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_universal_education`,
      countryScope: scope,
      name: "Universal Education Statute",
      description: "Sets funding for compulsory schooling and literacy campaigns",
      explanation:
        "Funds compulsory polytechnic schooling and adult-literacy campaigns. Expansion builds the skilled workforce the plan needs but strains the budget.",
      policyDomain: "education",
      subCategory: "Compulsory and technical education",
      nationalOnly: true,
      budgetCategory: "education",
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.3 },
        { metricCategoryId: "economic", metricId: "laborParticipation", weight: 0.3 },
        { ...econFreedom, weight: -0.2 },
      ],
      positions: posSpending("Education"),
      policyOptions: spendingLadder(`${prefix}_universal_education`, gdp, population, [
        {
          fraction: 0.025,
          name: "School Budget Retrenchment Act",
          explanation: "Cut the schooling and literacy-campaign budget",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.035,
          name: "Enrollment Ceiling Act",
          explanation: "Cap enrollment growth and trim the schooling budget",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.05,
          name: "Universal Education Statute",
          explanation: "The authored compulsory-schooling and literacy-campaign budget",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.065,
          name: "Literacy Campaign Expansion Act",
          explanation: "Expand schooling and the adult-literacy campaign",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.08,
          name: "Total Educational Mobilisation Act",
          explanation: "Maximal schooling and literacy mobilisation",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_state_administration`,
      countryScope: scope,
      name: "State Administration and Culture Budget Statute",
      description:
        "Sets funding for the state and party administrative apparatus, culture, and industrial subsidies",
      explanation:
        "Funds the ministries, the cultural and propaganda apparatus, and general industrial subsidies outside the categories above. A leaner apparatus frees resources for the plan; a fuller one strengthens administrative and ideological reach.",
      policyDomain: "economic",
      subCategory: "General administration",
      nationalOnly: true,
      budgetCategory: "other",
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.2 },
        { ...econFreedom, weight: -0.2 },
      ],
      positions: posSpending("Administration"),
      policyOptions: spendingLadder(`${prefix}_state_administration`, gdp, population, [
        {
          fraction: 0.03,
          name: "Administrative Retrenchment Act",
          explanation: "Cut ministries and industrial subsidies to a minimum",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.05,
          name: "Ministries Consolidation Act",
          explanation: "Consolidate ministries and trim subsidies",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.07,
          name: "State Administration and Culture Budget Statute",
          explanation: "The authored administrative, cultural, and subsidy budget",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.09,
          name: "Apparatus Expansion Act",
          explanation: "Expand the ministries and the cultural apparatus",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.11,
          name: "Total State Apparatus Act",
          explanation: "Maximal administrative and ideological apparatus",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
    {
      _id: `${prefix}_regional_investment_grants`,
      countryScope: scope,
      name: "Regional Investment Grants Act",
      description: "Sets the scale of central grants to regional and municipal councils",
      explanation: `Central grants that fund regional and municipal councils' own investment and services, ${grantAdmin}. Larger grants strengthen local capacity; leaner ones concentrate resources centrally.`,
      policyDomain: "governance",
      subCategory: "Regional grants",
      nationalOnly: true,
      budgetCategory: "other",
      isGrant: true,
      effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
      effectTargetsWeighted: [
        { metricCategoryId: "governance", metricId: "budgetBalance", weight: -0.5 },
        { metricCategoryId: "economic", metricId: "povertyRate", weight: 0.2 },
        { ...econFreedom, weight: -0.15 },
      ],
      positions: posSpending("Regional Affairs"),
      policyOptions: spendingLadder(`${prefix}_regional_investment_grants`, gdp, population, [
        {
          fraction: 0.025,
          name: "Grant Freeze Act",
          explanation: "Freeze regional and municipal grants",
          stance: "right",
          economic: 5,
        },
        {
          fraction: 0.035,
          name: "Grant Retrenchment Act",
          explanation: "Trim regional and municipal grants",
          stance: "right",
          economic: 3,
        },
        {
          fraction: 0.05,
          name: "Regional Investment Grants Act",
          explanation: "The authored regional and municipal grant pool",
          stance: "center",
          economic: 0,
        },
        {
          fraction: 0.065,
          name: "Grant Expansion Act",
          explanation: "Expand regional and municipal grants",
          stance: "left",
          economic: -3,
        },
        {
          fraction: 0.08,
          name: "Maximal Regional Equalisation Act",
          explanation: "Maximal central-to-regional equalisation transfers",
          stance: "left",
          economic: -5,
        },
      ]),
      source: "seed",
      isPermanent: true,
    },
  ];
}

/**
 * Standard COUNTRY_POLICY_CONFIGS_1953 defaults/optionIndexes for the 7
 * spending types above. Every country pins to index 2 — the CENTER option on
 * each ladder, which is calibrated (see `spendingLadder` above) to reproduce
 * `makeEasternBlocBudget1953`'s authored per-category %GDP exactly. Unlike
 * `easternBlocPolicyConfig1953`, there is no per-country override parameter:
 * the authored baseline is IDENTICAL %GDP across all six countries (same
 * shared factory, different GDP dollar figures), so there is nothing to vary
 * here — country flavour lives in `EasternBlocSpendingOpts` (planName /
 * selfManagement) instead, not in which option is enacted by default.
 *
 * Deliberately 1953-only: the modern/1979 `COUNTRY_POLICY_CONFIGS` map is NOT
 * given a companion here. Those presets' `deriveEnactedLaws`/`deriveSpending`
 * fall back to the closest-to-(0,0) option (the same center option, since no
 * override is configured), which happens to book the same %GDP mix as 1953 —
 * a reasonable default, not pixel-tuned to the softer 1979 Brezhnev-era shares
 * (defense 5%/socialSecurity 12%/healthcare 5%/education 6%/infrastructure 18%/
 * other 8%/stateGrants 6% per `makeEasternBlocBudget` — see budgets.ts). If the
 * 1979 preset needs its own exact reconciliation later, add a
 * `easternBlocSpendingPolicyConfig` sibling then.
 */
export function easternBlocSpendingPolicyConfig1953(prefix: string) {
  const ids = [
    "infrastructure_investment",
    "social_security_fund",
    "defense_appropriations",
    "public_health_service",
    "universal_education",
    "state_administration",
    "regional_investment_grants",
  ];
  const defaults: Record<string, { economic: number; social: number }> = {};
  const optionIndexes: Record<string, number> = {};
  for (const id of ids) {
    defaults[`${prefix}_${id}`] = { economic: 0, social: 0 };
    optionIndexes[`${prefix}_${id}`] = 2;
  }
  return { defaults, optionIndexes };
}
