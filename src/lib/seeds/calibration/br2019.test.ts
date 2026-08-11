import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("BR 2019 calibration — 2018 presidential election anchor (Bolsonaro realignment)", () => {
  const leans = deriveRegionLeans("BR", "2019");
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
    expect(evaluateCell("BR", "2019")?.loss).toBe(0);
  });

  it("produces a regional display spread of at least 1.3 (not compressed)", () => {
    const d = leans.map((l) => l.display);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThanOrEqual(1.3);
  });

  it("population-weighted center is within 0 ± 0.7", () => {
    const mean = leans.reduce((s, l) => s + l.display, 0) / leans.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.7);
  });

  it("NORDESTE is LEFT (Haddad 72.6% in the 2018 runoff)", () => {
    expect(byId.NORDESTE.display).toBeLessThan(0);
    expect(byId.NORDESTE.economic).toBeLessThan(0);
  });

  it("SUL is RIGHT (Bolsonaro ~76% in the 2018 runoff)", () => {
    expect(byId.SUL.display).toBeGreaterThan(0);
  });

  it("CENTRO_OESTE is RIGHT (Bolsonaro ~73%; agribusiness frontier)", () => {
    expect(byId.CENTRO_OESTE.display).toBeGreaterThan(0);
  });

  it("ordering: NORDESTE left of SUDESTE left of SUL", () => {
    expect(byId.NORDESTE.display).toBeLessThan(byId.SUDESTE.display);
    expect(byId.SUDESTE.display).toBeLessThan(byId.SUL.display);
  });

  it("Nordeste left lean is economic, not social (transfer politics, not progressivism)", () => {
    expect(byId.NORDESTE.economic).toBeLessThan(0);
    expect(byId.NORDESTE.social).toBeGreaterThan(byId.NORDESTE.economic);
  });

  it("keeps genuine econ/social axis separation (axes are not clones)", () => {
    const distinct = leans.some((l) => Math.abs(l.economic - l.social) >= 0.3);
    expect(distinct).toBe(true);
  });
});
