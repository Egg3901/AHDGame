import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("DE 2007 calibration — Germany 2005 Bundestag anchor (grand coalition)", () => {
  const leans = deriveRegionLeans("DE", "2007");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));
  const displays = leans.map((l) => l.display);

  it("mean display lean is near centre (|mean| <= 0.7)", () => {
    const mean = displays.reduce((a, b) => a + b, 0) / displays.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.7);
  });

  it("spread is at least 1.5 (not compressed)", () => {
    const spread = Math.max(...displays) - Math.min(...displays);
    expect(spread).toBeGreaterThanOrEqual(1.5);
  });

  it("HH leans LEFT", () => {
    expect(byId.HH.display).toBeLessThan(0);
  });

  it("BRE leans LEFT", () => {
    expect(byId.BRE.display).toBeLessThan(0);
  });

  it("BE leans LEFT", () => {
    expect(byId.BE.display).toBeLessThan(0);
  });

  it("BY leans RIGHT", () => {
    expect(byId.BY.display).toBeGreaterThan(0);
  });

  it("BW leans RIGHT", () => {
    expect(byId.BW.display).toBeGreaterThan(0);
  });

  it("ordering: Berlin is left of Bavaria", () => {
    expect(byId.BE.display).toBeLessThan(byId.BY.display);
  });

  it("no Land is near zero on both axes (avoids compression)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.12);
    }
  });
});
