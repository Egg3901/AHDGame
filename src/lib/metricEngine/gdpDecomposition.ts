export interface GdpDecomposition {
  total: number; // headline gdpGrowth (annualized %)
  potential: number; // growth reference: the measured output trend (outputTrend.ts)
  cyclical: number; // total - reference (growth above or below the trend)
  isExpansionary: boolean; // total > potential (running above trend)
}

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

/**
 * Split headline GDP growth into a growth reference (the measured output trend,
 * metricEngine/outputTrend.ts) and the cyclical remainder above or below it.
 * The split is exact by construction: cyclical = total - reference.
 */
export function decomposeGdpGrowth(gdpGrowth: number, potentialGrowth: number): GdpDecomposition {
  const total = finite(gdpGrowth);
  const potential = finite(potentialGrowth);
  const cyclical = total - potential;
  return { total, potential, cyclical, isExpansionary: cyclical > 0 };
}
