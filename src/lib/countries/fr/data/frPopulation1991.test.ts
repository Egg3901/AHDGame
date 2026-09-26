import { describe, expect, it } from "vitest";
import { frRegions } from "./frRegions";
import {
  FR_1990_CENSUS_REGION_POPULATION,
  FR_1991_MACROREGION_CENSUS_REGIONS,
  FR_1991_MACROREGION_POPULATION,
} from "./frPopulation1991";

describe("1991 French census macroregions", () => {
  it("partitions all 22 census regions into the eight seeded game regions", () => {
    expect(Object.keys(FR_1991_MACROREGION_POPULATION).sort()).toEqual(
      frRegions.map((region) => region._id).sort()
    );
    const members = Object.values(FR_1991_MACROREGION_CENSUS_REGIONS).flat();
    expect(members.length).toBe(22);
    expect(new Set(members).size).toBe(22);
    expect(members.sort()).toEqual(Object.keys(FR_1990_CENSUS_REGION_POPULATION).sort());
  });

  it("totals the official 1990 metropolitan census population", () => {
    expect(Object.values(FR_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      56_615_155
    );
  });
});
