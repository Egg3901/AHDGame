import { describe, it, expect } from "vitest";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";

describe("RU_NATIONALITIES_SEATS (D11)", () => {
  it("covers exactly the 14 RU regions of both presets", () => {
    const keys = Object.keys(RU_NATIONALITIES_SEATS).sort();
    expect(keys).toEqual(ruRegions1953.map((r) => r._id).sort());
    expect(keys).toEqual(ruRegions.map((r) => r._id).sort());
  });

  it("floors every region at 20 contestable seats", () => {
    for (const [region, seats] of Object.entries(RU_NATIONALITIES_SEATS)) {
      expect(seats, region).toBeGreaterThanOrEqual(20);
    }
  });

  it("totals 515 (25/union republic + 11/autonomous republic, min-20 floor)", () => {
    // 640 while Ukraine (25), Byelorussia (25) and the Baltics (75) were RU
    // regions; those 125 seats left with them when they became countries.
    const total = Object.values(RU_NATIONALITIES_SEATS).reduce((a, b) => a + b, 0);
    expect(total).toBe(515);
  });

  it("weights multi-republic regions above single-republic ones", () => {
    expect(RU_NATIONALITIES_SEATS.CAS).toBe(111); // 4 SSRs + Karakalpak ASSR
    expect(RU_NATIONALITIES_SEATS.TRA).toBe(108); // 3 SSRs + 3 ASSRs
    expect(RU_NATIONALITIES_SEATS.KAZ).toBe(25); // 1 SSR
    expect(RU_NATIONALITIES_SEATS.MOL).toBe(25); // 1 SSR
  });
});

describe("republic-soviet chamber sizes (amended D11)", () => {
  it("every region of both presets authors a positive stateSenateSeats chamber", () => {
    for (const regions of [ruRegions1953, ruRegions]) {
      for (const r of regions) {
        expect(r.stateSenateSeats, r._id).toBeGreaterThan(0);
      }
    }
  });
});
