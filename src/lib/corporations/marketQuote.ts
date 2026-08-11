import { DEFAULT_SHARE_PRICE } from "@/lib/constants/corporations";

/** Minimal corporation fields needed to resolve a share price. */
export type CorpQuoteSlice = {
  sharePrice?: number;
};

/**
 * Returns the share price for exchange listings and market-facing UIs.
 */
export function getPublicShareQuote(corp: CorpQuoteSlice): number {
  return corp.sharePrice ?? DEFAULT_SHARE_PRICE;
}

export function getRoundedPublicMarketCap(corp: CorpQuoteSlice, totalShares: number): number {
  return Math.round(getPublicShareQuote(corp) * totalShares);
}
