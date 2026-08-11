import type { CrossCorpStockHolding } from "@/lib/corporations/portfolioAnchorValuation";

/**
 * Applies the equity method to `baseEarnings`: for each corp that holds shares
 * of another corp, adds its proportional share of the held corp's BASE earnings.
 *
 * Uses base earnings for all additions (not the adjusted values) to avoid
 * circular dependency — this replaces the 12-iteration convergence loop.
 *
 * Returns a new Map; does not mutate inputs.
 */
export function applyEquityMethodEarnings(
  baseEarnings: Map<string, number>,
  crossHoldingsByHolderCorpId: Map<string, CrossCorpStockHolding[]>,
  totalSharesByCorpId: Map<string, number>
): Map<string, number> {
  const adjusted = new Map(baseEarnings);

  for (const [holderCorpId, holdings] of crossHoldingsByHolderCorpId) {
    let equityAddition = 0;
    for (const holding of holdings) {
      const issuerTotalShares = totalSharesByCorpId.get(holding.issuerCorpId) ?? 0;
      if (issuerTotalShares <= 0) continue;
      const fraction = holding.shares / issuerTotalShares;
      const issuerBaseEarnings = baseEarnings.get(holding.issuerCorpId) ?? 0;
      equityAddition += fraction * issuerBaseEarnings;
    }
    if (equityAddition !== 0) {
      adjusted.set(holderCorpId, (adjusted.get(holderCorpId) ?? 0) + equityAddition);
    }
  }

  return adjusted;
}
