import { describe, expect, it } from "vitest";
import {
  capitalGainsTaxRate,
  dividendStockTaxReceipt,
  initializeCapitalGainsTaxRates,
  taxableStockAmounts,
} from "./capitalGainsTax";
describe("tiered capital gains tax", () => {
  it.each([0.3, 3000000.3, 30000000.3])("bounds floating-point dividend splits at %s", (amount) => {
    const capitalAmount = amount + Number.EPSILON * amount;
    const raw = {
      version: 1,
      assessmentTurn: 1,
      capitalAmount,
      incomeAmount: amount - capitalAmount,
    };
    expect(raw.incomeAmount).toBeLessThan(0);
    expect(dividendStockTaxReceipt(amount, capitalAmount, 1)).toEqual({
      version: 1,
      assessmentTurn: 1,
      capitalAmount: amount,
      incomeAmount: 0,
    });
    expect(taxableStockAmounts("corp_dividend", amount, raw)).toEqual({
      income: 0,
      capital: amount,
      assessmentTurn: 1,
    });
    expect(raw.incomeAmount).toBeLessThan(0);
    expect(() => taxableStockAmounts("stock_trade_sell", amount, raw)).toThrow();
  });
  it("retains ordinary mixed splits and rejects material or malformed allocations", () => {
    expect(dividendStockTaxReceipt(100, 25, 1)).toEqual({
      version: 1,
      assessmentTurn: 1,
      capitalAmount: 25,
      incomeAmount: 75,
    });
    for (const capital of [100.01, -1, NaN, Infinity]) {
      expect(() => dividendStockTaxReceipt(100, capital, 1)).toThrow();
      expect(() =>
        taxableStockAmounts("corp_dividend", 100, {
          version: 1,
          assessmentTurn: 1,
          capitalAmount: capital,
          incomeAmount: 100 - capital,
        })
      ).toThrow();
    }
    for (const override of [{ version: 2 }, { assessmentTurn: 0.5 }, { costBasisAnchor: -1 }]) {
      expect(() =>
        taxableStockAmounts("corp_dividend", 0.3, {
          version: 1,
          assessmentTurn: 1,
          capitalAmount: 0.1 + 0.2,
          incomeAmount: 0.3 - (0.1 + 0.2),
          ...override,
        })
      ).toThrow();
    }
  });

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
