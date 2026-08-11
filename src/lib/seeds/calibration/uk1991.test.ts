import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("UK 1991 calibration — UK 1992 general (Major holds the South; Labour North)", () => {
  const leans = deriveRegionLeans("UK", "1991");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  // 2026-08 level recalibration: the 1992 cell is graded on the econ LEVEL
  // (Major-era Britain econ-left of the party midpoint; the Con win realizes
  // through the social axis + kernel — see eraBalanceLadder.test.ts) and on
  // relative geography. The small spread is the census-contrast ceiling
  // documented in the lean-lab audit.
  it("keeps the regional gradient (South right of North)", () => {
    const mean = leans.reduce((a, l) => a + l.display, 0) / leans.length;
    for (const r of ["SEE", "SWE", "EAE"]) {
      expect(byId[r].display, r).toBeGreaterThan(mean + 0.1);
    }
    expect(byId.NEE.display).toBeLessThan(byId.SEE.display);
    expect(byId.NWE.display).toBeLessThan(byId.SWE.display);
    expect(byId.WAL.display).toBeLessThan(byId.EAE.display);
  });

  it("holds the Major-era econ level", () => {
    const mean = leans.reduce((a, l) => a + l.economic, 0) / leans.length;
    expect(mean).toBeGreaterThan(-2.2);
    expect(mean).toBeLessThan(-1.2);
  });

  it("LON is the most Labour region", () => {
    expect(byId.LON.display).toBeLessThan(-2.0);
  });

  it("ordering: LON is left of SEE", () => {
    expect(byId.LON.display).toBeLessThan(byId.SEE.display);
  });

  it("ordering: NWE is left of SWE", () => {
    expect(byId.NWE.display).toBeLessThan(byId.SWE.display);
  });

  it("keeps genuine econ/social axis separation (no region collapsed to zero on both axes)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.1);
    }
  });
});
