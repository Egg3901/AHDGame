import { describe, it, expect } from "vitest";
import { applyEquityMethodEarnings } from "./equityMethodEarnings";
import type { CrossCorpStockHolding } from "@/lib/corporations/portfolioAnchorValuation";

describe("applyEquityMethodEarnings", () => {
  it("returns base earnings unchanged when there are no cross-holdings", () => {
    const base = new Map([
      ["A", 100_000],
      ["B", 200_000],
    ]);
    const result = applyEquityMethodEarnings(
      base,
      new Map(),
      new Map([
        ["A", 1_000_000],
        ["B", 1_000_000],
      ])
    );
    expect(result.get("A")).toBe(100_000);
    expect(result.get("B")).toBe(200_000);
  });

  it("adds proportional earnings from a holding", () => {
    // Corp A holds 300k of B's 1M shares = 30%
    // B earns 200k → A gets +60k
    const base = new Map([
      ["A", 100_000],
      ["B", 200_000],
    ]);
    const holdings = new Map<string, CrossCorpStockHolding[]>([
      ["A", [{ issuerCorpId: "B", shares: 300_000 }]],
    ]);
    const totalShares = new Map([
      ["A", 1_000_000],
      ["B", 1_000_000],
    ]);
    const result = applyEquityMethodEarnings(base, holdings, totalShares);
    expect(result.get("A")).toBeCloseTo(160_000, 0); // 100k + 0.30 * 200k
    expect(result.get("B")).toBe(200_000); // unchanged
  });

  it("uses BASE earnings for cross-holdings, not the adjusted value (no circularity)", () => {
    // A holds 50% of B, B holds 50% of A.
    // Base: A=100k, B=100k.
    // A adjusted = 100k + 0.5*100k = 150k
    // B adjusted = 100k + 0.5*100k = 150k
    const base = new Map([
      ["A", 100_000],
      ["B", 100_000],
    ]);
    const holdings = new Map<string, CrossCorpStockHolding[]>([
      ["A", [{ issuerCorpId: "B", shares: 500_000 }]],
      ["B", [{ issuerCorpId: "A", shares: 500_000 }]],
    ]);
    const totalShares = new Map([
      ["A", 1_000_000],
      ["B", 1_000_000],
    ]);
    const result = applyEquityMethodEarnings(base, holdings, totalShares);
    expect(result.get("A")).toBeCloseTo(150_000, 0);
    expect(result.get("B")).toBeCloseTo(150_000, 0);
  });

  it("skips a holding when the issuer has 0 total shares (guard)", () => {
    const base = new Map([
      ["A", 100_000],
      ["B", 0],
    ]);
    const holdings = new Map<string, CrossCorpStockHolding[]>([
      ["A", [{ issuerCorpId: "B", shares: 500_000 }]],
    ]);
    const totalShares = new Map([
      ["A", 1_000_000],
      ["B", 0],
    ]);
    const result = applyEquityMethodEarnings(base, holdings, totalShares);
    expect(result.get("A")).toBe(100_000); // no addition since B has 0 shares
  });

  it("handles corps not in baseEarnings map (returns 0 for missing)", () => {
    const base = new Map([["A", 100_000]]);
    const holdings = new Map<string, CrossCorpStockHolding[]>([
      ["A", [{ issuerCorpId: "C", shares: 100_000 }]], // C not in base
    ]);
    const totalShares = new Map([
      ["A", 1_000_000],
      ["C", 1_000_000],
    ]);
    const result = applyEquityMethodEarnings(base, holdings, totalShares);
    expect(result.get("A")).toBe(100_000); // C has 0 base earnings → no change
  });
});
