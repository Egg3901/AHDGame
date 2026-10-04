import { describe, expect, it } from "vitest";
import { BG_1991_ELECTORAL_DISTRICTS } from "./electoralDistricts1991";
import { BG_1991_MACROREGION_POPULATION, BG_1992_DISTRICT_POPULATION } from "./bgPopulation1991";

describe("bounded Bulgarian 31-district catalog", () => {
  it("covers every district once and preserves national and macroregional populations", () => {
    expect(BG_1991_ELECTORAL_DISTRICTS).toHaveLength(31);
    expect(new Set(BG_1991_ELECTORAL_DISTRICTS.map((row) => row.id)).size).toBe(31);
    expect(BG_1991_ELECTORAL_DISTRICTS.map((row) => row.number)).toEqual(
      Array.from({ length: 31 }, (_, index) => index + 1)
    );
    const totals: Record<string, number> = {};
    for (const district of BG_1991_ELECTORAL_DISTRICTS) {
      expect(Number.isSafeInteger(district.population) && district.population > 0).toBe(true);
      totals[district.regionId] = (totals[district.regionId] ?? 0) + district.population;
    }
    expect(totals).toEqual(BG_1991_MACROREGION_POPULATION);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(8_487_317);
  });
  it("labels every estimated city subdivision and retains its census parent total", () => {
    const sofia = BG_1991_ELECTORAL_DISTRICTS.filter((row) => row.number >= 23 && row.number <= 25);
    const plovdiv = BG_1991_ELECTORAL_DISTRICTS.filter(
      (row) => row.number === 16 || row.number === 17
    );
    expect(sofia.every((row) => row.populationModel === "equal-sofia-subdivision")).toBe(true);
    expect(plovdiv.every((row) => row.populationModel === "plovdiv-city-proxy")).toBe(true);
    expect(sofia.reduce((sum, row) => sum + row.population, 0)).toBe(
      BG_1992_DISTRICT_POPULATION.GradSofiya
    );
    expect(plovdiv.reduce((sum, row) => sum + row.population, 0)).toBe(
      BG_1992_DISTRICT_POPULATION.Plovdiv
    );
  });
});
