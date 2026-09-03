import { describe, expect, it } from "vitest";
import { EQUITY_POOL_CASH_SKEW_CAP, quoteEquityPrices } from "./marketPoolQuotes";

describe("quoteEquityPrices", () => {
  it("quotes a two-percent dealer spread at target cash", () => {
    expect(quoteEquityPrices({ marketPrice: 10, cashLocal: 100, targetCashLocal: 100 })).toEqual({
      mid: 10,
      bid: 9.8,
      ask: 10.2,
      halfSpread: 0.02,
      cashSkew: 0,
    });
  });

  it("shifts both sides down when cash is scarce without crossing", () => {
    const quote = quoteEquityPrices({ marketPrice: 10, cashLocal: 0, targetCashLocal: 100 });
    expect(quote.cashSkew).toBe(EQUITY_POOL_CASH_SKEW_CAP);
    expect(quote.bid).toBe(9.5);
    expect(quote.ask).toBe(9.9);
    expect(quote.ask).toBeGreaterThanOrEqual(quote.bid);
  });
});
