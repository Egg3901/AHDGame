import { describe, it, expect } from "vitest";
import {
  getEffectiveRate,
  getRateScale,
  CREDIT_RATING_SPREADS,
  CREDIT_RATINGS,
} from "./centralBank";

describe("getEffectiveRate", () => {
  it("returns prime + spread for each rating", () => {
    expect(getEffectiveRate(2.5, "AAA")).toBe(2.5);
    expect(getEffectiveRate(2.5, "AA")).toBe(3.0);
    expect(getEffectiveRate(2.5, "A")).toBe(4.0);
    expect(getEffectiveRate(2.5, "BBB")).toBe(5.5);
    expect(getEffectiveRate(2.5, "BB")).toBe(7.5);
    expect(getEffectiveRate(2.5, "B")).toBe(10.5);
    expect(getEffectiveRate(2.5, "CCC")).toBe(14.5);
  });

  it("handles 0% prime rate", () => {
    expect(getEffectiveRate(0, "AAA")).toBe(0);
    expect(getEffectiveRate(0, "CCC")).toBe(12);
  });

  it("handles 25% prime rate", () => {
    expect(getEffectiveRate(25, "AAA")).toBe(25);
    expect(getEffectiveRate(25, "CCC")).toBe(37);
  });

  it("handles fractional rates without floating point errors", () => {
    expect(getEffectiveRate(2.75, "AA")).toBe(3.25);
    expect(getEffectiveRate(3.25, "A")).toBe(4.75);
  });
});

describe("getRateScale", () => {
  it("returns all 7 credit tiers", () => {
    const scale = getRateScale(2.5);
    expect(Object.keys(scale)).toHaveLength(7);
    for (const rating of CREDIT_RATINGS) {
      expect(scale[rating]).toBeDefined();
    }
  });

  it("produces correct values matching getEffectiveRate", () => {
    const prime = 3.0;
    const scale = getRateScale(prime);
    for (const rating of CREDIT_RATINGS) {
      expect(scale[rating]).toBe(getEffectiveRate(prime, rating));
    }
  });

  it("rates increase monotonically from AAA to CCC", () => {
    const scale = getRateScale(2.0);
    for (let i = 1; i < CREDIT_RATINGS.length; i++) {
      expect(scale[CREDIT_RATINGS[i]]).toBeGreaterThan(scale[CREDIT_RATINGS[i - 1]]);
    }
  });
});

describe("CREDIT_RATING_SPREADS", () => {
  it("AAA has zero spread", () => {
    expect(CREDIT_RATING_SPREADS.AAA).toBe(0);
  });

  it("spreads increase from AAA to CCC", () => {
    const spreads = CREDIT_RATINGS.map((r) => CREDIT_RATING_SPREADS[r]);
    for (let i = 1; i < spreads.length; i++) {
      expect(spreads[i]).toBeGreaterThan(spreads[i - 1]);
    }
  });
});
