import { describe, it, expect } from "vitest";
import { deRegionCensusData1991 } from "./deRegionCensusData1991";
import { deRegionCensusData } from "./deRegionCensusData";
import { deRegions } from "./deRegions";

const DIMS = {
  ethnicity: ["german", "turkish_russian_diaspora", "mena", "eu_southern_eastern", "other"],
  age: ["young", "mid", "mature", "senior"],
  education: ["no_degree", "berufsausbildung", "abitur", "hochschulabschluss"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("deRegionCensusData1991", () => {
  it("has one profile per Bundesland", () => {
    expect(new Set(Object.keys(deRegionCensusData1991))).toEqual(
      new Set(deRegions.map((r) => r._id))
    );
  });

  it("every sub-category sums to 100 per Land", () => {
    for (const [id, profile] of Object.entries(deRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("eastern Länder are ≥96% german (1991 reunification reality)", () => {
    for (const id of ["BB", "MV", "SN", "ST", "TH"]) {
      expect(deRegionCensusData1991[id].ethnicity.german, `${id} german`).toBeGreaterThanOrEqual(
        96
      );
    }
  });

  it("is directionally less migrant + less tertiary than the 2019 profiles", () => {
    for (const id of Object.keys(deRegionCensusData1991)) {
      expect(
        deRegionCensusData1991[id].ethnicity.german,
        `${id} 1991 german ≥ 2019`
      ).toBeGreaterThanOrEqual(deRegionCensusData[id].ethnicity.german);
      expect(
        deRegionCensusData1991[id].education.hochschulabschluss,
        `${id} 1991 tertiary ≤ 2019`
      ).toBeLessThanOrEqual(deRegionCensusData[id].education.hochschulabschluss);
    }
  });
});
