import { describe, it, expect } from "vitest";
import { jpRegionCensusData1991 } from "./jpRegionCensusData1991";
import { jpRegionCensusData } from "./jpRegionCensusData";

const REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];

const DIMS = {
  ethnicity: ["japanese", "chinese", "korean", "southeast_asian", "other_foreign"],
  age: ["young", "mid", "mature", "senior"],
  education: ["high_school", "vocational", "university", "graduate"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("jpRegionCensusData1991", () => {
  it("has the same 8 regions as the 2019 profiles", () => {
    expect(new Set(Object.keys(jpRegionCensusData1991))).toEqual(new Set(REGIONS));
    expect(new Set(Object.keys(jpRegionCensusData1991))).toEqual(
      new Set(Object.keys(jpRegionCensusData))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(jpRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is more Japanese and less tertiary-educated than the 2019 profiles", () => {
    for (const id of REGIONS) {
      expect(
        jpRegionCensusData1991[id].ethnicity.japanese,
        `${id} 1991 japanese ≥ 2019`
      ).toBeGreaterThanOrEqual(jpRegionCensusData[id].ethnicity.japanese);
      const tertiary1991 =
        jpRegionCensusData1991[id].education.university +
        jpRegionCensusData1991[id].education.graduate;
      const tertiary2019 =
        jpRegionCensusData[id].education.university + jpRegionCensusData[id].education.graduate;
      expect(tertiary1991, `${id} 1991 tertiary ≤ 2019`).toBeLessThanOrEqual(tertiary2019);
    }
  });
});
