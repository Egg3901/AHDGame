import { describe, it, expect } from "vitest";
import { cnRegions, CN_DISTRICTS_PER_REGION } from "./cnRegions";

const EXPECTED_NPC_TOTAL = 2_980;
const EXPECTED_REGION_COUNT = 7;
const EXPECTED_REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

describe("cnRegions seed", () => {
  it("has exactly 7 regions", () => {
    expect(cnRegions).toHaveLength(EXPECTED_REGION_COUNT);
  });

  it("contains all expected region IDs", () => {
    const ids = cnRegions.map((r) => r._id);
    for (const expected of EXPECTED_REGION_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it("NPC seats sum to 2,980", () => {
    const total = cnRegions.reduce((sum, r) => sum + r.houseDistricts, 0);
    expect(total).toBe(EXPECTED_NPC_TOTAL);
  });

  it("all regions have positive population", () => {
    for (const region of cnRegions) {
      expect(region.population).toBeGreaterThan(0);
    }
  });

  it("all regions have positive gdp", () => {
    for (const region of cnRegions) {
      expect(region.gdp).toBeGreaterThan(0);
    }
  });

  it("all regions belong to CN", () => {
    for (const region of cnRegions) {
      expect(region.countryId).toBe("CN");
    }
  });

  it("CN_DISTRICTS_PER_REGION matches cnRegions houseDistricts", () => {
    for (const region of cnRegions) {
      expect(CN_DISTRICTS_PER_REGION[region._id]).toBe(region.houseDistricts);
    }
  });

  it("CN_DISTRICTS_PER_REGION keys sum to 2,980", () => {
    const total = Object.values(CN_DISTRICTS_PER_REGION).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(EXPECTED_NPC_TOTAL);
  });
});
