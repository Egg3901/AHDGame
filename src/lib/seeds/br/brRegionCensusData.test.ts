import { describe, it, expect } from "vitest";
import { brRegionCensusData } from "./brRegionCensusData";
import { brRegionCensusData1991 } from "./brRegionCensusData1991";
import { brRegions } from "./brRegions";

const DIMS = {
  ethnicity: ["branco", "pardo", "preto", "amarelo", "indigena"],
  age: ["young", "mid", "mature", "senior"],
  education: ["fundamental", "medio", "superior"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("brRegionCensusData (2019)", () => {
  it("has one profile per seeded BR region", () => {
    expect(new Set(Object.keys(brRegionCensusData))).toEqual(new Set(brRegions.map((r) => r._id)));
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(brRegionCensusData)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is more schooled and more urban than the 1991 profiles", () => {
    for (const id of Object.keys(brRegionCensusData)) {
      expect(
        brRegionCensusData[id].education.superior,
        `${id} superior 2019 > 1991`
      ).toBeGreaterThan(brRegionCensusData1991[id].education.superior);
      expect(brRegionCensusData[id].urbanization.urban, `${id} urban 2019 > 1991`).toBeGreaterThan(
        brRegionCensusData1991[id].urbanization.urban
      );
    }
  });

  it("keeps the South the most branco region", () => {
    const branco = Object.values(brRegionCensusData).map((p) => p.ethnicity.branco);
    expect(brRegionCensusData.SUL.ethnicity.branco).toBe(Math.max(...branco));
  });
});
