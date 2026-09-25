import { describe, expect, it } from "vitest";
import { bgRegions1991 } from "./bgRegions1991";
import { BG_1991_MACROREGION_POPULATION } from "./bgPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";

describe("Bulgaria 1991 regions", () => {
  it("preserves census population, national GDP, and Grand National Assembly seats", () => {
    expect(bgRegions1991).toHaveLength(5);
    expect(bgRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      Object.values(BG_1991_MACROREGION_POPULATION).reduce((sum, population) => sum + population, 0)
    );
    expect(bgRegions1991.reduce((sum, region) => sum + region.gdp, 0)).toBeCloseTo(
      SUCCESSOR_NOMINAL_GDP_1991.BG / 1_000_000,
      5
    );
    expect(bgRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(400);
  });
});
