import { describe, expect, it } from "vitest";
import { SECTOR_STRATEGIES, getStrategy } from "./sectorStrategies";

const demandRate = (sector: keyof typeof SECTOR_STRATEGIES, strategy: string) =>
  Object.values(getStrategy(sector, strategy, "1991-default").demand).reduce(
    (sum, rate) => sum + (rate ?? 0),
    0
  );

describe("input-heavy strategy fairness", () => {
  it.each([
    ["manufacturing", "standard", 0.615],
    ["manufacturing", "heavy_metals", 0.7],
    ["healthcare", "biotech", 0.73],
    ["automobiles", "standard", 0.635],
    ["automobiles", "ev", 0.74],
    ["automobiles", "heavy_machinery", 0.74],
    ["defense", "heavy_armor", 0.68],
    ["construction", "standard", 0.5],
    ["construction", "infrastructure", 0.7],
    ["retail", "standard", 0.58],
  ] as const)("keeps %s/%s input rates at the audited ceiling", (sector, strategy, expected) => {
    expect(demandRate(sector, strategy)).toBeCloseTo(expected, 10);
  });

  it("does not change already-healthy benchmark recipes", () => {
    expect(demandRate("technology", "software")).toBeCloseTo(0.25, 10);
    expect(demandRate("financial", "standard")).toBeCloseTo(0.39, 10);
    expect(demandRate("logistics", "standard")).toBeCloseTo(0.59, 10);
    expect(demandRate("extraction", "standard")).toBeCloseTo(0.56, 10);
  });
});
