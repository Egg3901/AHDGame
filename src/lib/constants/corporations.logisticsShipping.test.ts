import { describe, it, expect } from "vitest";
import {
  LOGISTICS_MAX_SPRAWL_EFFECT,
  LOGISTICS_SHIPPING_DISCOUNT_MAX,
  getLogisticsShippingMultiplier,
} from "./corporations";

describe("getLogisticsShippingMultiplier", () => {
  it("is neutral with no logistics strength or a malformed value", () => {
    expect(getLogisticsShippingMultiplier(0)).toBe(1);
    expect(getLogisticsShippingMultiplier(undefined)).toBe(1);
    expect(getLogisticsShippingMultiplier(null)).toBe(1);
    expect(getLogisticsShippingMultiplier(-50)).toBe(1);
    expect(getLogisticsShippingMultiplier(Number.NaN)).toBe(1);
  });

  it("falls linearly to the maximum discount at the sprawl reference strength", () => {
    expect(getLogisticsShippingMultiplier(LOGISTICS_MAX_SPRAWL_EFFECT / 2)).toBeCloseTo(
      1 - LOGISTICS_SHIPPING_DISCOUNT_MAX / 2,
      10
    );
    expect(getLogisticsShippingMultiplier(LOGISTICS_MAX_SPRAWL_EFFECT)).toBeCloseTo(
      1 - LOGISTICS_SHIPPING_DISCOUNT_MAX,
      10
    );
  });

  it("is flat beyond the reference strength, so shipping can never go free", () => {
    expect(getLogisticsShippingMultiplier(10_000)).toBeCloseTo(
      1 - LOGISTICS_SHIPPING_DISCOUNT_MAX,
      10
    );
    expect(getLogisticsShippingMultiplier(10_000)).toBeGreaterThan(0);
  });

  it("pays off for a corporation under the sprawl threshold", () => {
    expect(getLogisticsShippingMultiplier(40)).toBeLessThan(1);
  });
});
