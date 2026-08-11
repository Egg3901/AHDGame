import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { evaluateCell } from "./evaluate";

describe("IE 1999 calibration — Ireland 1997 Dáil election anchor", () => {
  const leans = deriveRegionLeans("IE", "1999");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("covers all 8 IE regions", () => {
    expect(leans).toHaveLength(8);
    for (const id of ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"]) {
      expect(byId[id]).toBeDefined();
    }
  });

  it("center: mean display lean within target tolerance (0 ± 0.8)", () => {
    const mean = leans.reduce((s, l) => s + l.display, 0) / leans.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.8);
  });

  it("spread: display leans not compressed (max − min ≥ 1.0)", () => {
    const d = leans.map((l) => l.display);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThanOrEqual(1.0);
  });

  it("DUB (urban left anchor) derives display LEFT of 0", () => {
    expect(byId.DUB.display).toBeLessThan(0);
  });

  it("ordering: DUB is left of rural DON", () => {
    expect(byId.DUB.display).toBeLessThan(byId.DON.display);
  });

  it("genuine axis separation: econ and social axes are not collapsed", () => {
    // At least one region must have the two axes meaningfully apart —
    // guards against authoring positions where social simply mirrors econ.
    const maxGap = Math.max(...leans.map((l) => Math.abs(l.economic - l.social)));
    expect(maxGap).toBeGreaterThanOrEqual(0.3);
  });

  it("calibration cell reports zero loss", () => {
    const cell = evaluateCell("IE", "1999");
    expect(cell).not.toBeNull();
    expect(cell!.failures).toEqual([]);
    expect(cell!.loss).toBe(0);
  });
});
