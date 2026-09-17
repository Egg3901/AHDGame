import { describe, it, expect } from "vitest";
import { cnRegionCensusData2027 } from "./cnRegionCensusData2027";
import { cnRegionCensusData2023 } from "./cnRegionCensusData2023";
import { cnRegions2027 } from "./cnRegions2027";

const DIMS = {
  ethnicity: ["han", "zhuang", "hui", "uyghur", "tibetan", "other_minority"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_below", "secondary", "vocational", "university"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("cnRegionCensusData2027", () => {
  it("has one profile per seeded CN 2027 region", () => {
    expect(new Set(Object.keys(cnRegionCensusData2027))).toEqual(
      new Set(cnRegions2027.map((r) => String(r._id)))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(cnRegionCensusData2027)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is more urban, older, and more schooled than the 2023 profiles", () => {
    for (const id of Object.keys(cnRegionCensusData2027)) {
      expect(
        cnRegionCensusData2027[id].urbanization.urban,
        `${id} urban 2027 >= 2023`
      ).toBeGreaterThanOrEqual(cnRegionCensusData2023[id].urbanization.urban);
      expect(
        cnRegionCensusData2027[id].age.senior,
        `${id} senior 2027 >= 2023`
      ).toBeGreaterThanOrEqual(cnRegionCensusData2023[id].age.senior);
      expect(
        cnRegionCensusData2027[id].education.university,
        `${id} university 2027 >= 2023`
      ).toBeGreaterThanOrEqual(cnRegionCensusData2023[id].education.university);
    }
  });

  it("holds ethnic composition and income tiers at 2023 values", () => {
    for (const id of Object.keys(cnRegionCensusData2027)) {
      expect(cnRegionCensusData2027[id].ethnicity).toEqual(cnRegionCensusData2023[id].ethnicity);
      expect(cnRegionCensusData2027[id].income).toEqual(cnRegionCensusData2023[id].income);
    }
  });
});
