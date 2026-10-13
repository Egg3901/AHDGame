import { describe, it, expect } from "vitest";
import { groupInputCost } from "./inputPricing";
describe("100% market group input pricing", () => {
  it("replaces the public cost for consumed allocated units, without adding another full payment", () => {
    expect(groupInputCost(10, 5, 6, { units: 4, marketFactor: 2 })).toEqual({
      cost: 76,
      groupUnits: 4,
    });
  });
  it("bills actual consumption only, even with a larger reservation", () => {
    expect(groupInputCost(2, 5, 6, { units: 100, marketFactor: 2 })).toEqual({
      cost: 20,
      groupUnits: 2,
    });
    expect(groupInputCost(0, 5, 6, { units: 100, marketFactor: 2 })).toEqual({
      cost: 0,
      groupUnits: 0,
    });
  });
  it("keeps normal procurement unchanged with no valid allocation", () => {
    for (const allocation of [
      undefined,
      { units: Number.NaN, marketFactor: 1 },
      { units: 1, marketFactor: 0 },
    ])
      expect(groupInputCost(10, 5, 6, allocation)).toEqual({ cost: 60, groupUnits: 0 });
  });
});
