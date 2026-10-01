export interface RecordedSplit {
  turn: number;
  timestamp?: number;
  oldShares: number;
  newShares: number;
}

/** Issuance is not a split. Only recorded restructures change the price basis. */
export function splitAdjustedPriceChange(
  currentPrice: number,
  previous: { price: number; turn: number; timestamp?: number } | null | undefined,
  splits: readonly RecordedSplit[]
): number {
  if (!previous || ![currentPrice, previous.price].every((n) => Number.isFinite(n) && n > 0))
    return 0;
  let basis = previous.price;
  for (const split of splits) {
    const after =
      split.turn > previous.turn ||
      (split.turn === previous.turn &&
        (split.timestamp == null ||
          previous.timestamp == null ||
          split.timestamp > previous.timestamp));
    if (!after || ![split.oldShares, split.newShares].every((n) => Number.isFinite(n) && n > 0))
      continue;
    basis *= split.oldShares / split.newShares;
  }
  if (!Number.isFinite(basis) || basis <= 0) return 0;
  const change = Math.round((currentPrice / basis - 1) * 10000) / 100;
  return Number.isFinite(change) ? change : 0;
}
