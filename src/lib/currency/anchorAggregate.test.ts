import { describe, expect, it } from "vitest";
import { sumAsAnchor } from "./anchorAggregate";

describe("sumAsAnchor", () => {
  it("returns 0 for an empty list", () => {
    expect(sumAsAnchor([])).toBe(0);
  });

  it("sums entries from one corp's sectors (single currency, rate=1)", () => {
    // US corp at rate=1: local = anchor, sum is numerically unchanged.
    const entries = [
      { amount: 100, code: "USD", fxRate: 1 },
      { amount: 250, code: "USD", fxRate: 1 },
      { amount: 50, code: "USD", fxRate: 1 },
    ];
    expect(sumAsAnchor(entries)).toBe(400);
  });

  it("normalizes entries from two corps with different currencies to a single anchor total", () => {
    // 100 GBP at rate 2 (GBP per ₳) → 50 ₳
    // 100 JPY at rate 100 (JPY per ₳) → 1 ₳
    // Sum: 51 ₳
    const entries = [
      { amount: 100, code: "GBP", fxRate: 2 },
      { amount: 100, code: "JPY", fxRate: 100 },
    ];
    expect(sumAsAnchor(entries)).toBeCloseTo(51, 5);
  });

  it("treats missing/null/empty currency code as pre-forex passthrough (anchor input)", () => {
    const entries = [
      { amount: 50, code: undefined, fxRate: 123 },
      { amount: 75, code: null, fxRate: 999 },
      { amount: 25, code: "", fxRate: 2 },
    ];
    // All three passthrough → sum as raw anchor values.
    expect(sumAsAnchor(entries)).toBe(150);
  });

  it("falls back to passthrough when rate is non-positive or non-finite", () => {
    const entries = [
      { amount: 100, code: "GBP", fxRate: 0 }, // invalid rate → passthrough 100
      { amount: 200, code: "GBP", fxRate: -1 }, // invalid → passthrough 200
      { amount: 50, code: "GBP", fxRate: Number.NaN }, // invalid → passthrough 50
      { amount: 10, code: "GBP", fxRate: 2 }, // valid → 10/2 = 5
    ];
    expect(sumAsAnchor(entries)).toBe(355);
  });

  it("handles mixed pre-forex + forex-active corps cleanly", () => {
    // Simulates the real pattern: some legacy corps still in ₳, some migrated.
    const entries = [
      { amount: 1000, code: undefined, fxRate: 1 }, // pre-forex → 1000 ₳ passthrough
      { amount: 2000, code: "GBP", fxRate: 2 }, // 2000 GBP @ 2 GBP/₳ → 1000 ₳
      { amount: 50000, code: "JPY", fxRate: 100 }, // 50000 JPY @ 100 JPY/₳ → 500 ₳
    ];
    expect(sumAsAnchor(entries)).toBe(2500);
  });
});
