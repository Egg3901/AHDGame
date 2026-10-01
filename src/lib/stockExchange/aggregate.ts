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

export { aggregateExchangeTotals } from "./rules/totals";
