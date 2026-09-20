import { describe, it, expect } from "vitest";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { getCountryConfig } from "@/lib/constants/countries";
import { seatsForCountry } from "@/lib/constants/presetSeatGroups";
import {
  UK_COMMONS_SEATS_1991,
  TOTAL_UK_COMMONS_SEATS_1991,
  getUkCommonsSeats,
  getTotalUkCommonsSeats,
} from "./states";

/**
 * The 1991 Commons, in the same shape ticket #1058 gave 1953.
 *
 * A 1991 world opens in January 1991, so its Commons is the one elected in June
 * 1987 on the 1983 boundaries — 650 seats, England 523. It was authored to the
 * APRIL 1992 result instead (651 seats, England 524), and three separate places
 * disagreed about the regional split: the chamber config, `ukRegions1991`'s
 * `houseDistricts`, and the seat roster, while spawn/allocate quietly used the
 * modern map because `getUkCommonsSeats` only branched for 1953.
 *
 * These assertions pin all four to one number per region.
 */
describe("UK Commons, 1991-default", () => {
  const regionIds = ukRegions1991.map((r) => r._id);
  const NON_ENGLISH = ["SCO", "WAL", "NIR"];

  it("apportions 650 seats across the twelve regions", () => {
    const sum = Object.values(UK_COMMONS_SEATS_1991).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_UK_COMMONS_SEATS_1991);
    expect(sum).toBe(650);
  });

  it("gives England the 523 seats the 1983 boundaries gave it", () => {
    const english = ukRegions1991
      .filter((r) => !NON_ENGLISH.includes(r._id))
      .reduce((total, r) => total + (r.houseDistricts ?? 0), 0);
    expect(english).toBe(523);
  });

  it("leaves Scotland, Wales and Northern Ireland unchanged", () => {
    const byId = Object.fromEntries(ukRegions1991.map((r) => [r._id, r.houseDistricts]));
    expect(byId.SCO).toBe(72);
    expect(byId.WAL).toBe(38);
    expect(byId.NIR).toBe(17);
  });

  it("mirrors ukRegions1991.houseDistricts region by region", () => {
    for (const region of ukRegions1991) {
      expect(UK_COMMONS_SEATS_1991[region._id], region._id).toBe(region.houseDistricts);
    }
    expect(new Set(Object.keys(UK_COMMONS_SEATS_1991))).toEqual(new Set(regionIds));
  });

  it("is what getUkCommonsSeats returns for the 1991 preset", () => {
    expect(getUkCommonsSeats("1991-default")).toBe(UK_COMMONS_SEATS_1991);
    expect(getTotalUkCommonsSeats("1991-default")).toBe(650);
  });

  it("matches the chamber size the 1991 era override declares", () => {
    const config = getCountryConfig("UK", "1991-default");
    expect(config.legislature.lowerChamber.seats).toBe(TOTAL_UK_COMMONS_SEATS_1991);
  });

  it("seats every region's roster to exactly its district count", () => {
    const seated: Record<string, number> = {};
    for (const seat of seatsForCountry("1991-default", "UK")) {
      if (seat.officeType !== "commons") continue;
      seated[seat.state] = (seated[seat.state] ?? 0) + (seat.seatsHeld ?? 1);
    }
    for (const region of ukRegions1991) {
      expect(seated[region._id] ?? 0, region._id).toBe(region.houseDistricts);
    }
  });

  it("seats the June 1987 parliament, not the April 1992 one", () => {
    const byParty: Record<string, number> = {};
    for (const seat of seatsForCountry("1991-default", "UK")) {
      if (seat.officeType !== "commons") continue;
      byParty[seat.party] = (byParty[seat.party] ?? 0) + (seat.seatsHeld ?? 1);
    }
    // 1987: Con 376, Lab 229, Alliance 22 (Liberal Democrat by January 1991),
    // UUP 9, DUP 3, SDLP 3, PC 3, SNP 3, UPUP 1, SF 1.
    expect(byParty.uk_conservative).toBe(376);
    expect(byParty.uk_labour).toBe(229);
    expect(byParty.uk_libdem).toBe(22);
    expect(byParty.uk_snp).toBe(3);
    expect(byParty.uk_plaid).toBe(3);
    expect(byParty.uk_uup).toBe(9);
    expect(byParty.uk_dup).toBe(3);
    expect(byParty.uk_sdlp).toBe(3);
    expect(byParty.uk_sf).toBe(1);
    expect(byParty.uk_independent).toBe(1);
  });
});
