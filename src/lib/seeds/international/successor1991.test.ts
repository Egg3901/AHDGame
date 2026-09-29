import { describe, expect, it } from "vitest";
import { getCountryLayer1Model, buildModelRegionDemographics } from "./index";
import { SUCCESSOR_REGION_POPULATION_1991 } from "@/lib/seeds/reference/successorPopulation1991";
import { HU_1991_REGION_AGE } from "@/lib/countries/hu/data/huPopulation1991";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";

describe("1991 transition demographics", () => {
  it("covers the seven era-specific region bundles with valid voter shares", () => {
    for (const countryId of ["RU", "PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      const model = getCountryLayer1Model(countryId, "1991");
      expect(model).not.toBeNull();
      const expectedIds =
        countryId === "RU"
          ? sovietUnionRegions1991.map((region) => region._id)
          : Object.keys(SUCCESSOR_REGION_POPULATION_1991[countryId]);
      expect(Object.keys(model!.census).sort()).toEqual(expectedIds.sort());
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

  it("keeps observed Soviet republic controls distinct from Russian regions", () => {
    const union = getCountryLayer1Model("RU", "1991")!;
    expect(union.census.SU_TJ.age.young).toBeCloseTo(43.9741, 3);
    expect(union.census.SU_UKR.urbanization.rural).toBeCloseTo(32.3087, 3);
    expect(union.census.SU_TJ.age.young).toBeGreaterThan(union.census.CEN.age.young + 15);
  });
});
