import { describe, expect, it } from "vitest";
import { TR_1991_REGION_POPULATION, trRegions1991 } from "./trRegions1991";

describe("Turkey 1991 regions", () => {
  it("matches the 1990 census and post-1980 unicameral assembly", () => {
    expect(Object.values(TR_1991_REGION_POPULATION).reduce((sum, n) => sum + n, 0)).toBe(
      56_473_035
    );
    expect(trRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(56_473_035);
    expect(trRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(450);
    expect(trRegions1991.every((region) => region.stateSenateSeats === 0)).toBe(true);
  });
});
