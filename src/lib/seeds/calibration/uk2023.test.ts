import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("UK 2023 calibration — UK 2024 general (Labour landslide; SEE/EAE residual Conservative)", () => {
  const leans = deriveRegionLeans("UK", "2023");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const dVals = leans.map((l) => l.display);
    const spread = Math.max(...dVals) - Math.min(...dVals);
    expect(spread).toBeGreaterThanOrEqual(1.8);
  });

  it("mean display lean is centered", () => {
    const dVals = leans.map((l) => l.display);
    const mean = dVals.reduce((a, b) => a + b, 0) / dVals.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.6);
  });

  it("NEE is left of center", () => {
    expect(byId.NEE.display).toBeLessThan(-0.3);
  });

  it("NWE is left of center", () => {
    expect(byId.NWE.display).toBeLessThan(-0.4);
  });

  it("WAL is left of center", () => {
    expect(byId.WAL.display).toBeLessThan(-0.2);
  });

  it("LON is left of center", () => {
    expect(byId.LON.display).toBeLessThan(-0.8);
  });

  it("YHU is left of center", () => {
    expect(byId.YHU.display).toBeLessThan(-0.3);
  });

  it("SEE is right of center", () => {
    expect(byId.SEE.display).toBeGreaterThan(0.3);
  });

  it("EAE is right of center", () => {
    expect(byId.EAE.display).toBeGreaterThan(0.2);
  });

  it("ordering: LON is left of SEE", () => {
    expect(byId.LON.display).toBeLessThan(byId.SEE.display);
  });

  it("ordering: NWE is left of EAE", () => {
    expect(byId.NWE.display).toBeLessThan(byId.EAE.display);
  });

  it("keeps genuine econ/social axis separation (no region collapsed to zero on both axes)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.1);
    }
  });
});
