import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("BR 1999 calibration — 1998 presidential election anchor (Cardoso 2nd term)", () => {
  const leans = deriveRegionLeans("BR", "1999");
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
    expect(evaluateCell("BR", "1999")?.loss).toBe(0);
  });

  it("produces a regional display spread of at least 1.0 (not compressed)", () => {
    const d = leans.map((l) => l.display);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThanOrEqual(1.0);
  });

  it("population-weighted center is within 0 ± 0.8", () => {
    const mean = leans.reduce((s, l) => s + l.display, 0) / leans.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.8);
  });

  it("NORDESTE is economically left (nascent PT base)", () => {
    expect(byId.NORDESTE.economic).toBeLessThan(0);
  });

  it("SUL is right of NORDESTE and NORTE", () => {
    expect(byId.SUL.display).toBeGreaterThan(byId.NORDESTE.display);
    expect(byId.SUL.display).toBeGreaterThan(byId.NORTE.display);
  });

  it("keeps genuine econ/social axis separation (axes are not clones)", () => {
    const distinct = leans.some((l) => Math.abs(l.economic - l.social) >= 0.3);
    expect(distinct).toBe(true);
  });
});
