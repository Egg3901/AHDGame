/**
 * Group comparison restates completed-turn snapshots at their recorded exchange rate.
 * Missing historical FX remains unknown instead of being valued at today's rate.
 */
export interface GroupHistoryInput {
  turn: number;
  revenue: number;
  totalCosts: number;
  income: number;
  liquidCapital?: number;
  currencyCode?: string;
  fxRateAtWrite?: number;
}
export function groupHistoryInAnchor(row: GroupHistoryInput) {
  const rate = row.currencyCode ? row.fxRateAtWrite : 1;
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  if (![row.revenue, row.totalCosts, row.income].every(Number.isFinite)) return null;
  return {
    turn: row.turn,
    revenue: row.revenue / rate,
    costs: row.totalCosts / rate,
    income: row.income / rate,
    ...(Number.isFinite(row.liquidCapital) ? { cash: row.liquidCapital! / rate } : {}),
  };
}

/** Combine only like-for-like, fully visible completed-turn observations. */
export function combineGroupLatest(
  rows: readonly (NonNullable<ReturnType<typeof groupHistoryInAnchor>> | null | undefined)[]
) {
  const first = rows[0];
  if (!first || rows.some((row) => !row || row.turn !== first.turn)) return null;
  return rows.reduce<NonNullable<ReturnType<typeof groupHistoryInAnchor>>>(
    (sum, row) => ({
      turn: first.turn,
      revenue: sum.revenue + row!.revenue,
      costs: sum.costs + row!.costs,
      income: sum.income + row!.income,
    }),
    { turn: first.turn, revenue: 0, costs: 0, income: 0 }
  );
}
