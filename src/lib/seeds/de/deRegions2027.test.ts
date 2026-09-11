import { describe, it, expect } from "vitest";
import { deRegions2027 } from "./deRegions2027";
import { deRegions2023 } from "./deRegions2023";
import { DE_WAHLKREIS_SEATS, DE_LANDTAG_SEATS } from "@/lib/constants/states";

describe("deRegions2027", () => {
  it("defines exactly 16 Bundesländer", () => {
    expect(deRegions2027).toHaveLength(16);
  });

  it("all regions are tagged countryId=DE", () => {
    for (const r of deRegions2027) {
      expect(r.countryId).toBe("DE");
    }
  });

  it("IDs match the standard 2-letter Bundesland codes", () => {
    expect(new Set(deRegions2027.map((r) => r._id))).toEqual(
      new Set(deRegions2023.map((r) => r._id))
    );
  });

  it("Wahlkreise sum to 299 and match the structural constants", () => {
    const total = deRegions2027.reduce((s, r) => s + r.houseDistricts, 0);
    expect(total).toBe(299);
    for (const r of deRegions2027) {
      expect(DE_WAHLKREIS_SEATS[String(r._id)]).toBe(r.houseDistricts);
    }
  });

  it("Landtag seats match DE_LANDTAG_SEATS", () => {
    for (const r of deRegions2027) {
      expect(DE_LANDTAG_SEATS[String(r._id)]).toBe(r.stateSenateSeats);
    }
  });

  it("population sums to a plausible 2027 Germany total (83M-85M)", () => {
    const total = deRegions2027.reduce((s, r) => s + r.population, 0);
    expect(total).toBeGreaterThan(83_000_000);
    expect(total).toBeLessThan(85_000_000);
  });

  it("GDP grows versus the 2023 bundle (nominal projection, not decline)", () => {
    const byId2023 = new Map(deRegions2023.map((r) => [String(r._id), r]));
    for (const r of deRegions2027) {
      const prev = byId2023.get(String(r._id))!;
      expect(r.gdp, `${String(r._id)} gdp`).toBeGreaterThan(prev.gdp);
    }
  });

  it("every region is assigned to one of the four compass groupings", () => {
    const allowed = new Set(["Norden", "Süden", "Osten", "Westen"]);
    for (const r of deRegions2027) {
      expect(allowed.has(String(r.region))).toBe(true);
    }
  });
});
