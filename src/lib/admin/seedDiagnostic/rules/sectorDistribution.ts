/** Revenue mix from the productive pool selected by the seed contract. */
export function sectorRevenueDistribution(
  rows: ReadonlyArray<{ sectorType?: string; revenue?: number }>
): { shareSum: number; maxType: string; maxShare: number } | null {
  const revenueByType = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const type = row.sectorType ?? "";
    const revenue = Number(row.revenue) || 0;
    revenueByType.set(type, (revenueByType.get(type) ?? 0) + revenue);
    total += revenue;
  }
  if (total <= 0) return null;
  let shareSum = 0;
  let maxShare = 0;
  let maxType = "";
  for (const [type, revenue] of revenueByType) {
    const share = revenue / total;
    shareSum += share;
    if (share > maxShare) {
      maxShare = share;
      maxType = type;
    }
  }
  return { shareSum, maxType, maxShare };
}
