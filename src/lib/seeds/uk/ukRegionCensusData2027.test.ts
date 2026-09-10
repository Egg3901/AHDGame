import { describe, it, expect } from "vitest";
import { ukRegionCensusData2027 } from "./ukRegionCensusData2027";
import { ukRegionCensusData2023 } from "./ukRegionCensusData2023";
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

describe("ukRegionCensusData2027", () => {
  it("has the same 12 regions as the 2023 profiles", () => {
    expect(new Set(Object.keys(ukRegionCensusData2027))).toEqual(new Set(REGIONS));
    expect(new Set(Object.keys(ukRegionCensusData2027))).toEqual(
      new Set(Object.keys(ukRegionCensusData2023))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(ukRegionCensusData2027)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("continues the 2023 trends: more diverse, older, more degrees", () => {
    for (const id of REGIONS) {
      expect(
        ukRegionCensusData2027[id].ethnicity.white_british,
        `${id} 2027 white_british <= 2023`
      ).toBeLessThanOrEqual(ukRegionCensusData2023[id].ethnicity.white_british);
      expect(
        ukRegionCensusData2027[id].education.degree_plus,
        `${id} 2027 degree >= 2023`
      ).toBeGreaterThanOrEqual(ukRegionCensusData2023[id].education.degree_plus);
      expect(
        ukRegionCensusData2027[id].age.senior,
        `${id} 2027 senior >= 2023`
      ).toBeGreaterThanOrEqual(ukRegionCensusData2023[id].age.senior);
    }
  });

  it("London is below half White British and majority graduate", () => {
    expect(ukRegionCensusData2027.LON.ethnicity.white_british).toBeLessThan(50);
    expect(ukRegionCensusData2027.LON.education.degree_plus).toBeGreaterThan(50);
  });

  it("is a small drift from 2023, not a rewrite (each key within 3 points)", () => {
    for (const id of REGIONS) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        for (const k of keys) {
          const a = (
            ukRegionCensusData2027[id] as unknown as Record<string, Record<string, number>>
          )[dim][k];
          const b = (
            ukRegionCensusData2023[id] as unknown as Record<string, Record<string, number>>
          )[dim][k];
          expect(Math.abs(a - b), `${id} ${dim}.${k} drift`).toBeLessThanOrEqual(3);
        }
      }
    }
    // And the 2019 base is untouched by this file.
    expect(ukRegionCensusData.LON.ethnicity.white_british).toBe(53);
  });
});
