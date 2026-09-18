export interface MarketIndexInput {
  currentMarketCap: number;
  previousMarketCap?: number;
  previousSurvivorMarketCap?: number;
  previousIndex?: number;
  previousDivisor?: number;
}

export interface MarketIndexResult {
  index: number;
  divisor: number;
  removedMarketCap: number;
}

function finiteNonnegative(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finitePositive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Keep a market-cap index continuous when listed corporations leave the
 * universe. `currentMarketCap` remains the raw capitalization; the divisor
 * absorbs constituent removals so the index measures surviving-market return.
 */
export function computeMarketIndex(input: MarketIndexInput): MarketIndexResult {
  const currentMarketCap = finiteNonnegative(input.currentMarketCap) ?? 0;
  const previousMarketCap = finitePositive(input.previousMarketCap);
  const previousIndex =
    finitePositive(input.previousIndex) ??
    previousMarketCap ??
    finitePositive(currentMarketCap) ??
    1;
  const previousDivisor = finitePositive(input.previousDivisor) ?? 1;
  const previousSurvivorMarketCap =
    previousMarketCap == null
      ? undefined
      : Math.min(
          previousMarketCap,
          finiteNonnegative(input.previousSurvivorMarketCap) ?? previousMarketCap
        );
  const removedMarketCap =
    previousMarketCap != null && previousSurvivorMarketCap != null
      ? Math.max(0, previousMarketCap - previousSurvivorMarketCap)
      : 0;

  // On a removal, use the previous index level and the surviving constituents'
  // previous capitalization to derive the new divisor. This preserves the
  // index through deletion while still allowing later price changes to move it.
  const divisor =
    removedMarketCap > 0 && previousSurvivorMarketCap! > 0
      ? previousSurvivorMarketCap / previousIndex
      : previousDivisor;
  const index = divisor > 0 ? currentMarketCap / divisor : 0;

  return { index, divisor, removedMarketCap };
}
