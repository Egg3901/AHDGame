import { describe, expect, it } from "vitest";
import { roRegions1991 } from "./roRegions1991";
import { RO_1991_MACROREGION_POPULATION } from "./roPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";

describe("Romania 1991 regions", () => {
  it("preserves census population, national GDP, and the 1990 parliament", () => {
    expect(roRegions1991).toHaveLength(7);
    expect(roRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      Object.values(RO_1991_MACROREGION_POPULATION).reduce((sum, population) => sum + population, 0)
    );
    expect(roRegions1991.reduce((sum, region) => sum + region.gdp, 0)).toBeCloseTo(
      SUCCESSOR_NOMINAL_GDP_1991.RO / 1_000_000,
      5
    );
    expect(roRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(396);
    expect(roRegions1991.reduce((sum, region) => sum + region.stateSenateSeats, 0)).toBe(119);
  });
});
