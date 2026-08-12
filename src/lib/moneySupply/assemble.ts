import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  calculateMoneyAggregates,
  type MoneyAggregates,
  type MoneySupplyComponents,
} from "./calculate";

/**
 * Household-sector money parameters. Households are derived from population
 * because the `characters` collection only ever holds PLAYERS — an NPP-run world
 * has none, which left every domestic money component at zero.
 *
 * Ratios are shares of gross annual household income: roughly two months' income
 * held as transaction balances (currency + demand deposits), and a bit over half
 * a year's income as time/savings deposits. Deliberately conservative — the point
 * is that the household sector exists and RESPONDS to population and income, not
 * that these are precisely calibrated to a national accounts series.
 *
 * Order-of-magnitude check (US 1953): Census median household income ≈ $3,900
 * (Census Bureau P60 series), population ≈ 158M → ~49M households → ~$193B
 * aggregate income → liquid+savings ≈ $145B, against seeded M2 ≈ $240B
 * (0.62 × $387B GDP). Households alone recover ~60% of the historical stock;
 * corporates and the unmodeled residual cover the rest.
 */
export const PERSONS_PER_HOUSEHOLD = 3.2;
export const HOUSEHOLD_LIQUID_RATIO = 0.15;
export const HOUSEHOLD_SAVINGS_RATIO = 0.6;

/**
 * Share of the seeded `externalBroadMoney` baseline kept after domestic
 * components are measured.
 *
 * The seed ratio (`broadMoneyToGdpRatio`) was calibrated as a stand-in for the
 * ENTIRE broad-money stock when every domestic component was structurally 0.
 * Once households/corps/etc. are measured, keeping the full seed on top would
 * double-count and freeze M2 (growth ≡ 0 while domestic < seed).
 *
 * ~0.25 matches the mid-century US currency-in-circulation share of M2
 * (Friedman & Schwartz, *A Monetary History of the United States*, ch. 4–5
 * stylized composition — coin+currency outside banks was roughly a fifth to a
 * quarter of broad money; the deposit rest is what the domestic components now
 * approximate). QE/QT (`netMoneyCreatedLifetime`) still passes through 1:1 so
 * central-bank operations move M2 at face value.
 */
export const UNMODELED_EXTERNAL_SHARE = 0.25;

export type MutableComponents = MoneySupplyComponents;

export function emptyComponents(): MutableComponents {
  return {
    householdLiquid: 0,
    campaignLiquid: 0,
    nppLiquid: 0,
    corporateLiquid: 0,
    partyLiquid: 0,
    governmentLiquid: 0,
    fundLiquid: 0,
    bankDeposits: 0,
    organizationLiquid: 0,
    householdSavings: 0,
    externalBroadMoney: 0,
    bankReserves: 0,
    creditOutstanding: 0,
    sovereignBondsOutstanding: 0,
    centralBankBondHoldings: 0,
  };
}

export function homeCurrency(countryId: CountryId): CurrencyCode {
  return COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
}

export function addComponent(
  byCurrency: Map<CurrencyCode, MutableComponents>,
  currency: CurrencyCode,
  key: keyof MutableComponents,
  value: unknown
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
  const row = byCurrency.get(currency) ?? emptyComponents();
  row[key] += value;
  byCurrency.set(currency, row);
}

/**
 * Government "cash" for money-supply purposes.
 *
 * `federalBudget.treasuryBalance` is the signed fiscal SSOT: positive = surplus
 * cash on hand, negative = −debt.principal by design (see budgets.ts seed and
 * `nationalDebtFromBalance`). Taking `abs(treasuryBalance)` would invent
 * government deposits equal to the national debt — a false positive the
 * postmortem warns about. Only a positive balance is spendable money; an
 * indebted treasury contributes 0 to M1.
 */
export function governmentLiquidFromTreasury(treasuryBalance: unknown): number {
  if (typeof treasuryBalance !== "number" || !Number.isFinite(treasuryBalance)) return 0;
  return Math.max(0, treasuryBalance);
}

/**
 * Residual unmodeled broad money after domestic components carry real mass.
 * Baseline (seed − lifetime QE/QT) is scaled by {@link UNMODELED_EXTERNAL_SHARE};
 * net issuance from CB operations passes through at face value.
 */
export function effectiveExternalBroadMoney(
  externalBroadMoney: unknown,
  netMoneyCreatedLifetime: unknown = 0
): number {
  const external =
    typeof externalBroadMoney === "number" && Number.isFinite(externalBroadMoney)
      ? externalBroadMoney
      : 0;
  const qeNet =
    typeof netMoneyCreatedLifetime === "number" && Number.isFinite(netMoneyCreatedLifetime)
      ? netMoneyCreatedLifetime
      : 0;
  const baseline = external - qeNet;
  const residualBaseline = Math.max(0, baseline) * UNMODELED_EXTERNAL_SHARE;
  return Math.max(0, residualBaseline + qeNet);
}

export interface DemographicState {
  _id: string;
  countryId?: string;
  population?: number;
}

export interface MedianIncomeDoc {
  _id: string;
  economic?: { medianIncome?: { value?: number } };
}

/**
 * Derive household liquid + savings from population × median income.
 * Prefers per-state income; falls back to the country's national-scope doc so
 * countries outside {@link NATIONAL_SCOPE} still get a stock when only a
 * national average exists, and states without their own income row still count.
 */
export function addHouseholdMoneyFromDemography(
  byCurrency: Map<CurrencyCode, MutableComponents>,
  states: DemographicState[],
  medianIncomeDocs: MedianIncomeDoc[]
): void {
  const incomeByStateId = new Map<string, number>();
  const incomeByCountry = new Map<string, number>();
  for (const doc of medianIncomeDocs) {
    const income = doc.economic?.medianIncome?.value;
    if (typeof income !== "number" || !(income > 0)) continue;
    incomeByStateId.set(String(doc._id), income);
    const nationalCountry = NATIONAL_SCOPE[doc._id];
    if (nationalCountry) incomeByCountry.set(nationalCountry, income);
  }

  for (const st of states) {
    if (!st.countryId || NATIONAL_SCOPE_IDS.has(String(st._id))) continue;
    if (!(typeof st.population === "number" && st.population > 0)) continue;
    const income = incomeByStateId.get(String(st._id)) ?? incomeByCountry.get(st.countryId);
    if (!income) continue;
    const households = st.population / PERSONS_PER_HOUSEHOLD;
    const annualIncome = households * income;
    const currency = homeCurrency(st.countryId as CountryId);
    addComponent(byCurrency, currency, "householdLiquid", annualIncome * HOUSEHOLD_LIQUID_RATIO);
    addComponent(byCurrency, currency, "householdSavings", annualIncome * HOUSEHOLD_SAVINGS_RATIO);
  }
}

export interface BankMoneyFields {
  countryId: CountryId;
  externalBroadMoney?: number;
  netMoneyCreatedLifetime?: number;
  reserveBalance?: number;
}

/**
 * Apply per-bank external residual + reserve readout. Reserves are recorded for
 * diagnostics but never enter M1/M2 (see {@link calculateMoneyAggregates}).
 */
export function addCentralBankMoney(
  byCurrency: Map<CurrencyCode, MutableComponents>,
  banks: BankMoneyFields[]
): void {
  for (const bank of banks) {
    const currency = homeCurrency(bank.countryId);
    addComponent(
      byCurrency,
      currency,
      "externalBroadMoney",
      effectiveExternalBroadMoney(bank.externalBroadMoney, bank.netMoneyCreatedLifetime)
    );
    // Real field; moves with liquidity injections / forex reserve draws. Kept
    // out of M1/M2 by calculateMoneyAggregates — counting it alongside deposits
    // would double-count base money.
    addComponent(byCurrency, currency, "bankReserves", bank.reserveBalance);
  }
}

export function aggregatesForCurrency(
  byCurrency: Map<CurrencyCode, MutableComponents>,
  currencyCode: CurrencyCode
): MoneyAggregates {
  return calculateMoneyAggregates(byCurrency.get(currencyCode) ?? emptyComponents());
}
