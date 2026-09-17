import { describe, it, expect } from "vitest";
import { cnRegions2027 } from "./cnRegions2027";
import { cnRegions2023 } from "./cnRegions2023";

const EXPECTED_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
const EXPECTED_NPC_TOTAL = 2_980;
const EXPECTED_CPPCC_TOTAL = 2_169;

describe("cnRegions2027 seed", () => {
  it("has exactly 7 macro-regions with the stable IDs", () => {
    expect(cnRegions2027.map((r) => r._id)).toEqual(EXPECTED_IDS);
  });

  it("NPC seats sum to 2,980 and CPPCC seats to 2,169", () => {
    const npc = cnRegions2027.reduce((sum, r) => sum + (r.houseDistricts ?? 0), 0);
    const cppcc = cnRegions2027.reduce((sum, r) => sum + (r.stateSenateSeats ?? 0), 0);
    expect(npc).toBe(EXPECTED_NPC_TOTAL);
    expect(cppcc).toBe(EXPECTED_CPPCC_TOTAL);
  });

  it("all regions belong to CN with positive population and gdp", () => {
    for (const region of cnRegions2027) {
      expect(region.countryId).toBe("CN");
      expect(region.population).toBeGreaterThan(0);
      expect(region.gdp).toBeGreaterThan(0);
    }
  });

  it("holds NPC and CPPCC apportionment structural", () => {
    for (const region of cnRegions2027) {
      const base = cnRegions2023.find((r) => r._id === region._id)!;
      expect(region.houseDistricts, `${region._id} NPC seats`).toBe(base.houseDistricts);
      expect(region.stateSenateSeats, `${region._id} CPPCC seats`).toBe(base.stateSenateSeats);
    }
  });

  it("projects Dongbei decline with a flat-to-down national total", () => {
    const pop2027 = Object.fromEntries(cnRegions2027.map((r) => [r._id, r.population]));
    const pop2023 = Object.fromEntries(cnRegions2023.map((r) => [r._id, Number(r.population)]));
    expect(pop2027["DB"], "Dongbei declines").toBeLessThan(pop2023["DB"]);
    const total2027 = Object.values(pop2027).reduce((a, b) => a + (b as number), 0);
    const total2023 = Object.values(pop2023).reduce((a, b) => a + (b as number), 0);
    expect(total2027).toBeLessThanOrEqual(total2023);
  });

  it("is an independent literal, not a re-export of the 2023 bundle", () => {
    expect(cnRegions2027).not.toBe(cnRegions2023 as unknown);
    const changed = cnRegions2027.filter((r) => {
      const base = cnRegions2023.find((b) => b._id === r._id)!;
      return r.population !== base.population || r.gdp !== base.gdp;
    });
    expect(changed.length).toBeGreaterThan(0);
  });
});
