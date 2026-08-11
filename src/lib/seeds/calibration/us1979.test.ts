import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("US 1979 calibration — 1980 presidential election anchor", () => {
  const leans = deriveRegionLeans("US", "1979");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const eVals = leans.map((l) => l.economic);
    const spread = Math.max(...eVals) - Math.min(...eVals);
    expect(spread).toBeGreaterThan(2.8); // target: meaningful spread on -5..5 scale
  });

  it("DC is strongly Democratic", () => {
    expect(byId.DC.economic).toBeLessThan(-1);
    expect(byId.DC.social).toBeLessThan(-1);
  });

  it("UT is strongly Republican", () => {
    expect(byId.UT.economic).toBeGreaterThan(1);
    expect(byId.UT.social).toBeGreaterThan(1);
  });

  it("MA is Democratic-leaning (Carter +2% in 1980)", () => {
    expect(byId.MA.economic).toBeLessThan(-0.3);
  });

  it("AL is Republican-leaning (Reagan +12% in 1980)", () => {
    expect(byId.AL.economic).toBeGreaterThan(0.5);
  });

  it("ordering: MA is left of TX", () => {
    expect(byId.MA.economic).toBeLessThan(byId.TX.economic);
  });

  it("ordering: NY is left of WY", () => {
    expect(byId.NY.economic).toBeLessThan(byId.WY.economic);
  });

  it("Carter states are left of Reagan states on average", () => {
    // Carter 1980: DC, GA, WV, MN, MD, RI, HI
    const carter = ["DC", "GA", "WV", "MN", "MD", "RI", "HI"];
    const carterAvg = carter.reduce((s, id) => s + byId[id].economic, 0) / carter.length;

    // Reagan 1980: all other states (sample a few)
    const reagan = ["UT", "ID", "WY", "NE", "KS", "AK", "AL", "TX"];
    const reaganAvg = reagan.reduce((s, id) => s + byId[id].economic, 0) / reagan.length;

    expect(carterAvg).toBeLessThan(reaganAvg);
    expect(carterAvg).toBeLessThan(-0.2); // Carter states lean left overall
    expect(reaganAvg).toBeGreaterThan(0.3); // Reagan states lean right overall
  });

  it("no state is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      const absE = Math.abs(l.economic);
      const absS = Math.abs(l.social);
      // At least one axis should have meaningful magnitude
      // Swing states in 1980 (ME, OR, MI) can be near zero on one axis
      expect(absE + absS).toBeGreaterThanOrEqual(0.12);
    }
  });
});
