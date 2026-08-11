import type { CurrencyCode } from "@/lib/constants/currencies";

export interface ReservePortfolioEntry {
  currencyCode: CurrencyCode;
  balance: number;
  valueInHomeCurrency: number;
  shareOfSpreadFeeReserves: number;
}

export interface ReservePortfolioSummary {
  homeCurrency: CurrencyCode;
  homeReserveBalance: number;
  spreadFeeReserveBalances: Partial<Record<CurrencyCode, number>>;
  spreadFeeReservesHomeValue: number;
  totalReservesHomeValue: number;
  entries: ReservePortfolioEntry[];
  foreignEntries: ReservePortfolioEntry[];
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function convertCurrencyAmount(params: {
  amount: number;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rates?: Partial<Record<CurrencyCode, number>>;
}): number {
  const { amount, fromCurrency, toCurrency, rates } = params;
  if (!Number.isFinite(amount)) return 0;
  if (fromCurrency === toCurrency) return amount;

  const fromRate = rates?.[fromCurrency];
  const toRate = rates?.[toCurrency];
  if (!finitePositive(fromRate) || !finitePositive(toRate)) return 0;

  return (amount / fromRate) * toRate;
}

export function buildReservePortfolioSummary(params: {
  homeCurrency: CurrencyCode;
  reserveBalance?: number | null;
  spreadFeeReserveBalances?: Partial<Record<CurrencyCode, number>> | null;
  rates?: Partial<Record<CurrencyCode, number>>;
}): ReservePortfolioSummary {
  const homeReserveBalance =
    typeof params.reserveBalance === "number" && Number.isFinite(params.reserveBalance)
      ? params.reserveBalance
      : 0;
  const balances = params.spreadFeeReserveBalances ?? {};
  const entries = (Object.entries(balances) as Array<[CurrencyCode, number | undefined]>)
    .filter(([, balance]) => typeof balance === "number" && Number.isFinite(balance) && balance > 0)
    .map(([currencyCode, balance]) => ({
      currencyCode,
      balance: balance!,
      valueInHomeCurrency: convertCurrencyAmount({
        amount: balance!,
        fromCurrency: currencyCode,
        toCurrency: params.homeCurrency,
        rates: params.rates,
      }),
      shareOfSpreadFeeReserves: 0,
    }))
    .sort((a, b) => b.valueInHomeCurrency - a.valueInHomeCurrency);

  const spreadFeeReservesHomeValue = entries.reduce(
    (sum, entry) => sum + entry.valueInHomeCurrency,
    0
  );
  const entriesWithShare = entries.map((entry) => ({
    ...entry,
    shareOfSpreadFeeReserves:
      spreadFeeReservesHomeValue > 0 ? entry.valueInHomeCurrency / spreadFeeReservesHomeValue : 0,
  }));

  return {
    homeCurrency: params.homeCurrency,
    homeReserveBalance,
    spreadFeeReserveBalances: balances,
    spreadFeeReservesHomeValue,
    totalReservesHomeValue: homeReserveBalance + spreadFeeReservesHomeValue,
    entries: entriesWithShare,
    foreignEntries: entriesWithShare.filter((entry) => entry.currencyCode !== params.homeCurrency),
  };
}

/**
 * Build a portfolio summary that INCLUDES the home currency reserve as an entry.
 * Use this when you want the pie chart / table to show all reserves, not just foreign.
 */
export function buildFullReservePortfolioSummary(params: {
  homeCurrency: CurrencyCode;
  reserveBalance?: number | null;
  spreadFeeReserveBalances?: Partial<Record<CurrencyCode, number>> | null;
  rates?: Partial<Record<CurrencyCode, number>>;
}): ReservePortfolioSummary {
  const homeReserveBalance =
    typeof params.reserveBalance === "number" && Number.isFinite(params.reserveBalance)
      ? params.reserveBalance
      : 0;
  const balances = params.spreadFeeReserveBalances ?? {};

  // Start with the home currency reserve as the first entry
  const homeEntry: ReservePortfolioEntry = {
    currencyCode: params.homeCurrency,
    balance: homeReserveBalance,
    valueInHomeCurrency: homeReserveBalance,
    shareOfSpreadFeeReserves: 0,
  };

  const foreignEntries = (Object.entries(balances) as Array<[CurrencyCode, number | undefined]>)
    .filter(([, balance]) => typeof balance === "number" && Number.isFinite(balance) && balance > 0)
    .filter(([currencyCode]) => currencyCode !== params.homeCurrency)
    .map(([currencyCode, balance]) => ({
      currencyCode,
      balance: balance!,
      valueInHomeCurrency: convertCurrencyAmount({
        amount: balance!,
        fromCurrency: currencyCode,
        toCurrency: params.homeCurrency,
        rates: params.rates,
      }),
      shareOfSpreadFeeReserves: 0,
    }))
    .sort((a, b) => b.valueInHomeCurrency - a.valueInHomeCurrency);

  const allEntries = [homeEntry, ...foreignEntries].filter((e) => e.balance > 0);
  const spreadFeeReservesHomeValue = foreignEntries.reduce(
    (sum, entry) => sum + entry.valueInHomeCurrency,
    0
  );
  const totalValue = homeReserveBalance + spreadFeeReservesHomeValue;
  const entriesWithShare = allEntries.map((entry) => ({
    ...entry,
    shareOfSpreadFeeReserves: totalValue > 0 ? entry.valueInHomeCurrency / totalValue : 0,
  }));

  return {
    homeCurrency: params.homeCurrency,
    homeReserveBalance,
    spreadFeeReserveBalances: balances,
    spreadFeeReservesHomeValue,
    totalReservesHomeValue: totalValue,
    entries: entriesWithShare,
    foreignEntries: entriesWithShare.filter((entry) => entry.currencyCode !== params.homeCurrency),
  };
}
