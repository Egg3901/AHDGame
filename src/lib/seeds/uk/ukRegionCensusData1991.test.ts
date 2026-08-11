import { describe, it, expect } from "vitest";
import { ukRegionCensusData1991 } from "./ukRegionCensusData1991";
import { ukRegionCensusData } from "./ukRegionCensusData";

const REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];

const DIMS = {
  ethnicity: ["white_british", "asian_british", "black_british", "mixed", "other"],
  age: ["young", "mid", "mature", "senior"],
  education: ["no_qualifications", "gcse_equivalent", "a_level_equivalent", "degree_plus"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("ukRegionCensusData1991", () => {
  it("has the same 12 regions as the 2019 profiles", () => {
    expect(new Set(Object.keys(ukRegionCensusData1991))).toEqual(new Set(REGIONS));
    expect(new Set(Object.keys(ukRegionCensusData1991))).toEqual(
      new Set(Object.keys(ukRegionCensusData))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(ukRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("is whiter and less degree-educated than the 2019 profiles", () => {
    for (const id of REGIONS) {
      expect(
        ukRegionCensusData1991[id].ethnicity.white_british,
        `${id} 1991 white_british ≥ 2019`
      ).toBeGreaterThanOrEqual(ukRegionCensusData[id].ethnicity.white_british);
      expect(
        ukRegionCensusData1991[id].education.degree_plus,
        `${id} 1991 degree ≤ 2019`
      ).toBeLessThanOrEqual(ukRegionCensusData[id].education.degree_plus);
    }
  });
});
