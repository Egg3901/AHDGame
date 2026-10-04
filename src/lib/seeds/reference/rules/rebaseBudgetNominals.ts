/**
 * Seed budget nominal amounts follow a corrected GDP anchor without changing
 * modelled fiscal shares. rebaseBudgetNominals scales revenue, debt and spending;
 * policy rates and tax-base ratios retain their independent values.
 */
interface BudgetNominals {
  gdp: number;
  otherRevenue: number;
  debt: { principal: number; ceiling: number };
  baselineSpendingByCategory: Record<string, number>;
  baselineStateGrants: number;
}

export function rebaseBudgetNominals<T extends BudgetNominals>(config: T, gdp: number): T {
  if (!Number.isFinite(config.gdp) || config.gdp <= 0 || !Number.isFinite(gdp) || gdp <= 0)
    throw new Error("Positive finite GDP required to rebase seed budget nominals");
  const scale = gdp / config.gdp;
  return {
    ...config,
    gdp,
    otherRevenue: config.otherRevenue * scale,
    debt: {
      ...config.debt,
      principal: config.debt.principal * scale,
      ceiling: config.debt.ceiling * scale,
    },
    baselineSpendingByCategory: Object.fromEntries(
      Object.entries(config.baselineSpendingByCategory).map(([key, value]) => [key, value * scale])
    ),
    baselineStateGrants: config.baselineStateGrants * scale,
  };
}
