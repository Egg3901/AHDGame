import { describe, it, expect } from "vitest";
import { cnRegionCensusData1991 } from "./cnRegionCensusData1991";
import { cnRegions } from "./cnRegions";

const REGIONS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

const DIMS = {
  ethnicity: ["han", "zhuang", "hui", "uyghur", "tibetan", "other_minority"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_below", "secondary", "vocational", "university"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("cnRegionCensusData1991", () => {
  it("has one profile per macro-region", () => {
    expect(new Set(Object.keys(cnRegionCensusData1991))).toEqual(new Set(REGIONS));
  });

  it("matches the seeded CN region id set", () => {
    expect(new Set(Object.keys(cnRegionCensusData1991))).toEqual(
      new Set(cnRegions.map((r) => r._id))
    );
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(cnRegionCensusData1991)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("Han heartland regions are ≥90% Han", () => {
    for (const id of ["DB", "HB", "HD", "HZ"]) {
      expect(cnRegionCensusData1991[id].ethnicity.han, `${id} han`).toBeGreaterThanOrEqual(90);
    }
  });

  it("concentrates minorities by region (Zhuang in HN, Uyghur/Hui in XB, Tibetan in XN)", () => {
    expect(cnRegionCensusData1991.HN.ethnicity.zhuang).toBeGreaterThanOrEqual(10);
    expect(
      cnRegionCensusData1991.XB.ethnicity.uyghur + cnRegionCensusData1991.XB.ethnicity.hui
    ).toBeGreaterThanOrEqual(25);
    expect(cnRegionCensusData1991.XN.ethnicity.tibetan).toBeGreaterThanOrEqual(5);
  });

  it("is overwhelmingly rural with low university attainment (1990)", () => {
    for (const [id, p] of Object.entries(cnRegionCensusData1991)) {
      expect(p.education.university, `${id} university`).toBeLessThanOrEqual(5);
    }
    expect(cnRegionCensusData1991.XN.urbanization.rural).toBeGreaterThan(
      cnRegionCensusData1991.DB.urbanization.rural
    );
  });
});
