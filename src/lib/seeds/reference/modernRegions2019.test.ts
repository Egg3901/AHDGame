import { describe, expect, it } from "vitest";
import { MODERN_2019_NATIONALS, modernRegions2019 } from "./modernRegions2019";

describe("2019 transition-country game regions", () => {
  it.each([
    ["RU", 10, 450, 0],
    ["PL", 8, 460, 100],
    ["HU", 6, 199, 0],
    ["RO", 7, 329, 136],
    ["BG", 5, 240, 0],
  ] as const)(
    "%s preserves the 2019 national anchors and chamber size",
    (countryId, count, house, senate) => {
      const regions = modernRegions2019(countryId);
      const national = MODERN_2019_NATIONALS[countryId];
      expect(regions).toHaveLength(count);
      expect(new Set(regions.map((region) => region._id)).size).toBe(count);
      expect(regions.every((region) => region.countryId === countryId)).toBe(true);
      expect(regions.reduce((n, region) => n + region.population, 0)).toBe(national.population);
      expect(regions.reduce((n, region) => n + region.gdp, 0)).toBe(
        Math.round(national.gdp / 1_000_000)
      );
      expect(regions.reduce((n, region) => n + region.houseDistricts, 0)).toBe(house);
      expect(regions.reduce((n, region) => n + region.stateSenateSeats, 0)).toBe(senate);
    }
  );
});
