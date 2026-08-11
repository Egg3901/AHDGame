import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("DE 1999 calibration — Germany 1998 Bundestag anchor (Schröder SPD win; East SPD/PDS strong)", () => {
  const leans = deriveRegionLeans("DE", "1999");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));
  const displays = leans.map((l) => l.display);

  it("mean display lean is near centre (|mean| <= 0.7)", () => {
    const mean = displays.reduce((a, b) => a + b, 0) / displays.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.7);
  });

  it("spread is at least 1.6 (not compressed)", () => {
    const spread = Math.max(...displays) - Math.min(...displays);
    expect(spread).toBeGreaterThanOrEqual(1.6);
  });

  it("HH leans LEFT", () => {
    expect(byId.HH.display).toBeLessThan(0);
  });

  it("BRE leans LEFT", () => {
    expect(byId.BRE.display).toBeLessThan(0);
  });

  it("NW leans LEFT", () => {
    expect(byId.NW.display).toBeLessThan(0);
  });

  it("BB leans LEFT", () => {
    expect(byId.BB.display).toBeLessThan(0);
  });

  it("MV leans LEFT", () => {
    expect(byId.MV.display).toBeLessThan(0);
  });

  it("TH leans LEFT", () => {
    expect(byId.TH.display).toBeLessThan(0);
  });

  it("BY leans RIGHT", () => {
    expect(byId.BY.display).toBeGreaterThan(0);
  });

  it("BW leans RIGHT", () => {
    expect(byId.BW.display).toBeGreaterThan(0);
  });

  it("eastern PDS-era Länder are left of Bavaria", () => {
    for (const r of ["BB", "MV", "TH"]) {
      expect(byId[r].display).toBeLessThan(byId.BY.display);
    }
  });

  it("no Land is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.12);
    }
  });
});
