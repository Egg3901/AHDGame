/**
 * Turns a NOMINAL revenue-trend growth reading into the REAL cyclical signal the
 * output gap integrates. Pure: plain numbers in, plain numbers out.
 *
 * Two artifacts made the money-based trend read as a permanent boom:
 *  - Sector revenue is priced in nominal terms, so with double-digit inflation
 *    the trend carried the price level straight into a real-output gap.
 *  - While corporations are still being founded the revenue base grows from
 *    near zero (hundreds of times over a few turns). That is sector formation,
 *    not a business cycle, and it pinned every region at the top of the bound.
 */

/** Same band the shared nominal commodity price index uses for its inflation input. */
export const DEFLATOR_INFLATION_BOUND: readonly [number, number] = [-2, 25];

/**
 * Annualized nominal growth (%) above which the reading is sector formation.
 * Real expansions and busts sit far below it; only a base growing from near
 * nothing exceeds it.
 */
export const SECTOR_FORMATION_GROWTH_PCT = 100;

/** Neutral reading for a sector base still forming: the unowned background rate. */
export const SECTOR_FORMATION_NEUTRAL_PCT = 0.5;

/**
 * Strip inflation from an annualized nominal growth reading, or return the
 * neutral background rate when the reading is sector formation. The formation
 * test runs on the nominal value, before any signal clamp can hide it.
 */
export function realRevenueGrowth(nominalPct: number, inflationPct: number | undefined): number {
  if (nominalPct > SECTOR_FORMATION_GROWTH_PCT) return SECTOR_FORMATION_NEUTRAL_PCT;
  const infl =
    typeof inflationPct === "number" && Number.isFinite(inflationPct)
      ? Math.max(DEFLATOR_INFLATION_BOUND[0], Math.min(DEFLATOR_INFLATION_BOUND[1], inflationPct))
      : 0;
  return ((1 + nominalPct / 100) / (1 + infl / 100) - 1) * 100;
}
