import { describe, expect, it } from "vitest";
import {
  capitalGainsTaxRate,
  initializeCapitalGainsTaxRates,
  taxableStockAmounts,
} from "./capitalGainsTax";
describe("tiered capital gains tax", () => {
  it("initializes independently from each income-tax tier", () => {
    const rates = initializeCapitalGainsTaxRates({
      incomeTax: 20,
      incomeTaxLow: 10,
      incomeTaxMiddle: 25,
      incomeTaxHigh: 40,
    });
    expect(rates).toMatchObject({
      capitalGainsTaxLow: 10,
      capitalGainsTaxMiddle: 25,
      capitalGainsTaxHigh: 40,
    });
    expect(capitalGainsTaxRate({ ...rates, incomeTaxLow: 99 }, "low")).toBe(10);
    expect(capitalGainsTaxRate({ ...rates, capitalGainsTaxLow: 0 }, "low")).toBe(0);
  });
  it("rejects invalid rates and malformed frozen receipts", () => {
    for (const rate of [-1, 101, NaN, Infinity])
      expect(() => capitalGainsTaxRate({ capitalGainsTaxLow: rate }, "low")).toThrow();
    for (const stockTax of [
      null,
      {},
      { version: 1, incomeAmount: 1, capitalAmount: 0, assessmentTurn: 0.5 },
    ])
      expect(() => taxableStockAmounts("stock_trade_sell", 100, stockTax)).toThrow();
    expect(() =>
      taxableStockAmounts("stock_trade_sell", 100, {
        version: 1,
        incomeAmount: 60,
        capitalAmount: 60,
        assessmentTurn: 1,
      })
    ).toThrow("exceeds");
  });
  it("never treats legacy gross stock sale proceeds as income", () => {
    expect(taxableStockAmounts("stock_trade_sell", 10000, undefined)).toEqual({
      income: 0,
      capital: 0,
    });
    expect(taxableStockAmounts("corp_dividend", 100, undefined)).toEqual({
      income: 100,
      capital: 0,
    });
  });
});
