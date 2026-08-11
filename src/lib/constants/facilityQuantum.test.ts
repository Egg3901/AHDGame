import { describe, it, expect } from "vitest";
import {
  FACILITY_TARGET_DAILY_REVENUE_ANCHOR,
  facilitiesFromUnits,
  plantSizeUnits,
} from "./facilityQuantum";
import { CORPORATION_TYPES } from "./corporations";
import { revenuePerCapacityUnit } from "./capacityEconomy";

describe("plantSizeUnits", () => {
  it("is a positive integer for every sector type", () => {
    for (const type of CORPORATION_TYPES) {
      const size = plantSizeUnits(type);
      expect(Number.isInteger(size)).toBe(true);
      expect(size).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps each facility's nameplate near the target daily revenue", () => {
    // Authored values are legible roundings of target / RPU. The band is wide
    // enough for the rounding and deliberately floors at 1 for sectors whose
    // single unit already exceeds the target (automobiles). When this fails, a
    // strategy or base-price change moved the sector's RPU — re-round the
    // authored entry on purpose rather than loosening the band.
    for (const type of CORPORATION_TYPES) {
      const rpu = revenuePerCapacityUnit(type, 1);
      if (!(rpu > 0)) continue;
      const size = plantSizeUnits(type);
      const nameplate = size * rpu;
      if (rpu >= FACILITY_TARGET_DAILY_REVENUE_ANCHOR) {
        // One unit is already a facility or more; the floor is the answer.
        expect(size).toBe(1);
        continue;
      }
      expect(nameplate).toBeGreaterThan(FACILITY_TARGET_DAILY_REVENUE_ANCHOR * 0.6);
      expect(nameplate).toBeLessThan(FACILITY_TARGET_DAILY_REVENUE_ANCHOR * 1.4);
    }
  });
});

describe("facilitiesFromUnits", () => {
  it("floors to whole facilities but never reports 0 for real capacity", () => {
    expect(facilitiesFromUnits("energy", 0)).toBe(0);
    expect(facilitiesFromUnits("energy", -5)).toBe(0);
    expect(facilitiesFromUnits("energy", NaN)).toBe(0);
    expect(facilitiesFromUnits("energy", 10)).toBe(1);
    expect(facilitiesFromUnits("energy", 250)).toBe(1);
    expect(facilitiesFromUnits("energy", 749)).toBe(2);
    expect(facilitiesFromUnits("energy", 2500)).toBe(10);
    expect(facilitiesFromUnits("automobiles", 3.7)).toBe(3);
  });
});
