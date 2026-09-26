import { describe, expect, it } from "vitest";
import { getCountryLayer1Model, buildModelRegionDemographics } from "./index";
import { SUCCESSOR_REGION_POPULATION_1991 } from "@/lib/seeds/reference/successorPopulation1991";
import { HU_1991_REGION_AGE } from "@/lib/countries/hu/data/huPopulation1991";

describe("1991 transition demographics", () => {
  it("covers the seven era-specific region bundles with valid voter shares", () => {
    for (const countryId of ["RU", "PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      const model = getCountryLayer1Model(countryId, "1991");
      expect(model).not.toBeNull();
      expect(Object.keys(model!.census).sort()).toEqual(
        Object.keys(SUCCESSOR_REGION_POPULATION_1991[countryId]).sort()
      );
      const rows = buildModelRegionDemographics(model!);
      for (const row of rows) {
        const total = Object.values(row.groups).reduce((sum, group) => sum + group.population, 0);
        expect(total, row._id).toBeCloseTo(100, 1);
        expect(row.categoryWeights[model!.categoryId]).toBe(100);
      }
    }
  });

  it("uses Hungary's observed regional age and Kosovo's much younger census profile", () => {
    const hu = getCountryLayer1Model("HU", "1991")!;
    const budapest = hu.census.HU_BUD.age;
    const source = HU_1991_REGION_AGE.HU_BUD;
    const total = source.young0to14 + source.adult15to64 + source.senior65Plus;
    expect(budapest.young).toBeCloseTo((source.young0to14 / total) * 100, 3);
    expect(budapest.senior).toBeCloseTo((source.senior65Plus / total) * 100, 3);
    const yu = getCountryLayer1Model("YU", "1991")!;
    expect(yu.census.YU_KOS.age.young).toBeGreaterThan(yu.census.YU_SLO.age.young + 10);
  });
});
