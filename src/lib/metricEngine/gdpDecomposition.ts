export interface GdpDecomposition {
  total: number; // integrated gdpGrowth (annualized %)
  potential: number; // supply-side trend (Solow αL·g_L + αK·g_K + TFP)
  cyclical: number; // total - potential (output-gap-driven)
  isExpansionary: boolean; // total > potential (running above trend)
}

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

/**
 * Decompose the integrated GDP growth rate into its supply-side potential trend
 * and the cyclical (output-gap) component. `gdpGrowth = potential + cyclical` by
 * construction in the engine (metricEngine/phase.ts), so the split is exact.
 */
export function decomposeGdpGrowth(gdpGrowth: number, potentialGrowth: number): GdpDecomposition {
  const total = finite(gdpGrowth);
  const potential = finite(potentialGrowth);
  const cyclical = total - potential;
  return { total, potential, cyclical, isExpansionary: cyclical > 0 };
}
