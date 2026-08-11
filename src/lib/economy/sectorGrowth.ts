/**
 * Display helpers for a sector's average growth rate — the mean of the
 * member corporations' current (realized) growth rate, shown on the
 * sector-board tiles.
 */

export type GrowthTone = "success" | "error" | "neutral";

/** Mean of a list of growth rates (2dp), or null when the list is empty. */
export function meanGrowth(rates: number[]): number | null {
  if (rates.length === 0) return null;
  const sum = rates.reduce((a, b) => a + b, 0);
  return Math.round((sum / rates.length) * 100) / 100;
}

/** Signed two-decimal percent ("+2.45%", "-1.30%"); em-dash when unknown. */
export function formatAvgGrowth(avgGrowth: number | null): string {
  if (avgGrowth == null) return "—";
  const v = avgGrowth.toFixed(2);
  return avgGrowth > 0 ? `+${v}%` : `${v}%`;
}

/** Green for positive growth, red for negative, neutral at zero/unknown. */
export function avgGrowthTone(avgGrowth: number | null): GrowthTone {
  if (avgGrowth == null || avgGrowth === 0) return "neutral";
  return avgGrowth > 0 ? "success" : "error";
}
