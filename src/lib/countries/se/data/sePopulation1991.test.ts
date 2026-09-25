import { describe, expect, it } from "vitest";
import { seRegions } from "./seRegions";
import {
  SE_1990_COUNTY_POPULATION,
  SE_1991_MACROREGION_COUNTIES,
  SE_1991_MACROREGION_POPULATION,
} from "./sePopulation1991";

describe("1991 Swedish county population", () => {
  it("partitions all 21 counties into the eight seeded game regions", () => {
    expect(Object.keys(SE_1991_MACROREGION_POPULATION).sort()).toEqual(
      seRegions.map((region) => region._id).sort()
    );
    const members = Object.values(SE_1991_MACROREGION_COUNTIES).flat();
    expect(members.length).toBe(21);
    expect(new Set(members).size).toBe(21);
    expect(members.sort()).toEqual(Object.keys(SE_1990_COUNTY_POPULATION).sort());
  });

  it("totals the Statistics Sweden 1990 national population", () => {
    expect(Object.values(SE_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      8_590_630
    );
  });
});
