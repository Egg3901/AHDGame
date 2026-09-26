import { describe, expect, it } from "vitest";
import { plRegions1991 } from "./plRegions1991";
import { PL_1991_MACROREGION_POPULATION } from "./plPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

describe("1991 Polish regional seed", () => {
  it("covers the census and reproduces the 460/100 legislature", () => {
    expect(plRegions1991).toHaveLength(8);
    expect(plRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      Object.values(PL_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)
    );
    expect(plRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(460);
    expect(plRegions1991.reduce((sum, region) => sum + region.stateSenateSeats, 0)).toBe(100);
    expect(Math.round(plRegions1991.reduce((sum, region) => sum + region.gdp, 0) * 1_000_000)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.PL
    );
  });

  it("apportions integer seats with a deterministic total", () => {
    expect(apportionSeats(5, { A: 10, B: 10, C: 10 })).toEqual({ A: 2, B: 2, C: 1 });
  });
});
