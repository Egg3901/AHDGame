import { describe, it, expect } from "vitest";
import { jpRegions2027 } from "./jpRegions2027";
import { jpRegions2023 } from "./jpRegions2023";

const EXPECTED_IDS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];
const EXPECTED_SHUGIIN_TOTAL = 465;

describe("jpRegions2027 seed", () => {
  it("has exactly 8 regions with the stable game IDs", () => {
    expect(jpRegions2027.map((r) => r._id)).toEqual(EXPECTED_IDS);
  });

  it("Shugiin seats still sum to 465", () => {
    const total = jpRegions2027.reduce((sum, r) => sum + (r.houseDistricts ?? 0), 0);
    expect(total).toBe(EXPECTED_SHUGIIN_TOTAL);
  });

  it("all regions belong to JP with positive population and gdp", () => {
    for (const region of jpRegions2027) {
      expect(region.countryId).toBe("JP");
      expect(region.population).toBeGreaterThan(0);
      expect(region.gdp).toBeGreaterThan(0);
    }
  });

  it("holds house apportionment and prefectural seats structural", () => {
    for (const region of jpRegions2027) {
      const base = jpRegions2023.find((r) => r._id === region._id)!;
      expect(region.houseDistricts, `${region._id} seats`).toBe(base.houseDistricts);
      expect(region.stateSenateSeats, `${region._id} council seats`).toBe(base.stateSenateSeats);
    }
  });

  it("projects rural decline with Kanto flat (2025 census direction)", () => {
    const pop2027 = Object.fromEntries(jpRegions2027.map((r) => [r._id, r.population]));
    const pop2023 = Object.fromEntries(jpRegions2023.map((r) => [r._id, Number(r.population)]));
    for (const id of ["HOK", "TOH", "CGK", "SHI"]) {
      expect(pop2027[id], `${id} declines`).toBeLessThan(pop2023[id]);
    }
    // Kanto is held flat by Tokyo in-migration; allow a small band either way.
    const kantoDelta = Math.abs(pop2027["KAN"] - pop2023["KAN"]) / pop2023["KAN"];
    expect(kantoDelta).toBeLessThan(0.02);
    // National game total declines.
    const total2027 = Object.values(pop2027).reduce((a, b) => a + (b as number), 0);
    const total2023 = Object.values(pop2023).reduce((a, b) => a + (b as number), 0);
    expect(total2027).toBeLessThan(total2023);
  });

  it("is an independent literal, not a re-export of the 2023 bundle", () => {
    expect(jpRegions2027).not.toBe(jpRegions2023 as unknown);
    const changed = jpRegions2027.filter((r) => {
      const base = jpRegions2023.find((b) => b._id === r._id)!;
      return r.population !== base.population || r.gdp !== base.gdp;
    });
    expect(changed.length).toBeGreaterThan(0);
  });
});
