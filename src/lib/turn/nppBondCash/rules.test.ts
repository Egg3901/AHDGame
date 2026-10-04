import { describe, expect, it } from "vitest";
import { roundedNppBondReturns } from "./rules";

describe("combined NPP bond-return rounding", () => {
  it("preserves the existing cash total while separating coupon and principal", () => {
    const total = 1.004 + 1000.004;
    const result = roundedNppBondReturns(total, 1.004);
    expect(result.total).toBe(Math.round(total * 100) / 100);
    expect(result.couponAnchor).toBe(1);
    expect(result.maturityAnchor).toBeCloseTo(1000.01, 10);
    expect(result.couponAnchor + result.maturityAnchor).toBe(result.total);
  });

  it("uses the actual accumulator rather than regrouping its floating-point inputs", () => {
    const result = roundedNppBondReturns(1.0049999999999997, 0.004);
    expect(result.total).toBe(1);
    expect(result.couponAnchor).toBe(0);
    expect(result.maturityAnchor).toBe(1);
  });
});
