import { describe, expect, it } from "vitest";
import { NET_MARGIN_FLOOR_PCT, plantsNetMarginPct } from "./netMargin";

describe("plantsNetMarginPct", () => {
  it("is profit over revenue", () => {
    expect(plantsNetMarginPct({ profit: 150, revenue: 1000, totalCost: 850 })).toBeCloseTo(15, 9);
  });

  it("stays under 100% when upkeep is tiny, where profit over cost ran away", () => {
    // Profit over cost here would be 134,031%.
    const pct = plantsNetMarginPct({ profit: 41_200, revenue: 41_230.74, totalCost: 30.74 });
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(100);
    expect(pct!).toBeGreaterThan(99);
  });

  it("is negative when the sector loses money", () => {
    expect(plantsNetMarginPct({ profit: -300, revenue: 1000, totalCost: 1300 })).toBeCloseTo(
      -30,
      9
    );
  });

  it("floors a sector that sold nothing but still paid its bill", () => {
    expect(plantsNetMarginPct({ profit: -850, revenue: 0, totalCost: 850 })).toBe(
      NET_MARGIN_FLOOR_PCT
    );
  });

  it("floors a tiny sale against a large bill instead of printing five figures", () => {
    expect(plantsNetMarginPct({ profit: -10_000, revenue: 1, totalCost: 10_001 })).toBe(
      NET_MARGIN_FLOOR_PCT
    );
  });

  it("has no figure for a sector with no revenue and no costs", () => {
    expect(plantsNetMarginPct({ profit: 0, revenue: 0, totalCost: 0 })).toBeNull();
  });

  it("has no figure when an input is not a number", () => {
    expect(plantsNetMarginPct({ profit: Number.NaN, revenue: 10, totalCost: 5 })).toBeNull();
  });
});
