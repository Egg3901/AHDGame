import { describe, expect, it } from "vitest";
import {
  BOND_POOL_CASH_SKEW_CAP,
  bondPoolAppetiteSkew,
  bondPoolCashSkew,
  quoteBondPrices,
} from "./marketPoolQuotes";

describe("quoteBondPrices", () => {
  it("quotes a symmetric spread around the mid when the pool is at target and appetite is neutral", () => {
    const q = quoteBondPrices({
      marketPrice: 1,
      issuerType: "sovereign",
      cashLocal: 100,
      targetCashLocal: 100,
      appetite: 1,
    });
    expect(q.bid).toBe(0.99);
    expect(q.ask).toBe(1.01);
    expect(q.skew).toBe(0);
  });

  it("uses a wider spread for corporate paper and ignores appetite there", () => {
    const q = quoteBondPrices({
      marketPrice: 1,
      issuerType: "corporation",
      cashLocal: 100,
      targetCashLocal: 100,
      appetite: 0.2,
    });
    expect(q.bid).toBe(0.98);
    expect(q.ask).toBe(1.02);
    expect(q.appetiteSkew).toBe(0);
  });

  it("shifts both sides down when the pool is short of cash", () => {
    const q = quoteBondPrices({
      marketPrice: 1,
      issuerType: "sovereign",
      cashLocal: 0,
      targetCashLocal: 100,
    });
    expect(q.cashSkew).toBe(BOND_POOL_CASH_SKEW_CAP);
    expect(q.bid).toBe(0.96);
    expect(q.ask).toBe(0.98);
  });

  it("discounts a sovereign the demand model has no appetite for", () => {
    const weak = quoteBondPrices({
      marketPrice: 1,
      issuerType: "sovereign",
      cashLocal: 100,
      targetCashLocal: 100,
      appetite: 0.2,
    });
    const strong = quoteBondPrices({
      marketPrice: 1,
      issuerType: "sovereign",
      cashLocal: 100,
      targetCashLocal: 100,
      appetite: 1.5,
    });
    expect(weak.bid).toBeLessThan(strong.bid);
    expect(weak.appetiteSkew).toBeCloseTo(0.04, 10);
    expect(strong.appetiteSkew).toBeCloseTo(-0.01, 10);
  });

  it("never crosses: ask is at least bid", () => {
    const q = quoteBondPrices({
      marketPrice: 0.05,
      issuerType: "corporation",
      cashLocal: 0,
      targetCashLocal: 1,
    });
    expect(q.ask).toBeGreaterThanOrEqual(q.bid);
  });

  it("has no dealer market for a defaulted bond", () => {
    const q = quoteBondPrices({
      marketPrice: 0.1,
      issuerType: "corporation",
      cashLocal: 0,
      targetCashLocal: 100,
      defaulted: true,
    });
    expect(q).toMatchObject({ bid: 0.1, ask: 0.1, skew: 0 });
  });
});

describe("skews", () => {
  it("cash skew is zero without a target", () => {
    expect(bondPoolCashSkew(0, 0)).toBe(0);
  });
  it("appetite skew treats a missing appetite as neutral", () => {
    expect(bondPoolAppetiteSkew(undefined)).toBe(0);
  });
});
