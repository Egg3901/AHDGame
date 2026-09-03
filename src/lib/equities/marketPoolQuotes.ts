/** Dealer half-spread around the turn-priced equity fair value. */
export const EQUITY_POOL_HALF_SPREAD = 0.02;
/** How strongly a cash shortfall moves both sides of the quote down. */
export const EQUITY_POOL_CASH_SKEW_RATE = 0.05;
/** Maximum quote movement caused by the pool's cash position. */
export const EQUITY_POOL_CASH_SKEW_CAP = 0.03;

export interface EquityPoolQuote {
  mid: number;
  bid: number;
  ask: number;
  halfSpread: number;
  cashSkew: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function equityPoolCashSkew(cashLocal: number, targetCashLocal: number): number {
  if (!(targetCashLocal > 0)) return 0;
  const cash = Number.isFinite(cashLocal) && cashLocal > 0 ? cashLocal : 0;
  const shortfallShare = clamp((targetCashLocal - cash) / targetCashLocal, -1, 1);
  return clamp(
    shortfallShare * EQUITY_POOL_CASH_SKEW_RATE,
    -EQUITY_POOL_CASH_SKEW_CAP,
    EQUITY_POOL_CASH_SKEW_CAP
  );
}

export function quoteEquityPrices(input: {
  marketPrice: number;
  cashLocal: number;
  targetCashLocal: number;
}): EquityPoolQuote {
  const mid = Number.isFinite(input.marketPrice) && input.marketPrice > 0 ? input.marketPrice : 0;
  if (mid <= 0) return { mid, bid: mid, ask: mid, halfSpread: 0, cashSkew: 0 };
  const cashSkew = equityPoolCashSkew(input.cashLocal, input.targetCashLocal);
  const bid = round4(Math.max(0.0001, mid * (1 - EQUITY_POOL_HALF_SPREAD - cashSkew)));
  const ask = round4(Math.max(bid, mid * (1 + EQUITY_POOL_HALF_SPREAD - cashSkew)));
  return { mid, bid, ask, halfSpread: EQUITY_POOL_HALF_SPREAD, cashSkew };
}
