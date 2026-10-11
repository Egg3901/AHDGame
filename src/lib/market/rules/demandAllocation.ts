/**
 * Shared market demand is not a promise to each producer. normalizedOfferShare
 * apportions a shortage using the same scoped offers that clearing can sell.
 */
export function normalizedOfferShare(
  offer: number,
  totalOffers: number,
  bookSupply: number
): number {
  if (![offer, totalOffers, bookSupply].every(Number.isFinite) || offer <= 0) return 0;
  const denominator = Math.max(totalOffers, bookSupply);
  return denominator > 0 ? Math.min(1, offer / denominator) : 0;
}
