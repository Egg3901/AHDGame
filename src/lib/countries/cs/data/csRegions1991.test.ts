import { describe, expect, it } from "vitest";
import { csRegions1991 } from "./csRegions1991";
import { CS_1991_POPULATION } from "./csPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";

describe("1991 Czechoslovak regional seed", () => {
  it("matches the census, two federal chambers and republic GDP total", () => {
    expect(csRegions1991).toHaveLength(4);
    expect(csRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      CS_1991_POPULATION
    );
    expect(csRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(150);
    expect(csRegions1991.reduce((sum, region) => sum + region.stateSenateSeats, 0)).toBe(150);
    expect(Math.round(csRegions1991.reduce((sum, region) => sum + region.gdp, 0) * 1_000_000)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.CS
    );
  });
});
