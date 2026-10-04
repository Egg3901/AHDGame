import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import { loadLiveSuccessionFinances, type LiveSuccessionFinances } from "./loadLiveFinances";

export interface SuccessionAccountingSnapshot {
  /** Signed source treasury cash in shared accounting minor units. */
  signedCashMinor: number;
  financialAssetsMinor: number;
  /** A cash overdraft is not silently treated as a creditor bond. */
  cashDeficitMinor: number;
  creditorDebtMinor: number;
  creditorPrincipalByBondMinor: Record<string, number>;
  /** Budget debt is a cross-check, not an additional liability. */
  reportedDebtMinor: number;
  ratesLocalPerAnchor: Record<string, number>;
}

function toMinor(localAmount: number, rate: number): number {
  if (!Number.isFinite(localAmount) || !Number.isFinite(rate) || rate <= 0)
    throw new Error("Federation settlement needs finite values and positive exchange rates");
  const minor = Math.round((localAmount / rate) * 100);
  if (!Number.isSafeInteger(minor))
    throw new Error("Federation settlement exceeds shared accounting precision");
  return minor;
}

/** Convert one immutable finance snapshot to shared accounting units. Existing
 * bond currencies and creditor contracts are preserved for servicing. */
export function normalizeSuccessionFinances(
  finances: LiveSuccessionFinances,
  ratesLocalPerAnchor: Readonly<Record<string, number>>
): SuccessionAccountingSnapshot {
  const requiredCurrencies = new Set<string>();
  if (finances.budgetCurrencyCode) requiredCurrencies.add(finances.budgetCurrencyCode);
  for (const bond of finances.creditorContracts) {
    if (bond.currencyCode) requiredCurrencies.add(bond.currencyCode);
  }
  const rates: Record<string, number> = {};
  for (const code of requiredCurrencies) {
    const rate = ratesLocalPerAnchor[code];
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error(`Missing prevailing exchange rate for ${code}`);
    rates[code] = rate;
  }
  const budgetRate = finances.budgetCurrencyCode ? rates[finances.budgetCurrencyCode] : 1;
  const signedCashMinor = toMinor(finances.treasuryBalanceLocal, budgetRate);
  const reportedDebtMinor = toMinor(finances.reportedDebtPrincipalLocal, budgetRate);
  if (reportedDebtMinor < 0) throw new Error("Federation budget debt cannot be negative");
  const creditorPrincipalByBondMinor: Record<string, number> = {};
  const seen = new Set<string>();
  let creditorDebtMinor = 0;
  let rawBondDebt = 0;
  let allBondDebtInBudgetCurrency = true;
  for (const bond of finances.creditorContracts) {
    if (!bond.bondId || seen.has(bond.bondId) || bond.outstandingPrincipal < 0)
      throw new Error("Federation has an invalid or duplicate creditor contract");
    seen.add(bond.bondId);
    const rate = bond.currencyCode ? rates[bond.currencyCode] : 1;
    const minor = toMinor(bond.outstandingPrincipal, rate);
    creditorPrincipalByBondMinor[bond.bondId] = minor;
    creditorDebtMinor += minor;
    rawBondDebt += bond.outstandingPrincipal;
    if (bond.currencyCode !== finances.budgetCurrencyCode) allBondDebtInBudgetCurrency = false;
    if (!Number.isSafeInteger(creditorDebtMinor) || !Number.isFinite(rawBondDebt))
      throw new Error("Federation creditor debt exceeds supported precision");
  }
  // The budget's principal mirrors bond stock only when both are expressed in
  // one currency. Mixed-currency bonds still use each creditor contract's own
  // denomination; their raw sum is not a meaningful local-currency cross-check.
  if (
    allBondDebtInBudgetCurrency &&
    Math.abs(rawBondDebt - finances.reportedDebtPrincipalLocal) > 1
  )
    throw new Error("Federation budget debt disagrees with outstanding creditor bonds");
  return {
    signedCashMinor,
    financialAssetsMinor: Math.max(0, signedCashMinor),
    cashDeficitMinor: Math.max(0, -signedCashMinor),
    creditorDebtMinor,
    creditorPrincipalByBondMinor,
    reportedDebtMinor,
    ratesLocalPerAnchor: rates,
  };
}

/** Read actual prevailing currency rates. Missing and conflicting rows fail
 * closed: an era fallback would silently change a real settlement's value. */
export async function loadSuccessionExchangeRates(
  db: Db,
  finances: LiveSuccessionFinances,
  session?: ClientSession
): Promise<Record<string, number>> {
  const currencies = [
    finances.budgetCurrencyCode,
    ...finances.creditorContracts.map((bond) => bond.currencyCode),
  ].filter((code): code is CurrencyCode => code != null);
  const unique = [...new Set(currencies)];
  if (unique.length === 0) return {};
  const rows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ currencyCode: { $in: unique } }, { session })
    .toArray();
  const rates: Record<string, number> = {};
  for (const row of rows) {
    if (!unique.includes(row.currencyCode)) continue;
    if (!Number.isFinite(row.rate) || row.rate <= 0)
      throw new Error("Federation exchange rate row is invalid");
    if (rates[row.currencyCode] !== undefined && rates[row.currencyCode] !== row.rate)
      throw new Error("Federation has conflicting rates for one currency");
    rates[row.currencyCode] = row.rate;
  }
  for (const code of unique) {
    if (rates[code] === undefined) throw new Error(`Missing prevailing exchange rate for ${code}`);
  }
  return rates;
}

/** The settlement writer must call this inside its guarded source snapshot,
 * then compare approved asset/debt terms with these exact values before any
 * cash, contract or sovereignty write. */
export async function loadLiveSuccessionAccountingSnapshot(
  db: Db,
  sourceCountryId: CountryId,
  session?: ClientSession
): Promise<SuccessionAccountingSnapshot> {
  const finances = await loadLiveSuccessionFinances(db, sourceCountryId, session);
  const rates = await loadSuccessionExchangeRates(db, finances, session);
  return normalizeSuccessionFinances(finances, rates);
}
