/** Value every currency pocket. Legacy balances apply only when the home pocket is absent. */
export function liquidBalancesAnchor(input: {
  homeCurrency: string;
  personal?: Readonly<Record<string, number | undefined>>;
  savings?: Readonly<Record<string, number | undefined>>;
  legacyPersonal: number;
  legacySavings: number;
  rates: ReadonlyMap<string, number>;
}): { personal: number; savings: number } {
  const value = (
    pockets: Readonly<Record<string, number | undefined>> | undefined,
    legacy: number
  ) => {
    const balances = { ...pockets, [input.homeCurrency]: pockets?.[input.homeCurrency] ?? legacy };
    return Object.entries(balances).reduce((sum, [currency, amount]) => {
      const quoted = input.rates.get(currency) ?? 1;
      const rate = Number.isFinite(quoted) && quoted > 0 ? quoted : 1;
      return sum + (Number.isFinite(amount) ? amount! / rate : 0);
    }, 0);
  };
  return {
    personal: value(input.personal, input.legacyPersonal),
    savings: value(input.savings, input.legacySavings),
  };
}

export function personalDebtAnchor(
  loans: readonly {
    borrowerId: string;
    currency: string;
    outstanding: number;
  }[],
  rates: ReadonlyMap<string, number>
): Map<string, number> {
  const result = new Map<string, number>();
  for (const loan of loans) {
    const quoted = rates.get(loan.currency) ?? 1;
    const rate = Number.isFinite(quoted) && quoted > 0 ? quoted : 1;
    const amount = Number.isFinite(loan.outstanding) ? Math.max(0, loan.outstanding) / rate : 0;
    result.set(loan.borrowerId, (result.get(loan.borrowerId) ?? 0) + amount);
  }
  return result;
}
