import { describe, expect, it } from "vitest";
import { esRegions } from "./esRegions";
import {
  ES_1991_CENSUS_POPULATION,
  ES_1991_MACROREGION_CENSUS_REGIONS,
  ES_1991_MACROREGION_POPULATION,
} from "./esPopulation1991";

describe("1991 Spanish census macroregions", () => {
  it("partitions every census area into the eight seeded game regions", () => {
    expect(Object.keys(ES_1991_MACROREGION_POPULATION).sort()).toEqual(
      esRegions.map((region) => region._id).sort()
    );
    const members = Object.values(ES_1991_MACROREGION_CENSUS_REGIONS).flat();
    expect(members.length).toBe(19);
    expect(new Set(members).size).toBe(19);
    expect(members.sort()).toEqual(Object.keys(ES_1991_CENSUS_POPULATION).sort());
  });

  it("totals the official 1991 census population", () => {
    expect(Object.values(ES_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      38_872_268
    );
  });
});
