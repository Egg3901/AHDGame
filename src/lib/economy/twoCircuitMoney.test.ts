import { describe, expect, it } from "vitest";
import { WAGE_FUND_SLACK_PP, wageFundConstrainedGrowth } from "./twoCircuitMoney";

const NAN_CASES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("wageFundConstrainedGrowth", () => {
  it("never raises wage growth above the input", () => {
    const cases: Array<[number, number, number]> = [
      [5, 2, 1],
      [10, 3, 0.5],
      [1, 5, 1],
      [8, 8, 0.8],
      [20, 0, 0],
      [20, 0, 1],
    ];
    for (const [wage, goods, share] of cases) {
      const out = wageFundConstrainedGrowth(wage, goods, share);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeLessThanOrEqual(wage);
    }
  });

  it("returns input unchanged when wageGrowth <= goods + WAGE_FUND_SLACK_PP", () => {
    const goods = 3;
    const atCap = goods + WAGE_FUND_SLACK_PP;
    expect(wageFundConstrainedGrowth(atCap, goods, 1)).toBe(atCap);
    expect(wageFundConstrainedGrowth(atCap - 1, goods, 1)).toBe(atCap - 1);
    expect(wageFundConstrainedGrowth(goods, goods, 0.5)).toBe(goods);
  });

  it("pulls fully to the cap when plannedShare = 1 and wage > cap", () => {
    const goods = 4;
    const wage = 20;
    const cap = goods + WAGE_FUND_SLACK_PP;
    expect(wageFundConstrainedGrowth(wage, goods, 1)).toBe(cap);
  });

  it("pulls partially when 0 < plannedShare < 1", () => {
    const goods = 4;
    const wage = 20;
    const cap = goods + WAGE_FUND_SLACK_PP;
    const share = 0.5;
    const out = wageFundConstrainedGrowth(wage, goods, share);
    expect(out).toBeGreaterThan(cap);
    expect(out).toBeLessThan(wage);
    expect(out).toBeCloseTo(wage - share * (wage - cap), 10);
  });

  it("leaves wage unchanged when plannedShare = 0", () => {
    expect(wageFundConstrainedGrowth(25, 2, 0)).toBe(25);
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(wageFundConstrainedGrowth(bad, 3, 1))).toBe(true);
      expect(Number.isFinite(wageFundConstrainedGrowth(10, bad, 1))).toBe(true);
      expect(Number.isFinite(wageFundConstrainedGrowth(10, 3, bad))).toBe(true);
    }
  });
});
