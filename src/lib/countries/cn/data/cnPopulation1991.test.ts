import { describe, expect, it } from "vitest";
import { cnRegions1991 } from "./cnRegions1991";
import {
  CN_1990_CENSUS_PROVINCE_POPULATION,
  CN_1991_MACROREGION_POPULATION,
  CN_1991_MACROREGION_PROVINCES,
} from "./cnPopulation1991";

describe("1991 Chinese census macroregions", () => {
  it("partitions all 30 mainland provinces into the seven seeded game regions", () => {
    expect(Object.keys(CN_1991_MACROREGION_POPULATION).sort()).toEqual(
      cnRegions1991.map((region) => region._id).sort()
    );
    const members = Object.values(CN_1991_MACROREGION_PROVINCES).flat();
    expect(members.length).toBe(30);
    expect(new Set(members).size).toBe(30);
    expect(members.sort()).toEqual(Object.keys(CN_1990_CENSUS_PROVINCE_POPULATION).sort());
  });

  it("matches the official mainland census after separately reported military personnel", () => {
    expect(Object.values(CN_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      1_133_682_501 - 3_199_100
    );
  });
});
