import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("US 1999 calibration — 2000 presidential election anchor", () => {
  const leans = deriveRegionLeans("US", "1999");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const eVals = leans.map((l) => l.economic);
    const spread = Math.max(...eVals) - Math.min(...eVals);
    expect(spread).toBeGreaterThan(2.5);
  });

  it("DC is strongly Democratic", () => {
    // 2026-08 compressed calibration: magnitudes are half-scale by design.
    expect(byId.DC.economic).toBeLessThan(-0.3);
    expect(byId.DC.social).toBeLessThan(-1);
  });

  it("UT is strongly Republican", () => {
    expect(byId.UT.economic).toBeGreaterThan(1);
    expect(byId.UT.social).toBeGreaterThan(0.5);
  });

  it("MA is Democratic-leaning (Gore +27% in 2000)", () => {
    expect(byId.MA.economic).toBeLessThan(-0.1);
  });

  it("AL is Republican-leaning (Bush +15% in 2000)", () => {
    expect(byId.AL.economic).toBeGreaterThan(0.5);
  });

  it("ordering: MA is left of TX", () => {
    expect(byId.MA.economic).toBeLessThan(byId.TX.economic);
  });

  it("ordering: NY is left of WY", () => {
    expect(byId.NY.economic).toBeLessThan(byId.WY.economic);
  });

  it("Gore states are left of Bush states on average", () => {
    const gore = [
      "DC",
      "CA",
      "CT",
      "DE",
      "HI",
      "IA",
      "IL",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MO",
      "NJ",
      "NM",
      "NY",
      "OR",
      "PA",
      "RI",
      "VT",
      "WA",
      "WI",
    ];
    const goreAvg = gore.reduce((s, id) => s + byId[id].economic, 0) / gore.length;

    const bush = [
      "AL",
      "AK",
      "AZ",
      "AR",
      "CO",
      "FL",
      "GA",
      "ID",
      "IN",
      "KS",
      "KY",
      "LA",
      "MS",
      "MT",
      "NE",
      "NV",
      "NH",
      "NC",
      "ND",
      "OH",
      "OK",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VA",
      "WV",
      "WY",
    ];
    const bushAvg = bush.reduce((s, id) => s + byId[id].economic, 0) / bush.length;

    expect(goreAvg).toBeLessThan(bushAvg);
  });

  it("no state is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      const absE = Math.abs(l.economic);
      const absS = Math.abs(l.social);
      expect(absE + absS).toBeGreaterThanOrEqual(0.1);
    }
  });
});
