import { describe, expect, it } from "vitest";
import { RU_ADULT_CENSUS_2021, RU_ADULT_COHORT_IDS } from "./data/ruAdultCensus2021";
import { getRuModel } from "./layer1Model";
import { buildModelRegionDemographics } from "@/lib/seeds/international/derive";
import { ruRegions2027 } from "./data/ruRegions2027";

describe("RU 2027 adult census model", () => {
  it("reconciles all ten macroregions to Rosstat's national 18+ census count", () => {
    expect(Object.keys(RU_ADULT_CENSUS_2021).sort()).toEqual(
      ruRegions2027.map((region) => region._id).sort()
    );
    expect(
      Object.values(RU_ADULT_CENSUS_2021)
        .flat()
        .reduce((sum, n) => sum + n, 0)
    ).toBe(119_466_511);
  });

  it("keeps the eight measured cohort-place cells and excludes Soviet archetypes", () => {
    const model = getRuModel("2027");
    expect(model.groupIds).toEqual(RU_ADULT_COHORT_IDS);
    expect(model.groupIds).not.toContain("party_nomenklatura");
    expect(Object.keys(model.census).sort()).toEqual(Object.keys(RU_ADULT_CENSUS_2021).sort());
    const rows = buildModelRegionDemographics(model);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const total = Object.values(row.groups).reduce((sum, group) => sum + group.population, 0);
      expect(total).toBeCloseTo(100, 1);
      const census = RU_ADULT_CENSUS_2021[row._id as keyof typeof RU_ADULT_CENSUS_2021];
      const censusTotal = census.reduce((sum, n) => sum + n, 0);
      expect(row.groups.urban_18_34.population).toBeCloseTo((census[0] / censusTotal) * 100, 1);
    }
  });

  it("retains the historical Soviet model in 1979", () => {
    expect(getRuModel("1979").groupIds).toContain("party_nomenklatura");
    expect(getRuModel("1979").groupIds).not.toContain("urban_18_34");
  });
});
