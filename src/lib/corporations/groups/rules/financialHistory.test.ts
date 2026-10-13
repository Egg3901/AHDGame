import { describe, it, expect } from "vitest";
import { groupHistoryInAnchor, combineGroupLatest } from "./financialHistory";
describe("group historical valuation", () => {
  const row = { turn: 10, revenue: 200, totalCosts: 120, income: 80 };
  it("uses the recorded FX and preserves negative income", () => {
    expect(
      groupHistoryInAnchor({ ...row, income: -80, currencyCode: "GBP", fxRateAtWrite: 2 })
    ).toEqual({ turn: 10, revenue: 100, costs: 60, income: -40 });
  });
  it("keeps pre-forex anchor snapshots unchanged", () => {
    expect(groupHistoryInAnchor(row)?.revenue).toBe(200);
  });
  it.each([undefined, 0, -1, NaN, Infinity])("refuses unknown historical FX %s", (rate) => {
    expect(groupHistoryInAnchor({ ...row, currencyCode: "GBP", fxRateAtWrite: rate })).toBeNull();
  });
});

describe("completed-turn group totals", () => {
  const a = { turn: 10, revenue: 200, costs: 100, income: 100 };
  it("combines a common turn", () => {
    expect(combineGroupLatest([a, a])?.income).toBe(200);
  });
  it("does not add private, missing or different-turn results", () => {
    expect(combineGroupLatest([a, null])).toBeNull();
    expect(combineGroupLatest([a, { ...a, turn: 9 }])).toBeNull();
    expect(combineGroupLatest([])).toBeNull();
  });
});
