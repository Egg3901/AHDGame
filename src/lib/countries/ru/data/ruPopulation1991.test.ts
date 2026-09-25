import { describe, expect, it } from "vitest";
import { RU_1991_ECONOMIC_REGION_POPULATION, RU_1991_POPULATION } from "./ruPopulation1991";
import { ruRegions } from "./ruRegions";

describe("Russian 1991 economic region population", () => {
  it("covers the ten Russian regions and excludes the four other Soviet macroregions", () => {
    const russianRegionIds = ruRegions
      .filter((region) => region.region === "Russia")
      .map((r) => r._id);
    expect(Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).sort()).toEqual(russianRegionIds.sort());
    expect(RU_1991_POPULATION).toBe(148_164_000);
  });
});
