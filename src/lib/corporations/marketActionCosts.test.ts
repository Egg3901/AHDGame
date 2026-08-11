import { describe, expect, it } from "vitest";
import {
  calculateAttackCostAnchor,
  calculateAttackCostFromLocalRevenue,
  calculateSplitCostAnchor,
  calculateSplitMsCost,
} from "./marketActionCosts";

describe("marketActionCosts", () => {
  it("calculates attack cost from anchor revenue", () => {
    expect(calculateAttackCostAnchor(1_050_000)).toBe(105_000);
  });

  it("normalizes local-currency revenue before calculating attack cost", () => {
    expect(calculateAttackCostFromLocalRevenue(13_300, "JPY", 133)).toBe(10);
    expect(calculateAttackCostFromLocalRevenue(750, "GBP", 0.75)).toBe(100);
  });

  it("calculates split cost from anchor unowned revenue", () => {
    expect(calculateSplitCostAnchor(4_280_000)).toBe(214_000);
  });

  it("escalates marketing strength costs by split count", () => {
    expect(calculateSplitMsCost(undefined)).toBe(1);
    expect(calculateSplitMsCost(0)).toBe(1);
    expect(calculateSplitMsCost(1)).toBe(2);
    expect(calculateSplitMsCost(4)).toBe(16);
  });
});
