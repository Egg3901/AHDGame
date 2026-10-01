import { describe, expect, it } from "vitest";
import { TR_1991_REGION_POPULATION, trRegions1991 } from "./trRegions1991";
import { POPULATION_TOTALS_1991 } from "@/lib/seeds/reference/populationTotals1991";

describe("Turkey 1991 regions", () => {
  it("retains the census shares, dated 1991 national total and unicameral assembly", () => {
    expect(Object.values(TR_1991_REGION_POPULATION).reduce((sum, n) => sum + n, 0)).toBe(
      56_473_035
    );
    expect(trRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      POPULATION_TOTALS_1991.TR.population
    );
    expect(trRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(450);
    expect(trRegions1991.every((region) => region.stateSenateSeats === 0)).toBe(true);
  });
});
