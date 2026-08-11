export const INDEX_FUND_BID_PREMIUM = 0.02;
export const INDEX_FUND_BID_MAX_OPEN_TURNS = 24;

export function fundBidLimitPriceLocal(executionPriceLocal: number): number {
  return executionPriceLocal * (1 + INDEX_FUND_BID_PREMIUM);
}
