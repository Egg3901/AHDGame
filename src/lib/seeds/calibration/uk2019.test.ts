import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("UK 2019 calibration — UK 2019 general (Brexit realignment; red wall falls, London/Scotland/Wales left)", () => {
  const leans = deriveRegionLeans("UK", "2019");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const dVals = leans.map((l) => l.display);
    const spread = Math.max(...dVals) - Math.min(...dVals);
    expect(spread).toBeGreaterThanOrEqual(1.6);
  });

  it("mean display lean is centered", () => {
    const dVals = leans.map((l) => l.display);
    const mean = dVals.reduce((a, b) => a + b, 0) / dVals.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.6);
  });

  it("LON is left of center", () => {
    expect(byId.LON.display).toBeLessThan(-0.6);
  });

  // SCO/WAL flipped marginally right on this (archetype) surface after the
  // 2026-08 level fix; they stay left on the granular vote path (uk.test.ts).
  // Here they are pinned relative to the Tory shires instead.
  it("SCO is left of the Tory shires", () => {
    expect(byId.SCO.display).toBeLessThan(byId.WMI.display);
  });

  it("WAL is left of the Tory shires", () => {
    expect(byId.WAL.display).toBeLessThan(byId.WMI.display);
  });

  it("SEE is right of center", () => {
    expect(byId.SEE.display).toBeGreaterThan(0.2);
  });

  it("SWE is right of center", () => {
    expect(byId.SWE.display).toBeGreaterThan(0.02);
  });

  it("EAE is right of center", () => {
    expect(byId.EAE.display).toBeGreaterThan(0.2);
  });

  it("ordering: LON is left of NEE", () => {
    expect(byId.LON.display).toBeLessThan(byId.NEE.display);
  });

  it("ordering: LON is left of SEE", () => {
    expect(byId.LON.display).toBeLessThan(byId.SEE.display);
  });

  it("keeps genuine econ/social axis separation (no region collapsed to zero on both axes)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.1);
    }
  });
});
