/**
 * Per-region OUTPUT GAP (design §5.2 / §6.1) — the cyclical deviation of actual
 * output from potential. It accumulates the sector signal's deviation from
 * potential and CLOSES over time (output gaps close — the real attractor), so
 * `gdpGrowth` reverts to potential while the gap carries the boom/bust as a
 * LEVEL. N5: this gap-closure is a SEPARATE series from the sector EMA, so there
 * is no double-reversion (the sector EMA smooths `sectorGrowth`; the gap-closure
 * acts on the gap).
 */

/**
 * Fraction of the output gap that closes per year (tunable). v0 balance fix
 * (2026-06-30): raised 0.5 → 1.5 so the steady-state gap (= impulse / GAP_CLOSURE)
 * stays well inside the ±15 bound instead of pinning for high-demand regions —
 * keeping the gap responsive to new demand shocks. See
 * docs/plans/2026-06-30-macro-balance-v0.md (#2).
 */
export const GAP_CLOSURE = 1.5;
/** Output gap is bounded so a mis-fed signal can't open an unbounded gap (%). */
export const OUTPUT_GAP_BOUND: readonly [number, number] = [-15, 15];
/** Integrated GDP growth shares the registry's published percent bounds. */
export const GDP_GROWTH_BOUND: readonly [number, number] = [-15, 15];

export interface OutputGapStep {
  /** New output-gap level (%). */
  gap: number;
  /** Integrated growth = potential + the realized annualized gap change (%). */
  gdpGrowth: number;
  /** Cyclical impulse this turn = sectorSignal − potential (annual %). */
  impulse: number;
}

/**
 * Advance the output gap by one turn and derive the integrated `gdpGrowth`.
 *
 *   impulse   = sectorSignal − potential                          (annual %)
 *   rawGap    = prevGap + (impulse − GAP_CLOSURE·prevGap) / turnsPerYear
 *   gap       = clamp(rawGap, the feasible stock/rate intersection)
 *   gdpGrowth = potential + (gap − prevGap)·turnsPerYear          (from the REALIZED gap change)
 *
 * Steady (sector=potential, gap=0) → gdpGrowth=potential. A sustained boom opens
 * the gap to ≈ Δ/GAP_CLOSURE while gdpGrowth reverts to potential; when the boom
 * ends the positive gap drives gdpGrowth below potential (the bust) as it closes.
 * Both returned values are bounded together so a rate clamp cannot desynchronise
 * the persisted stock and the headline rate.
 */
export function advanceOutputGap(
  prevGap: number,
  sectorSignal: number,
  potential: number,
  turnsPerYear: number
): OutputGapStep {
  const g0Raw = Number.isFinite(prevGap) ? prevGap : 0;
  const g0 = Math.max(OUTPUT_GAP_BOUND[0], Math.min(OUTPUT_GAP_BOUND[1], g0Raw));
  const sector = Number.isFinite(sectorSignal) ? sectorSignal : 0;
  const potRaw = Number.isFinite(potential) ? potential : 0;
  const pot = Math.max(GDP_GROWTH_BOUND[0], Math.min(GDP_GROWTH_BOUND[1], potRaw));
  const impulse = sector - pot;
  const tpy = Number.isFinite(turnsPerYear) && turnsPerYear > 0 ? turnsPerYear : 1;
  const rawGap = g0 + (impulse - GAP_CLOSURE * g0) / tpy;
  // Restrict the gap to the intersection that keeps both the stock and the
  // integrated rate inside their published bounds. This avoids clipping the
  // rate after the stock has already been persisted.
  const feasibleGap: [number, number] = [
    Math.max(OUTPUT_GAP_BOUND[0], g0 + (GDP_GROWTH_BOUND[0] - pot) / tpy),
    Math.min(OUTPUT_GAP_BOUND[1], g0 + (GDP_GROWTH_BOUND[1] - pot) / tpy),
  ];
  const gap = Math.max(feasibleGap[0], Math.min(feasibleGap[1], rawGap));
  const gdpGrowth = pot + (gap - g0) * tpy;
  return { gap, gdpGrowth, impulse };
}
