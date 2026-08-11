import { describe, it, expect } from "vitest";
import { cnRegionCensusData } from "./cnRegionCensusData";
import { cnRegionCensusData1991 } from "./cnRegionCensusData1991";
import { cnRegions } from "./cnRegions";

const DIMS = {
  ethnicity: ["han", "zhuang", "hui", "uyghur", "tibetan", "other_minority"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_below", "secondary", "vocational", "university"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("cnRegionCensusData (2019)", () => {
  it("has one profile per seeded CN region", () => {
    expect(new Set(Object.keys(cnRegionCensusData))).toEqual(new Set(cnRegions.map((r) => r._id)));
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(cnRegionCensusData)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is more urban and more university-educated than the 1991 profiles", () => {
    for (const id of Object.keys(cnRegionCensusData)) {
      expect(cnRegionCensusData[id].urbanization.urban, `${id} urban 2019 > 1991`).toBeGreaterThan(
        cnRegionCensusData1991[id].urbanization.urban
      );
      expect(
        cnRegionCensusData[id].education.university,
        `${id} university 2019 > 1991`
      ).toBeGreaterThan(cnRegionCensusData1991[id].education.university);
    }
  });
});
