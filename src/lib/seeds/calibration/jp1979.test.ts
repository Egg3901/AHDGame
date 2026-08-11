import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("JP 1979 calibration — Japan 1979 HR (urban opposition vs rural LDP) anchor", () => {
  const leans = deriveRegionLeans("JP", "1979");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("passes the calibration target (loss 0)", () => {
    const r = evaluateCell("JP", "1979")!;
    expect(r.failures).toEqual([]);
    expect(r.loss).toBe(0);
  });

  it("produces a meaningful economic spread (not compressed)", () => {
    const dVals = leans.map((l) => l.economic);
    const spread = Math.max(...dVals) - Math.min(...dVals);
    expect(spread).toBeGreaterThan(0.6);
  });

  it("mean economic lean is near-centered", () => {
    const dVals = leans.map((l) => l.economic);
    const mean = dVals.reduce((a, b) => a + b, 0) / dVals.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.35);
  });

  it("KAN (Tokyo metro) leans left of center", () => {
    expect(byId.KAN.economic).toBeLessThan(0);
  });

  it("KNS (Kansai metro) leans left of center", () => {
    expect(byId.KNS.economic).toBeLessThan(0);
  });

  it("TOH (rural Tohoku) leans right (LDP stronghold)", () => {
    expect(byId.TOH.economic).toBeGreaterThan(0);
  });

  it("SHI (rural Shikoku) leans right (LDP stronghold)", () => {
    expect(byId.SHI.economic).toBeGreaterThan(0);
  });

  it("urban metros are left of every rural region", () => {
    for (const metro of ["KAN", "KNS"]) {
      for (const rural of ["TOH", "SHI", "CGK", "KYU"]) {
        expect(byId[metro].economic).toBeLessThan(byId[rural].economic);
      }
    }
  });

  it("carries real regional variation on the social axis", () => {
    const socials = leans.map((l) => l.social);
    const spread = Math.max(...socials) - Math.min(...socials);
    expect(spread, `social spread ${spread.toFixed(2)} too flat`).toBeGreaterThan(1.0);
    for (const rural of ["TOH", "SHI"]) expect(byId[rural].social).toBeGreaterThan(0);
    for (const metro of ["KAN", "KNS"]) expect(byId[metro].social).toBeLessThan(0);
  });
});
