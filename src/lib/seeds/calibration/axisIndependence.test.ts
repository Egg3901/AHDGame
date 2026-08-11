import { describe, it, expect } from "vitest";
import { axisCorrelation, mixedSignRegions } from "./axisIndependence";

/**
 * Records where two-axis geography actually exists today (#3760). These are
 * characterisation tests: they document the current state so a change that
 * flattens an axis into its partner shows up as a diff rather than passing
 * silently. The UK is the country whose census supports real 2-D structure.
 */
describe("axis independence across regions", () => {
  it("the UK is genuinely two-dimensional", () => {
    const r = axisCorrelation("UK", "1979")!;
    expect(Math.abs(r), `UK 1979 corr ${r.toFixed(2)} — axes collapsed together`).toBeLessThan(0.8);
    expect(mixedSignRegions("UK", "1979").length).toBeGreaterThan(0);
  });

  it("reports a correlation for every seeded country-era it is asked about", () => {
    for (const c of ["UK", "US", "JP"]) {
      expect(axisCorrelation(c, "2019"), `${c} 2019`).not.toBeNull();
    }
  });

  it("Japan's census supports only one axis, so its leans stay correlated", () => {
    // Documented limitation, not an aspiration: across JP's eight regions urban,
    // senior, university and high-income all move together at |r| > 0.85.
    const r = axisCorrelation("JP", "2019")!;
    expect(Math.abs(r)).toBeGreaterThan(0.9);
  });
});
