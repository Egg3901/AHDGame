import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("BR 2007 calibration — 2006 presidential election anchor (Lula commodity boom)", () => {
  const leans = deriveRegionLeans("BR", "2007");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("covers all five macro-regions", () => {
    expect(Object.keys(byId).sort()).toEqual([
      "CENTRO_OESTE",
      "NORDESTE",
      "NORTE",
      "SUDESTE",
      "SUL",
    ]);
  });

  it("calibration cell passes (loss 0)", () => {
    expect(evaluateCell("BR", "2007")?.loss).toBe(0);
  });

  it("produces a regional display spread of at least 1.2 (not compressed)", () => {
    const d = leans.map((l) => l.display);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThanOrEqual(1.2);
  });

  it("population-weighted center is within 0 ± 0.7", () => {
    const mean = leans.reduce((s, l) => s + l.display, 0) / leans.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.7);
  });

  it("NORDESTE is LEFT (Bolsa Família epicenter)", () => {
    expect(byId.NORDESTE.display).toBeLessThan(0);
    expect(byId.NORDESTE.economic).toBeLessThan(0);
  });

  it("SUL is RIGHT (PT losing ground; PSDB/Alckmin base)", () => {
    expect(byId.SUL.display).toBeGreaterThan(0);
  });

  it("ordering: NORDESTE is left of SUL", () => {
    expect(byId.NORDESTE.display).toBeLessThan(byId.SUL.display);
  });

  it("Nordeste left lean is economic, not social (transfers, not progressivism)", () => {
    expect(byId.NORDESTE.economic).toBeLessThan(byId.NORDESTE.social);
  });

  it("keeps genuine econ/social axis separation (axes are not clones)", () => {
    const distinct = leans.some((l) => Math.abs(l.economic - l.social) >= 0.3);
    expect(distinct).toBe(true);
  });
});
