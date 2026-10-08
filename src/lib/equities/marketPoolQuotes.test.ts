import { describe, expect, it } from "vitest";
import {
  EQUITY_POOL_CASH_SKEW_CAP,
  EQUITY_POOL_HALF_SPREAD,
  quoteEquityPrices,
} from "./marketPoolQuotes";

describe("quoteEquityPrices", () => {
  it("quotes a one-percent dealer half spread at target cash", () => {
    expect(quoteEquityPrices({ marketPrice: 10, cashLocal: 100, targetCashLocal: 100 })).toEqual({
      mid: 10,
      bid: 9.9,
      ask: 10.1,
      halfSpread: 0.01,
      cashSkew: 0,
    });
  });

  it("shifts both sides down when cash is scarce without crossing", () => {
    const quote = quoteEquityPrices({ marketPrice: 10, cashLocal: 0, targetCashLocal: 100 });
    expect(quote.cashSkew).toBe(EQUITY_POOL_CASH_SKEW_CAP);
    expect(quote.bid).toBe(9.6);
    expect(quote.ask).toBe(9.8);
    expect(quote.ask).toBeGreaterThanOrEqual(quote.bid);
  });

  it("keeps the round trip at two half spreads whatever the cash skew", () => {
    for (const cashLocal of [0, 50, 100, 400]) {
      const quote = quoteEquityPrices({ marketPrice: 10, cashLocal, targetCashLocal: 100 });
      expect(quote.ask - quote.bid).toBeCloseTo(10 * 2 * EQUITY_POOL_HALF_SPREAD, 4);
    }
  });

  it("holds the half spread at one percent so a round trip costs about two percent", () => {
    expect(EQUITY_POOL_HALF_SPREAD).toBe(0.01);
  });
});
