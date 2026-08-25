import { describe, expect, it } from "vitest";
import { liveNationalGdpUnits, resolveRatioGdp } from "./gdpDenominator";

describe("resolveRatioGdp", () => {
  it("prefers gdpSmoothed", () => {
    expect(resolveRatioGdp({ gdp: 1000, gdpSmoothed: 900 })).toBe(900);
  });

  it("falls back to raw gdp when smoothed is absent", () => {
    expect(resolveRatioGdp({ gdp: 1000 })).toBe(1000);
  });

  it("falls back to raw gdp when smoothed is zero or negative", () => {
    expect(resolveRatioGdp({ gdp: 1000, gdpSmoothed: 0 })).toBe(1000);
    expect(resolveRatioGdp({ gdp: 1000, gdpSmoothed: -5 })).toBe(1000);
  });

  it("falls back to raw gdp when smoothed is non-finite", () => {
    expect(resolveRatioGdp({ gdp: 1000, gdpSmoothed: Number.NaN })).toBe(1000);
  });

  it("returns 0 when nothing usable is present", () => {
    expect(resolveRatioGdp({})).toBe(0);
    expect(resolveRatioGdp({ gdp: 0 })).toBe(0);
    expect(resolveRatioGdp({ gdp: -5 })).toBe(0);
  });
});

describe("liveNationalGdpUnits", () => {
  it("sums regional millions into base currency units", () => {
    expect(liveNationalGdpUnits([{ gdp: 1000 }, { gdp: 500 }])).toBe(1_500_000_000);
  });

  it("treats a missing regional gdp as zero", () => {
    expect(liveNationalGdpUnits([{}, { gdp: 2 }])).toBe(2_000_000);
  });

  it("treats a non-finite regional gdp as zero rather than propagating NaN", () => {
    expect(liveNationalGdpUnits([{ gdp: Number.NaN }, { gdp: 2 }])).toBe(2_000_000);
  });

  it("returns 0 for no regions", () => {
    expect(liveNationalGdpUnits([])).toBe(0);
  });
});
