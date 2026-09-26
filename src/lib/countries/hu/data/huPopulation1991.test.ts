import { describe, expect, it } from "vitest";
import { HU_1991_REGION_AGE, HU_1991_REGION_POPULATION } from "./huPopulation1991";

describe("Hungary 1990/1991 source population", () => {
  it("matches the KSH national total and broad age groups", () => {
    const ages = Object.values(HU_1991_REGION_AGE);
    expect(ages.reduce((sum, row) => sum + row.young0to14, 0)).toBe(2_130_549);
    expect(ages.reduce((sum, row) => sum + row.adult15to64, 0)).toBe(6_870_352);
    expect(ages.reduce((sum, row) => sum + row.senior65Plus, 0)).toBe(1_373_922);
    expect(Object.values(HU_1991_REGION_POPULATION).reduce((sum, value) => sum + value, 0)).toBe(
      10_374_823
    );
  });
});
