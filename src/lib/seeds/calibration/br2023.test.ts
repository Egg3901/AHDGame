import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("BR 2023 calibration — 2022 presidential election anchor (Lula v Bolsonaro)", () => {
  const leans = deriveRegionLeans("BR", "2023");
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
    expect(evaluateCell("BR", "2023")?.loss).toBe(0);
  });

  it("produces a regional display spread of at least 1.3 (not compressed)", () => {
    const d = leans.map((l) => l.display);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThanOrEqual(1.3);
  });

  it("population-weighted center is within 0 ± 0.7", () => {
    const mean = leans.reduce((s, l) => s + l.display, 0) / leans.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.7);
  });

  it("NORDESTE and NORTE are LEFT (Lula's 2022 base)", () => {
    expect(byId.NORDESTE.display).toBeLessThan(0);
    expect(byId.NORTE.display).toBeLessThan(0);
  });

  it("SUL and CENTRO_OESTE are RIGHT (Bolsonaro's 2022 base)", () => {
    expect(byId.SUL.display).toBeGreaterThan(0);
    expect(byId.CENTRO_OESTE.display).toBeGreaterThan(0);
  });

  it("ordering: NORDESTE is left of SUL (entrenched polarization)", () => {
    expect(byId.NORDESTE.display).toBeLessThan(byId.SUL.display);
  });

  it("keeps genuine econ/social axis separation (axes are not clones)", () => {
    const distinct = leans.some((l) => Math.abs(l.economic - l.social) >= 0.3);
    expect(distinct).toBe(true);
  });
});
