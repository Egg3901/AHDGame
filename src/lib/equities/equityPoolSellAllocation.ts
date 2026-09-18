import type { CurrencyCode } from "@/lib/constants/currencies";

export interface EquityPoolSellDemand {
  currency: CurrencyCode;
  corporationId: string;
  notionalLocal: number;
}

/**
 * Allocate each currency pool's opening cash across corporations with
 * executable sell demand. The result is a per-corporation spending budget.
 */
export function allocateEquityPoolSellBudgets(input: {
  cashByCurrency: ReadonlyMap<CurrencyCode, number>;
  demands: readonly EquityPoolSellDemand[];
}): Map<CurrencyCode, Map<string, number>> {
  const demandByCurrency = new Map<CurrencyCode, Map<string, number>>();

  for (const demand of input.demands) {
    if (!Number.isFinite(demand.notionalLocal) || demand.notionalLocal <= 0) continue;
    const byCorporation = demandByCurrency.get(demand.currency) ?? new Map<string, number>();
    byCorporation.set(
      demand.corporationId,
      (byCorporation.get(demand.corporationId) ?? 0) + demand.notionalLocal
    );
    demandByCurrency.set(demand.currency, byCorporation);
  }

  const budgets = new Map<CurrencyCode, Map<string, number>>();
  for (const [currency, byCorporation] of demandByCurrency) {
    const totalDemand = [...byCorporation.values()].reduce((total, value) => total + value, 0);
    const openingCash = Math.max(0, input.cashByCurrency.get(currency) ?? 0);
    const allocationFactor = totalDemand > openingCash ? openingCash / totalDemand : 1;
    const currencyBudgets = new Map<string, number>();

    for (const [corporationId, demand] of byCorporation) {
      currencyBudgets.set(corporationId, demand * allocationFactor);
    }
    budgets.set(currency, currencyBudgets);
  }

  return budgets;
}
