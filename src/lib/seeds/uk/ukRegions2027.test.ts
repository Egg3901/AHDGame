import { describe, expect, it } from "vitest";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import { ukRegions2027 } from "./ukRegions2027";
import { ukRegions2023 } from "./ukRegions2023";

const ENGLAND_IDS = ["LON", "SEE", "SWE", "EAE", "EMI", "WMI", "YHU", "NWE", "NEE"];

// 2023 Periodic Review distribution in force from the 2024 general
// election: England 543, Scotland 57, Wales 32, Northern Ireland 18.
const EXPECTED_SEATS: Record<string, number> = {
  LON: 75,
  SEE: 91,
  SWE: 58,
  EAE: 61,
  EMI: 47,
  WMI: 57,
  YHU: 54,
  NWE: 73,
  NEE: 27,
  SCO: 57,
  WAL: 32,
  NIR: 18,
};

describe("ukRegions2027", () => {
  it("defines the same 12 electoral regions as 2023", () => {
    expect(new Set(ukRegions2027.map((r) => r._id))).toEqual(
      new Set(ukRegions2023.map((r) => r._id))
    );
    expect(ukRegions2027).toHaveLength(12);
  });

  it("all regions are tagged countryId=UK", () => {
    for (const r of ukRegions2027) {
      expect(r.countryId).toBe("UK");
    }
  });

  it("uses the 2024-boundary 650-seat distribution (England 543 / SCO 57 / WAL 32 / NIR 18)", () => {
    for (const r of ukRegions2027) {
      expect(r.houseDistricts, `${String(r._id)} seats`).toBe(EXPECTED_SEATS[String(r._id)]);
    }
    const england = ukRegions2027
      .filter((r) => ENGLAND_IDS.includes(String(r._id)))
      .reduce((s, r) => s + r.houseDistricts, 0);
    expect(england).toBe(543);
    const total = ukRegions2027.reduce((s, r) => s + r.houseDistricts, 0);
    expect(total).toBe(650);
  });

  it("region seeds match UK_REGIONAL_COUNCIL_SEATS", () => {
    for (const region of ukRegions2027) {
      expect(region.stateSenateSeats, `${String(region._id)} stateSenateSeats`).toBe(
        UK_REGIONAL_COUNCIL_SEATS[String(region._id)]
      );
    }
  });

  it("population and GDP grow versus the 2023 bundle (projection, not decline)", () => {
    const byId2023 = new Map(ukRegions2023.map((r) => [String(r._id), r]));
    for (const r of ukRegions2027) {
      const prev = byId2023.get(String(r._id))!;
      expect(r.population, `${String(r._id)} population`).toBeGreaterThan(prev.population);
      expect(r.gdp, `${String(r._id)} gdp`).toBeGreaterThan(prev.gdp);
    }
  });

  it("UK population sums to a plausible mid-2027 total (69M-71M)", () => {
    const total = ukRegions2027.reduce((s, r) => s + r.population, 0);
    expect(total).toBeGreaterThan(69_000_000);
    expect(total).toBeLessThan(71_000_000);
  });
});
