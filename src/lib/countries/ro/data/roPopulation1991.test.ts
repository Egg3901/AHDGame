import { describe, expect, it } from "vitest";
import {
  RO_1992_COUNTY_POPULATION,
  RO_1991_MACROREGION_COUNTIES,
  RO_1991_MACROREGION_POPULATION,
} from "./roPopulation1991";
import { roRegions } from "./roRegions";

describe("Romanian 1991 scenario census baseline", () => {
  it("assigns every 1992 census county once and preserves the national count", () => {
    const counties = Object.values(RO_1991_MACROREGION_COUNTIES).flat();
    expect(counties.length).toBe(Object.keys(RO_1992_COUNTY_POPULATION).length);
    expect(new Set(counties).size).toBe(counties.length);
    expect(Object.keys(RO_1991_MACROREGION_POPULATION).sort()).toEqual(
      roRegions.map((region) => region._id).sort()
    );
    expect(Object.values(RO_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      22_810_035
    );
  });
});
