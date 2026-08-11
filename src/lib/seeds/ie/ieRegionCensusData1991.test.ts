import { describe, it, expect } from "vitest";
import { ieRegionCensusData1991 } from "./ieRegionCensusData1991";
import { ieRegions } from "./ieRegions";

const REGIONS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"];

const DIMS = {
  ethnicity: ["irish", "uk_british", "eu_other", "rest_of_world"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_less", "leaving_cert", "post_secondary", "third_level"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("ieRegionCensusData1991", () => {
  it("has one profile per planning region", () => {
    expect(new Set(Object.keys(ieRegionCensusData1991))).toEqual(new Set(REGIONS));
  });

  it("matches the seeded IE region id set", () => {
    expect(new Set(Object.keys(ieRegionCensusData1991))).toEqual(
      new Set(ieRegions.map((r) => r._id))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(ieRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is near-homogeneous Irish with low third-level (pre-Celtic-Tiger)", () => {
    for (const [id, p] of Object.entries(ieRegionCensusData1991)) {
      expect(p.ethnicity.irish, `${id} irish`).toBeGreaterThanOrEqual(94);
      expect(p.education.third_level, `${id} third_level`).toBeLessThanOrEqual(14);
    }
  });

  it("rural regions skew more rural than Dublin", () => {
    for (const id of ["DON", "GAL", "MID"]) {
      expect(ieRegionCensusData1991[id].urbanization.rural).toBeGreaterThan(
        ieRegionCensusData1991.DUB.urbanization.rural
      );
    }
  });
});
