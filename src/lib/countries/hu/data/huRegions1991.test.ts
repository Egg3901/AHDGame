import { describe, expect, it } from "vitest";
import { huRegions1991 } from "./huRegions1991";
import { HU_1991_REGION_POPULATION } from "./huPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";

describe("1991 Hungarian regional seed", () => {
  it("covers the census and sums to the 386-seat Assembly and GDP anchor", () => {
    expect(huRegions1991).toHaveLength(6);
    expect(huRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      Object.values(HU_1991_REGION_POPULATION).reduce((a, b) => a + b, 0)
    );
    expect(huRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(386);
    expect(huRegions1991.every((region) => region.stateSenateSeats === 0)).toBe(true);
    expect(Math.round(huRegions1991.reduce((sum, region) => sum + region.gdp, 0) * 1_000_000)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.HU
    );
  });
});
