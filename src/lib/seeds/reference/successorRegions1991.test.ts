import { describe, expect, it } from "vitest";
import { SUCCESSOR_REGIONS_1991 } from "./successorRegions1991";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";

describe("1991 successor geography", () => {
  it.each(Object.keys(SUCCESSOR_REGION_POPULATION_1991))(
    "%s has one named region per census macroregion, without Soviet economy fields",
    (countryId) => {
      const regions = SUCCESSOR_REGIONS_1991[countryId as keyof typeof SUCCESSOR_REGIONS_1991];
      const census = SUCCESSOR_REGION_POPULATION_1991[
        countryId as keyof typeof SUCCESSOR_REGION_POPULATION_1991
      ] as Record<string, number>;
      expect(regions.map((region) => region._id).sort()).toEqual(Object.keys(census).sort());
      expect(new Set(regions.map((region) => region._id)).size).toBe(regions.length);
      for (const region of regions) {
        expect(region.countryId).toBe(countryId);
        expect(region.name.length).toBeGreaterThan(0);
        expect(region.population).toBe(census[region._id]);
        expect(region).not.toHaveProperty("gdp");
        expect(region).not.toHaveProperty("houseDistricts");
      }
    }
  );
});
