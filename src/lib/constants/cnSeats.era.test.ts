import { describe, it, expect } from "vitest";
import {
  CN_NPC_SEATS,
  CN_NPC_SEATS_1953,
  TOTAL_CN_NPC_SEATS,
  TOTAL_CN_NPC_SEATS_1953,
  CN_PEOPLES_CONGRESS_SEATS,
  CN_PEOPLES_CONGRESS_SEATS_1953,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953,
  getCnNpcSeats,
  getCnPeoplesCongressSeats,
  subNationalChamberSeats,
} from "./states";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { CN_NPC_1953 } from "./historicalSeats";
import { getCountryConfig } from "./countries";

/**
 * #3779 — `CN_NPC_SEATS` / `CN_PEOPLES_CONGRESS_SEATS` were single era-blind
 * maps holding the modern apportionment, so `ensureCNElections` sized the
 * 1953 NPC race at 2,980 against a chamber every other era-aware source
 * (the region seed, the country config, and the `CN_NPC_1953` seat table that
 * #3781 landed) puts at 1,226.
 */
describe("CN seat constants are era-gated", () => {
  it("selects the 1953 bundle for 1953-default and the modern bundle otherwise", () => {
    expect(getCnNpcSeats("1953-default")).toBe(CN_NPC_SEATS_1953);
    expect(getCnPeoplesCongressSeats("1953-default")).toBe(CN_PEOPLES_CONGRESS_SEATS_1953);

    for (const preset of ["1979-default", "1991-default", "2019-default", "empty", "unknown"]) {
      expect(getCnNpcSeats(preset), preset).toBe(CN_NPC_SEATS);
      expect(getCnPeoplesCongressSeats(preset), preset).toBe(CN_PEOPLES_CONGRESS_SEATS);
    }
    expect(getCnNpcSeats(undefined)).toBe(CN_NPC_SEATS);
    expect(getCnPeoplesCongressSeats(undefined)).toBe(CN_PEOPLES_CONGRESS_SEATS);
  });

  it("pins the 1953 NPC to 1,226 deputies and the modern NPC to 2,980", () => {
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    expect(sum(getCnNpcSeats("1953-default"))).toBe(1226);
    expect(sum(getCnNpcSeats("2019-default"))).toBe(2980);
    expect(TOTAL_CN_NPC_SEATS_1953).toBe(1226);
    expect(TOTAL_CN_NPC_SEATS).toBe(2980);
  });

  it("agrees with every other era-aware source for 1953", () => {
    // The region seed…
    for (const region of cnRegions1953) {
      expect(CN_NPC_SEATS_1953[String(region._id)], String(region._id)).toBe(region.houseDistricts);
      expect(CN_PEOPLES_CONGRESS_SEATS_1953[String(region._id)], String(region._id)).toBe(
        region.stateSenateSeats
      );
    }
    expect(Object.keys(CN_NPC_SEATS_1953).sort()).toEqual(
      cnRegions1953.map((r) => String(r._id)).sort()
    );

    // …the country config for this preset…
    expect(getCountryConfig("CN", "1953-default").legislature.lowerChamber.seats).toBe(
      TOTAL_CN_NPC_SEATS_1953
    );
    expect(getCountryConfig("CN", "2019-default").legislature.lowerChamber.seats).toBe(
      TOTAL_CN_NPC_SEATS
    );

    // …and the seat table #3781 seated the chamber from.
    const seatedByRegion = new Map<string, number>();
    for (const row of CN_NPC_1953) {
      seatedByRegion.set(row.state, (seatedByRegion.get(row.state) ?? 0) + (row.seatsHeld ?? 0));
    }
    for (const [regionId, seated] of seatedByRegion) {
      expect(seated, regionId).toBe(CN_NPC_SEATS_1953[regionId]);
    }
  });

  it("keeps the modern maps pinned to the modern region seed", () => {
    for (const region of cnRegions) {
      expect(CN_NPC_SEATS[String(region._id)], String(region._id)).toBe(region.houseDistricts);
    }
    expect(Object.values(CN_PEOPLES_CONGRESS_SEATS).reduce((a, b) => a + b, 0)).toBe(
      TOTAL_CN_PEOPLES_CONGRESS_SEATS
    );
    expect(Object.values(CN_PEOPLES_CONGRESS_SEATS_1953).reduce((a, b) => a + b, 0)).toBe(
      TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953
    );
  });

  it("sizes the sub-national chamber per era, without regressing bug #0853", () => {
    // Modern: the map overrides `stateSenateSeats` (which holds the CPPCC).
    expect(subNationalChamberSeats("CN", { _id: "DB", stateSenateSeats: 175 })).toBe(321);
    expect(
      subNationalChamberSeats("CN", { _id: "DB", stateSenateSeats: 175 }, "2019-default")
    ).toBe(321);
    // 1953: the era map wins over the modern one.
    expect(
      subNationalChamberSeats("CN", { _id: "DB", stateSenateSeats: 270 }, "1953-default")
    ).toBe(270);
    // Non-CN countries are untouched by the preset.
    expect(subNationalChamberSeats("US", { _id: "CA", stateSenateSeats: 40 }, "1953-default")).toBe(
      40
    );
  });
});
