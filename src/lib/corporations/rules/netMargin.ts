/**
 * Net margin for a plants sector: realized profit over realized revenue, in
 * percent.
 *
 * Pure rules: figures in, percent out. The corporation page rows and the
 * sector detail page both call it, each in its own currency; the ratio does
 * not care which, as long as profit and revenue share one.
 *
 * Why this and not the stored `effectiveProfitMargin`: that one divides by the
 * revenue SOLD units earned, so a sector selling 15% of its output shows a fat
 * margin while it loses money. Profit here already nets the whole bill,
 * unsold output included, so profit over revenue is an ordinary net margin:
 * at most 100%, negative when the sector loses money.
 *
 * It replaced profit over total cost, which ran to four or five figures when
 * upkeep was tiny (a sector with near-free upkeep read as a 134,031% margin).
 *
 * Presentation only. Nothing in the turn reads it back.
 */

/**
 * The figure a sector that sold nothing while still paying its bill reads as.
 * Its true ratio has no finite value; returning null instead would send the
 * callers back to the sold-units margin, which says nothing about a sector
 * that sold nothing.
 */
export const NET_MARGIN_FLOOR_PCT = -999.9;

export function plantsNetMarginPct(args: {
  profit: number;
  revenue: number;
  /** Everything the sector paid this period, unsold output included. */
  totalCost: number;
}): number | null {
  const { profit, revenue, totalCost } = args;
  if (!Number.isFinite(profit) || !Number.isFinite(revenue)) return null;
  if (revenue > 0) return Math.max(NET_MARGIN_FLOOR_PCT, (profit / revenue) * 100);
  return Number.isFinite(totalCost) && totalCost > 0 ? NET_MARGIN_FLOOR_PCT : null;
}
