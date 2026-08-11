import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("US 2019 calibration — 2020 presidential election anchor", () => {
  const leans = deriveRegionLeans("US", "2019");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const eVals = leans.map((l) => l.economic);
    const spread = Math.max(...eVals) - Math.min(...eVals);
    expect(spread).toBeGreaterThan(2.5);
  });

  it("DC is strongly Democratic", () => {
    expect(byId.DC.economic).toBeLessThan(-1);
    expect(byId.DC.social).toBeLessThan(-1);
  });

  it("UT is strongly Republican", () => {
    expect(byId.UT.economic).toBeGreaterThan(1);
    expect(byId.UT.social).toBeGreaterThan(0.5);
  });

  it("MA is Democratic-leaning (Biden +33% in 2020)", () => {
    expect(byId.MA.economic).toBeLessThan(-0.5);
  });

  it("AL is Republican-leaning (Trump +25% in 2020)", () => {
    expect(byId.AL.economic).toBeGreaterThan(0.5);
  });

  it("ordering: MA is left of TX", () => {
    expect(byId.MA.economic).toBeLessThan(byId.TX.economic);
  });

  it("ordering: NY is left of WY", () => {
    expect(byId.NY.economic).toBeLessThan(byId.WY.economic);
  });

  it("Biden states are left of Trump states on average", () => {
    const biden = [
      "DC",
      "CA",
      "CO",
      "CT",
      "DE",
      "GA",
      "HI",
      "IL",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "OR",
      "PA",
      "RI",
      "VT",
      "VA",
      "WA",
      "WI",
      "AZ",
    ];
    const bidenAvg = biden.reduce((s, id) => s + byId[id].economic, 0) / biden.length;

    const trump = [
      "AL",
      "AK",
      "AR",
      "FL",
      "ID",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "MS",
      "MO",
      "MT",
      "NE",
      "NC",
      "ND",
      "OH",
      "OK",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "WV",
      "WY",
    ];
    const trumpAvg = trump.reduce((s, id) => s + byId[id].economic, 0) / trump.length;

    expect(bidenAvg).toBeLessThan(trumpAvg);
  });

  it("no state is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      const absE = Math.abs(l.economic);
      const absS = Math.abs(l.social);
      expect(absE + absS).toBeGreaterThanOrEqual(0.12);
    }
  });
});
