import { describe, expect, it } from "vitest";
import { plRegions2027 } from "./plRegions2027";
import { plRegions } from "./plRegions";

describe("2027 Polish regional seed", () => {
  it("reuses the eight existing macroregion ids with GUS-anchored totals", () => {
    expect(plRegions2027).toHaveLength(8);
    expect(plRegions2027.map((region) => region._id).sort()).toEqual(
      plRegions.map((region) => region._id).sort()
    );
    // GUS 31 December 2024: 37,489.1 thousand, exact after the +100
    // decimal-rounding remainder carried on PL_MAZ.
    expect(plRegions2027.reduce((sum, region) => sum + region.population, 0)).toBe(37_489_100);
    // GUS 2024 regional GDP release: 3,653,432 million PLN, exact.
    expect(plRegions2027.reduce((sum, region) => sum + region.gdp, 0)).toBe(3_653_432);
  });

  it("reproduces the 460/100 legislature through deterministic apportionment", () => {
    expect(plRegions2027.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(460);
    expect(plRegions2027.reduce((sum, region) => sum + region.stateSenateSeats, 0)).toBe(100);
    for (const region of plRegions2027) {
      expect(region.countryId).toBe("PL");
      expect(region.houseDistricts).toBeGreaterThan(0);
      expect(region.stateSenateSeats).toBeGreaterThan(0);
    }
  });
});
