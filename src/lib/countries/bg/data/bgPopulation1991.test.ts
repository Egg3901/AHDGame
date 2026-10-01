import { describe, expect, it } from "vitest";
import {
  BG_1992_DISTRICT_POPULATION,
  BG_1991_MACROREGION_DISTRICTS,
  BG_1991_MACROREGION_POPULATION,
} from "./bgPopulation1991";
import { bgRegions } from "./bgRegions";

describe("Bulgarian 1991 scenario census baseline", () => {
  it("assigns each census district once and preserves the national count", () => {
    const districts = Object.values(BG_1991_MACROREGION_DISTRICTS).flat();
    expect(districts.length).toBe(Object.keys(BG_1992_DISTRICT_POPULATION).length);
    expect(new Set(districts).size).toBe(districts.length);
    expect(Object.keys(BG_1991_MACROREGION_POPULATION).sort()).toEqual(
      bgRegions.map((region) => region._id).sort()
    );
    expect(Object.values(BG_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      8_487_317
    );
  });
});
