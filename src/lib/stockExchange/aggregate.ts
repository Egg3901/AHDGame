/**
 * Totals across a set of exchange listings.
 *
 * ALWAYS on the anchor fields. `marketCap`, `totalRevenue` and `income` are each
 * denominated in that corporation's own `liquidCurrencyCode`, so summing them
 * adds currencies together. The anchor siblings exist for exactly this reason
 * (see stockExchangeSnapshot.ts). The NYSE genuinely carries both USD and GBP
 * listings, so its raw total was a literal cross-currency addition, and the
 * Nikkei's raw total came to 445x its anchored total at turn 364.
 *
 * A present anchor of 0 is a real value (a worthless listing), not a missing
 * one, so the fallback tests for presence rather than truthiness.
 */
export interface ExchangeListingSlice {
  marketCap?: number;
  marketCapAnchor?: number;
  totalRevenue?: number;
  totalRevenueAnchor?: number;
  income?: number;
  incomeAnchor?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  priceChange48h?: number;
}

export interface ExchangeTotals {
  marketCap: number;
  revenue: number;
  income: number;
  weightedChange1h: number;
  weightedChange24h: number;
  weightedChange48h: number;
}

const finite = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Anchor if present and finite, else the local figure, else 0. */
const anchored = (anchor: number | undefined, local: number | undefined): number =>
  finite(anchor) ?? finite(local) ?? 0;

export function aggregateExchangeTotals(listings: ExchangeListingSlice[]): ExchangeTotals {
  let marketCap = 0;
  let revenue = 0;
  let income = 0;
  let weighted1h = 0;
  let weighted24h = 0;
  let weighted48h = 0;

  for (const listing of listings) {
    const cap = anchored(listing.marketCapAnchor, listing.marketCap);
    marketCap += cap;
    revenue += anchored(listing.totalRevenueAnchor, listing.totalRevenue);
    income += anchored(listing.incomeAnchor, listing.income);
    weighted1h += (finite(listing.priceChange1h) ?? 0) * cap;
    weighted24h += (finite(listing.priceChange24h) ?? 0) * cap;
    weighted48h += (finite(listing.priceChange48h) ?? 0) * cap;
  }

  if (marketCap <= 0) {
    return {
      marketCap,
      revenue,
      income,
      weightedChange1h: 0,
      weightedChange24h: 0,
      weightedChange48h: 0,
    };
  }

  return {
    marketCap,
    revenue,
    income,
    weightedChange1h: weighted1h / marketCap,
    weightedChange24h: weighted24h / marketCap,
    weightedChange48h: weighted48h / marketCap,
  };
}
