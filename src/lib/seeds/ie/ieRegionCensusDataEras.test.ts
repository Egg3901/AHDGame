import { describe, it, expect } from "vitest";
import { ieRegionCensusData1979 } from "./ieRegionCensusData1979";
import { ieRegionCensusData1999 } from "./ieRegionCensusData1999";
import { ieRegionCensusData2007 } from "./ieRegionCensusData2007";
import { ieRegionCensusData2023 } from "./ieRegionCensusData2023";
import { ieRegions } from "./ieRegions";

const DIMS = {
  ethnicity: ["irish", "uk_british", "eu_other", "rest_of_world"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_less", "leaving_cert", "post_secondary", "third_level"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

const ERAS = {
  1979: ieRegionCensusData1979,
  1999: ieRegionCensusData1999,
  2007: ieRegionCensusData2007,
  2023: ieRegionCensusData2023,
} as const;

describe.each(Object.entries(ERAS))("ieRegionCensusData%s", (era, data) => {
  it("matches the seeded IE region id set", () => {
    expect(new Set(Object.keys(data))).toEqual(new Set(ieRegions.map((r) => r._id)));
  });

  it("every sub-category sums to 100 per region with integer values", () => {
    for (const [id, profile] of Object.entries(data)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        let sum = 0;
        for (const k of keys) {
          const v = (profile as unknown as Record<string, Record<string, number>>)[dim][k];
          expect(Number.isInteger(v), `${era} ${id} ${dim}.${k} integer`).toBe(true);
          sum += v;
        }
        expect(sum, `${era} ${id} ${dim} sum`).toBe(100);
      }
    }
  });
});

describe("era-specific anchors", () => {
  it("1979 is near-homogeneous, agrarian, and barely third-level", () => {
    for (const [id, p] of Object.entries(ieRegionCensusData1979)) {
      expect(p.ethnicity.irish, `${id} irish`).toBeGreaterThanOrEqual(96);
      expect(p.education.third_level, `${id} third_level`).toBeLessThanOrEqual(8);
    }
  });

  it("2007 shows the EU-accession inflow (eu_other up everywhere vs 1999)", () => {
    for (const id of Object.keys(ieRegionCensusData2007)) {
      expect(ieRegionCensusData2007[id].ethnicity.eu_other, `${id} eu_other`).toBeGreaterThan(
        ieRegionCensusData1999[id].ethnicity.eu_other
      );
    }
  });

  it("2023 is the most diverse and most third-level-educated era", () => {
    for (const id of Object.keys(ieRegionCensusData2023)) {
      expect(ieRegionCensusData2023[id].ethnicity.irish, `${id} irish`).toBeLessThan(
        ieRegionCensusData2007[id].ethnicity.irish
      );
      expect(ieRegionCensusData2023[id].education.third_level, `${id} third_level`).toBeGreaterThan(
        ieRegionCensusData2007[id].education.third_level
      );
    }
  });
});
