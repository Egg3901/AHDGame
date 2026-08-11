import { describe, it, expect } from "vitest";
import { brRegionCensusData1991 } from "./brRegionCensusData1991";
import { brRegions } from "./brRegions";

const REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];

const DIMS = {
  ethnicity: ["branco", "pardo", "preto", "amarelo", "indigena"],
  age: ["young", "mid", "mature", "senior"],
  education: ["fundamental", "medio", "superior"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("brRegionCensusData1991", () => {
  it("has one profile per macro-region", () => {
    expect(new Set(Object.keys(brRegionCensusData1991))).toEqual(new Set(REGIONS));
  });

  it("matches the seeded BR region id set", () => {
    expect(new Set(Object.keys(brRegionCensusData1991))).toEqual(
      new Set(brRegions.map((r) => r._id))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(brRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("Sul is the whitest region; Norte has the highest indígena share", () => {
    const branco = Object.values(brRegionCensusData1991).map((p) => p.ethnicity.branco);
    expect(brRegionCensusData1991.SUL.ethnicity.branco).toBe(Math.max(...branco));
    const indigena = Object.values(brRegionCensusData1991).map((p) => p.ethnicity.indigena);
    expect(brRegionCensusData1991.NORTE.ethnicity.indigena).toBe(Math.max(...indigena));
  });

  it("Sudeste is more urban than Norte; tertiary attainment is low (1991)", () => {
    expect(brRegionCensusData1991.SUDESTE.urbanization.urban).toBeGreaterThan(
      brRegionCensusData1991.NORTE.urbanization.urban
    );
    for (const [id, p] of Object.entries(brRegionCensusData1991)) {
      expect(p.education.superior, `${id} superior`).toBeLessThanOrEqual(10);
    }
  });
});
