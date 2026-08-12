import { describe, it, expect } from "vitest";
import { ddRegions } from "./ddRegions";
import { ddRegionCensusData } from "./ddRegionCensusData";
import { DD_VOLKSKAMMER_1979 } from "@/lib/constants/historicalSeats";
import { EAST_DE_REGION_CODES } from "@/lib/maps/germanyGeometry";

const VOLKSKAMMER_TOTAL = 500;

const DIMS = {
  ethnicity: ["german", "other"],
  age: ["young", "mid", "mature", "senior"],
  education: ["primary_or_below", "secondary", "vocational", "university"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
} as const;

describe("ddRegions (GDR — eastern Länder model)", () => {
  it("is the 5 eastern Länder + East Berlin, all owned by DD", () => {
    expect(ddRegions).toHaveLength(6);
    for (const r of ddRegions) expect(r.countryId).toBe("DD");
    // The five map codes are the same eastern-Länder codes the overlay renders.
    for (const code of EAST_DE_REGION_CODES) {
      expect(ddRegions.map((r) => r._id)).toContain(code);
    }
    // Plus East Berlin (DD-exclusive, no separate map shape).
    expect(ddRegions.map((r) => r._id)).toContain("BEO");
  });

  it("Volkskammer seats (houseDistricts) sum to 500", () => {
    const sum = ddRegions.reduce((s, r) => s + r.houseDistricts, 0);
    expect(sum).toBe(VOLKSKAMMER_TOTAL);
  });

  it("Landtag seats (stateSenateSeats) sum to 80", () => {
    const sum = ddRegions.reduce((s, r) => s + (r.stateSenateSeats ?? 0), 0);
    expect(sum).toBe(80);
  });

  it("the Volkskammer seat map matches each Land's houseDistricts and totals 500", () => {
    const perState = new Map<string, number>();
    for (const seat of DD_VOLKSKAMMER_1979) {
      perState.set(seat.state, (perState.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    // Every seat references a real DD region, and per-Land totals match houseDistricts.
    for (const r of ddRegions) {
      expect(perState.get(r._id), `${r._id} seat total`).toBe(r.houseDistricts);
    }
    expect([...perState.keys()].sort()).toEqual(ddRegions.map((r) => r._id).sort());
    const total = [...perState.values()].reduce((s, n) => s + n, 0);
    expect(total).toBe(VOLKSKAMMER_TOTAL);
  });

  it("the SED holds a National-Front majority of the chamber", () => {
    const bySed = DD_VOLKSKAMMER_1979.filter((s) => s.party === "dd_sed").reduce(
      (s, r) => s + (r.seatsHeld ?? 0),
      0
    );
    expect(bySed).toBeGreaterThan(VOLKSKAMMER_TOTAL / 2);
  });
});

describe("ddRegionCensusData (1979)", () => {
  it("has one Layer-1 profile per DD region", () => {
    expect(new Set(Object.keys(ddRegionCensusData))).toEqual(new Set(ddRegions.map((r) => r._id)));
  });

  it("every sub-category sums to 100 per region", () => {
    for (const [id, profile] of Object.entries(ddRegionCensusData)) {
      for (const [dim, keys] of Object.entries(DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });
});
