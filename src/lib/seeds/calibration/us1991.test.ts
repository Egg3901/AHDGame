import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("US 1991 calibration — 1992 presidential election anchor", () => {
  const leans = deriveRegionLeans("US", "1991");
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

  it("MA is Democratic-leaning (Clinton +8% in 1992)", () => {
    expect(byId.MA.economic).toBeLessThan(-0.3);
  });

  it("AL is Republican-leaning (Bush +8% in 1992)", () => {
    expect(byId.AL.economic).toBeGreaterThan(0.5);
  });

  it("ordering: MA is left of TX", () => {
    expect(byId.MA.economic).toBeLessThan(byId.TX.economic);
  });

  it("ordering: NY is left of WY", () => {
    expect(byId.NY.economic).toBeLessThan(byId.WY.economic);
  });

  it("Clinton states are left of Bush states on average", () => {
    // Clinton 1992: DC, AR, CA, CT, DE, GA, HI, IA, IL, KY, LA, ME, MD, MA, MI, MN, MO, MT, NV, NH, NJ, NM, NY, NC, OH, OR, PA, RI, TN, VT, WA, WV, WI
    const clinton = [
      "DC",
      "AR",
      "CA",
      "CT",
      "DE",
      "GA",
      "HI",
      "IA",
      "IL",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MO",
      "MT",
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
      "TN",
      "VT",
      "WA",
      "WV",
      "WI",
    ];
    const clintonAvg = clinton.reduce((s, id) => s + byId[id].economic, 0) / clinton.length;

    const bush = [
      "AL",
      "AK",
      "AZ",
      "CO",
      "FL",
      "ID",
      "IN",
      "KS",
      "MS",
      "NE",
      "ND",
      "OK",
      "SC",
      "SD",
      "TX",
      "UT",
      "VA",
      "WY",
    ];
    const bushAvg = bush.reduce((s, id) => s + byId[id].economic, 0) / bush.length;

    expect(clintonAvg).toBeLessThan(bushAvg);
    expect(clintonAvg).toBeLessThan(-0.1);
    expect(bushAvg).toBeGreaterThan(0.2);
  });

  it("no state is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      const absE = Math.abs(l.economic);
      const absS = Math.abs(l.social);
      expect(absE + absS).toBeGreaterThanOrEqual(0.12);
    }
  });
});
