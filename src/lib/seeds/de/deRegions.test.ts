import { describe, it, expect } from "vitest";
import { deRegions, DE_WAHLKREISE_PER_LAND } from "./deRegions";
import {
  DE_WAHLKREIS_SEATS,
  DE_LANDTAG_SEATS,
  TOTAL_DE_WAHLKREIS_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
} from "@/lib/constants/states";

describe("deRegions", () => {
  it("defines exactly 16 Bundesländer", () => {
    expect(deRegions).toHaveLength(16);
  });

  it("all regions are tagged countryId=DE", () => {
    for (const r of deRegions) {
      expect(r.countryId).toBe("DE");
    }
  });

  it("IDs match the standard 2-letter Bundesland codes", () => {
    const expected = new Set([
      "BW",
      "BY",
      "BE",
      "BB",
      "BRE",
      "HH",
      "HE",
      "MV",
      "NI",
      "NW",
      "RP",
      "SL",
      "SN",
      "ST",
      "SH",
      "TH",
    ]);
    expect(new Set(deRegions.map((r) => r._id))).toEqual(expected);
  });

  it("Wahlkreise sum to 299 (2023 reform total)", () => {
    const total = deRegions.reduce((s, r) => s + r.houseDistricts, 0);
    expect(total).toBe(TOTAL_DE_WAHLKREIS_SEATS);
    expect(total).toBe(299);
  });

  it("Bundestag size constant is 630 (2023 reform cap)", () => {
    expect(TOTAL_DE_BUNDESTAG_SEATS).toBe(630);
  });

  it("population sums to within 2% of 2023 Germany total (~84M)", () => {
    const total = deRegions.reduce((s, r) => s + r.population, 0);
    expect(total).toBeGreaterThan(82_000_000);
    expect(total).toBeLessThan(86_000_000);
  });

  it("GDP sums to within 5% of 2022 Germany total (~3.87T EUR)", () => {
    const total = deRegions.reduce((s, r) => s + r.gdp, 0);
    expect(total).toBeGreaterThan(3_700_000);
    expect(total).toBeLessThan(4_000_000);
  });

  it("DE_WAHLKREIS_SEATS matches deRegions.houseDistricts", () => {
    for (const r of deRegions) {
      expect(DE_WAHLKREIS_SEATS[r._id]).toBe(r.houseDistricts);
    }
    // And the derived constant in deRegions.ts matches too
    for (const r of deRegions) {
      expect(DE_WAHLKREISE_PER_LAND[r._id]).toBe(r.houseDistricts);
    }
  });

  it("DE_LANDTAG_SEATS matches deRegions.stateSenateSeats", () => {
    for (const r of deRegions) {
      expect(DE_LANDTAG_SEATS[r._id]).toBe(r.stateSenateSeats);
    }
  });

  it("every region is assigned to one of the four compass groupings", () => {
    const allowed = new Set(["Norden", "Süden", "Osten", "Westen"]);
    for (const r of deRegions) {
      expect(allowed.has(r.region)).toBe(true);
    }
  });
});
