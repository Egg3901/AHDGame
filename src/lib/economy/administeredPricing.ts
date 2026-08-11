/**
 * Administered pricing kernels (P2).
 *
 * In a planned economy, consumer-good prices are SET by the plan, not cleared by
 * the market: they hold flat at an administered path (plus a turnover-tax wedge
 * that is the state's main indirect revenue) and do NOT respond to the
 * supply/demand balance. The unmet demand at that held price is the physical
 * shortage. For dual-track economies both regimes coexist, split by the dial's
 * `plannedShare`.
 *
 * Pure and NaN-guarded — consumed by the country-scoped national-price leg of
 * `commodityPriceTurn` (never the shared global leg: an administered branch that
 * leaked into the global price is the naira-100x incident class).
 */

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Soviet-style turnover-tax wedge folded into the administered price. */
export const DEFAULT_TURNOVER_MARKUP = 0.12;

/**
 * Administered national price for a commodity: the era base price held flat,
 * marked up by the turnover tax. No supply/demand response — that's the point.
 */
export function administeredNationalPrice(
  basePrice: number,
  turnoverTaxMarkup: number = DEFAULT_TURNOVER_MARKUP
): number {
  const base = finite(basePrice, 0);
  const markup = Math.max(0, finite(turnoverTaxMarkup, 0));
  return base * (1 + markup);
}

/**
 * The turnover-tax revenue implied by administered sales of one commodity leg:
 * the wedge between the administered price and the untaxed base, times units
 * actually supplied (you can only tax what's sold).
 */
export function turnoverTaxRevenue(
  basePrice: number,
  suppliedUnits: number,
  turnoverTaxMarkup: number = DEFAULT_TURNOVER_MARKUP
): number {
  const base = finite(basePrice, 0);
  const units = Math.max(0, finite(suppliedUnits, 0));
  const markup = Math.max(0, finite(turnoverTaxMarkup, 0));
  return base * markup * units;
}

/**
 * Demand-vs-supply gap as a percentage of supply at the held price — the
 * physical shortage signal (≥ 0; 0 when supply meets or exceeds demand).
 */
export function demandSupplyGapPct(supply: number, demand: number): number {
  const s = Math.max(0, finite(supply, 0));
  const d = Math.max(0, finite(demand, 0));
  if (d <= s) return 0;
  const denom = s + 1; // floor to avoid divide-by-zero / degenerate ratios
  return ((d - s) / denom) * 100;
}

/**
 * Dual-track price: the administered price governs the planned share of output,
 * the market price the rest. `share` is the dial's `plannedShare` (1 = fully
 * command → administered; 0 = market → market price).
 */
export function dualTrackPrice(administered: number, market: number, share: number): number {
  const a = finite(administered, 0);
  const m = finite(market, a);
  const w = Math.min(1, Math.max(0, finite(share, 0)));
  return a * w + m * (1 - w);
}
