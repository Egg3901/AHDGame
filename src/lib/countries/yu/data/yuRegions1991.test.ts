import { describe, expect, it } from "vitest";
import { yuRegions1991 } from "./yuRegions1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { YU_1991_POPULATION } from "./yuPopulation1991";

describe("1991 Yugoslav regional seed", () => {
  it("covers the census and sums to the federal legislature and GDP anchors", () => {
    expect(yuRegions1991).toHaveLength(8);
    expect(yuRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      YU_1991_POPULATION
    );
    expect(yuRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(220);
    expect(yuRegions1991.reduce((sum, region) => sum + region.stateSenateSeats, 0)).toBe(88);
    expect(Math.round(yuRegions1991.reduce((sum, region) => sum + region.gdp, 0) * 1_000_000)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.YU
    );
  });
});
