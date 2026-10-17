/** Operating accounts use expenses directly, including sites with no sales. */
export function apportionOperatingProfit(input: {
  sectors: readonly { revenue: number; operatingCosts: number }[];
  corporateCosts: number;
}) {
  if (
    !Number.isFinite(input.corporateCosts) ||
    input.sectors.some(
      (s) => !Number.isFinite(s.revenue) || s.revenue < 0 || !Number.isFinite(s.operatingCosts)
    )
  )
    throw new Error("Invalid corporate operating accounts");
  const revenue = input.sectors.reduce((sum, sector) => sum + sector.revenue, 0);
  if (!Number.isFinite(revenue)) throw new Error("Non-finite corporate revenue");
  const sectors = input.sectors.map((sector) => {
    const revenueShare = revenue > 0 ? sector.revenue / revenue : 1 / input.sectors.length;
    const operatingProfit = sector.revenue - sector.operatingCosts;
    return {
      operatingProfit,
      profitAfterCorporateCosts: operatingProfit - input.corporateCosts * revenueShare,
    };
  });
  const profit = sectors.reduce((sum, sector) => sum + sector.profitAfterCorporateCosts, 0);
  const positive = sectors.reduce(
    (sum, sector) => sum + Math.max(0, sector.profitAfterCorporateCosts),
    0
  );
  if (!Number.isFinite(profit) || !Number.isFinite(positive))
    throw new Error("Non-finite corporate profit");
  const lossOffset = positive > 0 ? Math.max(0, Math.min(1, profit / positive)) : 0;
  return sectors.map((sector) => ({
    ...sector,
    taxableProfit: Math.max(0, sector.profitAfterCorporateCosts) * lossOffset,
  }));
}
