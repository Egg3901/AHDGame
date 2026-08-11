import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("US 2007 calibration — 2008 presidential election anchor", () => {
  const leans = deriveRegionLeans("US", "2007");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const eVals = leans.map((l) => l.economic);
    const spread = Math.max(...eVals) - Math.min(...eVals);
    expect(spread).toBeGreaterThan(2.5);
  });

  it("DC is strongly Democratic", () => {
    // 2026-08 compressed calibration: magnitudes are half-scale by design.
    expect(byId.DC.economic).toBeLessThan(-0.4);
    expect(byId.DC.social).toBeLessThan(-1);
  });

  it("UT is strongly Republican", () => {
    expect(byId.UT.economic).toBeGreaterThan(1);
    expect(byId.UT.social).toBeGreaterThan(0.5);
  });

  it("MA is Democratic-leaning (Obama +26% in 2008)", () => {
    // The archetype-path econ surface carries a ~+0.8 right offset vs the
    // granular vote path; MA sits ~0.8 left of the era centre (0.95).
    expect(byId.MA.economic).toBeLessThan(0.3);
  });

  it("AL is Republican-leaning (McCain +21% in 2008)", () => {
    expect(byId.AL.economic).toBeGreaterThan(0.5);
  });

  it("ordering: MA is left of TX", () => {
    expect(byId.MA.economic).toBeLessThan(byId.TX.economic);
  });

  it("ordering: NY is left of WY", () => {
    expect(byId.NY.economic).toBeLessThan(byId.WY.economic);
  });

  it("Obama states are left of McCain states on average", () => {
    const obama = [
      "DC",
      "CA",
      "CO",
      "CT",
      "DE",
      "FL",
      "HI",
      "IA",
      "IL",
      "IN",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MO",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "OH",
      "OR",
      "PA",
      "RI",
      "VT",
      "VA",
      "WA",
      "WI",
    ];
    const obamaAvg = obama.reduce((s, id) => s + byId[id].economic, 0) / obama.length;

    const mccain = [
      "AL",
      "AK",
      "AZ",
      "AR",
      "GA",
      "ID",
      "KS",
      "KY",
      "LA",
      "MS",
      "MT",
      "NE",
      "ND",
      "OK",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "WV",
      "WY",
    ];
    const mccainAvg = mccain.reduce((s, id) => s + byId[id].economic, 0) / mccain.length;

    expect(obamaAvg).toBeLessThan(mccainAvg);
  });

  it("no state is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      const absE = Math.abs(l.economic);
      const absS = Math.abs(l.social);
      expect(absE + absS).toBeGreaterThanOrEqual(0.12);
    }
  });
});
