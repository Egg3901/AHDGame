import { describe, it, expect } from "vitest";
import { jpRegionCensusData2027 } from "./jpRegionCensusData2027";
import { jpRegionCensusData2023 } from "./jpRegionCensusData2023";
import { jpRegions2027 } from "./jpRegions2027";

const DIMS = {
  ethnicity: ["japanese", "chinese", "korean", "southeast_asian", "other_foreign"],
  age: ["young", "mid", "mature", "senior"],
  education: ["high_school", "vocational", "university", "graduate"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("jpRegionCensusData2027", () => {
  it("has one profile per seeded JP 2027 region", () => {
    expect(new Set(Object.keys(jpRegionCensusData2027))).toEqual(
      new Set(jpRegions2027.map((r) => String(r._id)))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(jpRegionCensusData2027)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is older and slightly more foreign than the 2023 profiles", () => {
    for (const id of Object.keys(jpRegionCensusData2027)) {
      expect(
        jpRegionCensusData2027[id].age.senior,
        `${id} senior 2027 >= 2023`
      ).toBeGreaterThanOrEqual(jpRegionCensusData2023[id].age.senior);
      expect(
        jpRegionCensusData2027[id].ethnicity.japanese,
        `${id} japanese 2027 <= 2023`
      ).toBeLessThanOrEqual(jpRegionCensusData2023[id].ethnicity.japanese);
    }
  });

  it("keeps the same dimension keys as the 2023 profiles", () => {
    for (const id of Object.keys(jpRegionCensusData2027)) {
      for (const dim of Object.keys(DIMS)) {
        expect(
          Object.keys(
            (
              jpRegionCensusData2027 as never as Record<
                string,
                Record<string, Record<string, number>>
              >
            )[id][dim]
          ).sort()
        ).toEqual(
          Object.keys(
            (
              jpRegionCensusData2023 as never as Record<
                string,
                Record<string, Record<string, number>>
              >
            )[id][dim]
          ).sort()
        );
      }
    }
  });
});
