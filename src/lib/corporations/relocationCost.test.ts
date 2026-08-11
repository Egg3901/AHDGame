import { describe, it, expect } from "vitest";
import { computeCorpRelocationCost } from "./relocationCost";
import type { Corporation } from "@/lib/db/types";

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    sharePrice: 2,
    totalShares: 1_000_000,
    countryId: "US",
    ...overrides,
  } as Corporation;
}

describe("computeCorpRelocationCost", () => {
  it("in-country: returns marketCap × 7% and crossCountry=false", () => {
    // Pre-forex corp (no liquidCurrencyCode) passes through at rate=1.
    const corp = makeCorp({ sharePrice: 10, totalShares: 1_000_000 });
    const result = computeCorpRelocationCost(corp, "US", 1);
    expect(result.baseMarketCap).toBe(10_000_000);
    expect(result.crossCountry).toBe(false);
    expect(result.cost).toBe(700_000);
  });

  it("cross-country: doubles the cost and flags crossCountry=true", () => {
    const corp = makeCorp({ sharePrice: 10, totalShares: 1_000_000 });
    const result = computeCorpRelocationCost(corp, "UK", 1);
    expect(result.crossCountry).toBe(true);
    expect(result.cost).toBe(1_400_000);
  });

  it("rounds to whole anchor units", () => {
    const corp = makeCorp({ sharePrice: 0.333, totalShares: 1_000 });
    const result = computeCorpRelocationCost(corp, "US", 1);
    expect(Number.isInteger(result.cost)).toBe(true);
  });

  it("zero market cap: returns zero", () => {
    const corp = makeCorp({ sharePrice: 0, totalShares: 0 });
    const result = computeCorpRelocationCost(corp, "US", 1);
    expect(result.cost).toBe(0);
    expect(result.baseMarketCap).toBe(0);
  });

  it("JPY corp: anchor-normalizes sharePrice × totalShares via fxRate", () => {
    // sharePrice 1000 JPY × 10_000 shares = 10_000_000 JPY market cap.
    // At fxRate 100 JPY per 1 ₳: anchor market cap = 100_000 ₳.
    // Corp countryId=JP, target=JP → in-country → 7% of 100_000 = 7_000 ₳.
    const corp = makeCorp({
      sharePrice: 1_000,
      totalShares: 10_000,
      liquidCurrencyCode: "JPY",
      countryId: "JP",
    });
    const result = computeCorpRelocationCost(corp, "JP", 100);
    expect(result.baseMarketCap).toBe(100_000);
    expect(result.cost).toBe(7_000);
  });
});
