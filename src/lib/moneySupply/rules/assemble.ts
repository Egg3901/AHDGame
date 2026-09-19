import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  calculateMoneyAggregates,
  type MoneyAggregates,
  type MoneySupplyComponents,
} from "./calculate";

/** Demographic estimates are diagnostic, never payment-backed monetary stocks. */
export const PERSONS_PER_HOUSEHOLD = 3.2;
export const HOUSEHOLD_LIQUID_RATIO = 0.15;
export const HOUSEHOLD_SAVINGS_RATIO = 0.6;

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
    bondPoolCash: 0,
    equityPoolCash: 0,
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
  row[key] = (row[key] ?? 0) + value;
  byCurrency.set(currency, row);
}

/**
 * Government "cash" for money-supply purposes.
 *
 * `federalBudget.treasuryBalance` is the signed fiscal SSOT: positive = surplus
 * cash on hand, negative = −debt.principal by design (see budgets.ts seed and
 * `nationalDebtFromBalance`). Taking `abs(treasuryBalance)` would invent
 * government deposits equal to the national debt ; a false positive the
 * postmortem warns about. Only a positive balance is spendable money; an
 * indebted treasury contributes 0 to M1.
 */
export function governmentLiquidFromTreasury(treasuryBalance: unknown): number {
  if (typeof treasuryBalance !== "number" || !Number.isFinite(treasuryBalance)) return 0;
  return Math.max(0, treasuryBalance);
}

/** Fiscal advances first cancel a signed deficit, then add spendable cash. */
export function treasuryAdvanceMoneyDelta(before: number, amount: number): number {
  return governmentLiquidFromTreasury(before + amount) - governmentLiquidFromTreasury(before);
}

/** Stored external deposits count at face value. Issuance counters are not balances. */
export function effectiveExternalBroadMoney(externalBroadMoney: unknown): number {
  return typeof externalBroadMoney === "number" && Number.isFinite(externalBroadMoney)
    ? Math.max(0, externalBroadMoney)
    : 0;
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
 * Derive diagnostic household estimates from population × median income.
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
    addComponent(
      byCurrency,
      currency,
      "estimatedHouseholdLiquid",
      annualIncome * HOUSEHOLD_LIQUID_RATIO
    );
    addComponent(
      byCurrency,
      currency,
      "estimatedHouseholdSavings",
      annualIncome * HOUSEHOLD_SAVINGS_RATIO
    );
  }
}

export interface BankMoneyFields {
  countryId: CountryId;
  externalBroadMoney?: number;
  netMoneyCreatedLifetime?: number;
  reserveBalance?: number;
}

/**
 * Apply stored external deposits and the reserve readout. Reserves are recorded for
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
      effectiveExternalBroadMoney(bank.externalBroadMoney)
    );
    // Real field; moves with liquidity injections / forex reserve draws. Kept
    // out of M1/M2 by calculateMoneyAggregates ; counting it alongside deposits
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
