import { describe, expect, it } from "vitest";
import {
  incomeBaseShares,
  incomeTaxRevenue,
  initializeIncomeTaxRates,
  earnedIncomeTier,
  playerIncomeTax,
  taxablePlayerIncome,
  incomeTaxDebtAnchor,
  playerTaxWalletDebit,
} from "./incomeTaxTiers";

describe("income-tax tiers", () => {
  it("converts new anchor-wallet debits while preserving frozen legacy debit amounts", () => {
    expect(playerTaxWalletDebit(200, 2)).toBe(200);
    expect(playerTaxWalletDebit(200, 2, 1)).toBe(100);
    expect(playerTaxWalletDebit(200, 2, 2)).toBe(200);
    for (const rate of [0, -1, NaN, Infinity])
      expect(() => playerTaxWalletDebit(200, 2, rate)).toThrow();
  });
  it("values unpaid taxes using valid current FX or their frozen quote", () => {
    expect(incomeTaxDebtAnchor(100, 2, 4)).toBe(25);
    for (const rate of [undefined, 0, -1, NaN, Infinity])
      expect(incomeTaxDebtAnchor(100, 2, rate)).toBe(50);
    expect(() => incomeTaxDebtAnchor(100, 0, NaN)).toThrow();
  });
  it.each([0, 0.01, 22, 35, 100])("preserves legacy revenue exactly at %s percent", (rate) => {
    const base = 123456789.123;
    expect(
      incomeTaxRevenue(
        base,
        initializeIncomeTaxRates({ incomeTax: rate }),
        incomeBaseShares({ low: 80, middle: 15, high: 5 })
      )
    ).toBe(base * (rate / 100));
  });
  it("weights earnings rather than headcount and changes only the selected tier", () => {
    const shares = incomeBaseShares({ low: 50, middle: 25, high: 25 });
    expect(shares).toEqual({ low: 0.25, middle: 0.25, high: 0.5 });
    const before = initializeIncomeTaxRates({ incomeTax: 20 });
    const after = { ...before, incomeTaxHigh: 40 };
    expect(incomeTaxRevenue(1000, after, shares) - incomeTaxRevenue(1000, before, shares)).toBe(
      100
    );
    expect(after.incomeTaxLow).toBe(20);
    expect(after.incomeTaxMiddle).toBe(20);
  });
  it("preserves explicitly initialized zero rates on replay", () => {
    expect(initializeIncomeTaxRates({ incomeTax: 22, incomeTaxLow: 0 }).incomeTaxLow).toBe(0);
  });
  it("normalizes empty or invalid census input safely", () => {
    expect(incomeBaseShares({})).toEqual(incomeBaseShares({ low: 30, middle: 50, high: 20 }));
    expect(incomeBaseShares({ low: NaN, middle: 0, high: -1 })).toEqual(incomeBaseShares({}));
  });
  it.each([NaN, Infinity, -1, 101])("rejects malformed tax rates %s", (rate) => {
    expect(() => initializeIncomeTaxRates({ incomeTax: rate })).toThrow();
  });
  it("uses actual annual earnings with exact boundary behavior", () => {
    expect(earnedIncomeTier(749, 1000)).toBe("low");
    expect(earnedIncomeTier(750, 1000)).toBe("middle");
    expect(earnedIncomeTier(1999, 1000)).toBe("middle");
    expect(earnedIncomeTier(2000, 1000)).toBe("high");
    expect(() => earnedIncomeTier(100, 0)).toThrow();
  });
  it("caps combined taxes at income and conserves gross, tax and net", () => {
    expect(playerIncomeTax(101, 90, 30)).toEqual({ gross: 101, federal: 90, regional: 11, net: 0 });
    const tax = playerIncomeTax(1000, 22, 5);
    expect(tax.net + tax.federal + tax.regional).toBe(tax.gross);
  });
  it("taxes earnings and exempts principal, borrowing and transfers", () => {
    for (const type of [
      "corp_salary",
      "corp_dividend",
      "bond_coupon",
      "index_fund_dividend",
      "savings_interest",
    ])
      expect(taxablePlayerIncome(type)).toBe(true);
    for (const type of [
      "bond_maturity",
      "bond_sell",
      "savings_withdrawal",
      "wire_transfer_in",
      "loc_draw",
      "office_income",
      "onboarding_reward",
      "index_fund_redeem",
    ])
      expect(taxablePlayerIncome(type)).toBe(false);
  });
});
