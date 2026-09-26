import { describe, expect, it } from "vitest";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";
import { ruRegions } from "@/lib/countries/ru/data/ruRegions";
import { plRegions } from "@/lib/countries/pl/data/plRegions";
import { csRegions } from "@/lib/countries/cs/data/csRegions";
import { huRegions } from "@/lib/countries/hu/data/huRegions";
import { roRegions } from "@/lib/countries/ro/data/roRegions";
import { bgRegions } from "@/lib/countries/bg/data/bgRegions";
import { yuRegions } from "@/lib/countries/yu/data/yuRegions";

describe("1991 successor census registry", () => {
  it("covers the 1991 Russian territory and every other successor game region", () => {
    const regions = {
      RU: ruRegions.filter((region) => region.region === "Russia"),
      PL: plRegions,
      CS: csRegions,
      HU: huRegions,
      RO: roRegions,
      BG: bgRegions,
      YU: yuRegions,
    };
    const censusTotals = {
      RU: 148_164_000,
      PL: 38_183_200,
      CS: 15_576_535,
      HU: 10_374_823,
      RO: 22_810_035,
      BG: 8_487_317,
      YU: 23_555_274,
    };
    expect(Object.keys(SUCCESSOR_REGION_POPULATION_1991).sort()).toEqual(
      Object.keys(regions).sort()
    );
    for (const countryId of Object.keys(regions) as Array<keyof typeof regions>) {
      const population = SUCCESSOR_REGION_POPULATION_1991[countryId];
      expect(Object.keys(population).sort(), countryId).toEqual(
        regions[countryId].map((region) => region._id).sort()
      );
      expect(
        Object.values(population).every((value) => value > 0),
        countryId
      ).toBe(true);
      expect(
        Object.values(population).reduce((sum, value) => sum + value, 0),
        countryId
      ).toBe(censusTotals[countryId]);
    }
  });
});
