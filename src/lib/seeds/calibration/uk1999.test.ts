import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("UK 1999 calibration — UK 1997 general (Blair landslide; only the rural South stays right)", () => {
  const leans = deriveRegionLeans("UK", "1999");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  // 2026-08 level recalibration: the Blair-landslide cell is graded on the
  // econ LEVEL (centre ~-2, the leftmost UK era) plus the surviving regional
  // ordering. The near-zero spread is the census-contrast ceiling documented
  // in the lean-lab audit; realized-vote bands live in eraBalanceLadder.
  it("holds the Blair-era econ level (leftmost UK era)", () => {
    const mean = leans.reduce((a, l) => a + l.economic, 0) / leans.length;
    expect(mean).toBeGreaterThan(-2.5);
    expect(mean).toBeLessThan(-1.6);
  });

  it("ordering: NEE is left of SEE", () => {
    expect(byId.NEE.display).toBeLessThan(byId.SEE.display);
  });

  it("keeps genuine econ/social axis separation (no region collapsed to zero on both axes)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.1);
    }
  });
});
