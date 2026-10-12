/**
 * Per-product sale price on a multi-output sector (ticket 1507).
 *
 * The money panel's "each unit sold for" figure is revenue / units sold across
 * every output. On a sector that makes two things priced far apart (ordnance
 * and industrial chemicals) that average sits below the dearer product's
 * market price and above the cheaper one's, and reads as though the dear
 * product sold far under market. The clearing pass records each output's
 * share of realized revenue; this splits the sector's revenue by that share
 * and divides by the units of that output that sold.
 *
 * Units sold per output come from the panel's own rows (units made x share of
 * that output sold), rescaled so they add up to the sector's booked sold
 * units. That keeps the result on the same basis as the blended average, so a
 * one-output sector gets exactly the existing average back.
 */
export interface PerProductSaleInput {
  commodity: string;
  /** Units made of this output, on any consistent basis across rows. */
  units: number;
  /** Share of this output that sold last turn (0-1), if known. */
  soldFraction?: number | null;
  /** This output's share of last turn's realized revenue (0-1), if recorded. */
  revenueShare?: number | null;
}

export function perProductSalePrices(args: {
  supplies: readonly PerProductSaleInput[];
  /** Sector revenue for the period (same basis as the blended average). */
  revenue: number | null | undefined;
  /** Units the sector sold for the period, all outputs together. */
  soldUnits: number | null | undefined;
  /** Sector-wide fill, used for a row with no per-output fill yet. */
  fallbackSoldFraction?: number | null;
}): Map<string, number> {
  const out = new Map<string, number>();
  const { supplies, revenue, soldUnits } = args;
  if (supplies.length < 2) return out;
  if (!(typeof revenue === "number" && revenue > 0 && Number.isFinite(revenue))) return out;
  if (!(typeof soldUnits === "number" && soldUnits > 0 && Number.isFinite(soldUnits))) return out;
  // Without a recorded split for every output the per-row prices cannot add
  // back up to revenue, so show none rather than a misleading partial set.
  if (!supplies.every((f) => typeof f.revenueShare === "number" && f.revenueShare >= 0)) return out;

  const soldWeight = supplies.map((f) => {
    const fill = f.soldFraction ?? args.fallbackSoldFraction ?? null;
    if (fill == null || !Number.isFinite(fill) || !Number.isFinite(f.units)) return 0;
    return Math.max(0, f.units) * Math.max(0, Math.min(1, fill));
  });
  const weightSum = soldWeight.reduce((sum, w) => sum + w, 0);
  if (!(weightSum > 0)) return out;

  supplies.forEach((f, i) => {
    const unitsSold = (soldWeight[i]! / weightSum) * soldUnits;
    const share = f.revenueShare as number;
    if (unitsSold > 0 && share > 0) out.set(f.commodity, (revenue * share) / unitsSold);
  });
  return out;
}
