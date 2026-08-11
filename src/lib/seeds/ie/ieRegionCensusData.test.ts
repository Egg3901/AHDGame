import { describe, it, expect } from "vitest";
import { ieRegionCensusData } from "./ieRegionCensusData";
import { ieRegionCensusData1991 } from "./ieRegionCensusData1991";
import { ieRegions } from "./ieRegions";

const DIMS = {
  ethnicity: ["irish", "uk_british", "eu_other", "rest_of_world"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_less", "leaving_cert", "post_secondary", "third_level"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("ieRegionCensusData (2019)", () => {
  it("has one profile per seeded IE region", () => {
    expect(new Set(Object.keys(ieRegionCensusData))).toEqual(new Set(ieRegions.map((r) => r._id)));
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(ieRegionCensusData)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is more diverse and more third-level-educated than the 1991 profiles", () => {
    for (const id of Object.keys(ieRegionCensusData)) {
      expect(
        ieRegionCensusData[id].education.third_level,
        `${id} third_level 2019 > 1991`
      ).toBeGreaterThan(ieRegionCensusData1991[id].education.third_level);
      expect(ieRegionCensusData[id].ethnicity.irish, `${id} irish 2019 < 1991`).toBeLessThan(
        ieRegionCensusData1991[id].ethnicity.irish
      );
    }
  });
});
