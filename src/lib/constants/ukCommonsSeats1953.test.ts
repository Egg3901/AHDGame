import { describe, it, expect } from "vitest";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import {
  UK_COMMONS_SEATS,
  UK_COMMONS_SEATS_1953,
  TOTAL_UK_COMMONS_SEATS,
  TOTAL_UK_COMMONS_SEATS_1953,
  getUkCommonsSeats,
  getTotalUkCommonsSeats,
} from "./states";

describe("UK Commons era seat maps (ticket #1058)", () => {
  it("1953 map sums to 625 and mirrors ukRegions1953.houseDistricts", () => {
    const sum = Object.values(UK_COMMONS_SEATS_1953).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_UK_COMMONS_SEATS_1953);
    expect(sum).toBe(625);

    for (const region of ukRegions1953) {
      expect(UK_COMMONS_SEATS_1953[region._id], region._id).toBe(region.houseDistricts);
    }
    expect(new Set(Object.keys(UK_COMMONS_SEATS_1953))).toEqual(
      new Set(ukRegions1953.map((r) => r._id))
    );
  });

  it("modern map stays at 650", () => {
    expect(Object.values(UK_COMMONS_SEATS).reduce((a, b) => a + b, 0)).toBe(TOTAL_UK_COMMONS_SEATS);
    expect(TOTAL_UK_COMMONS_SEATS).toBe(650);
  });

  it("getUkCommonsSeats / getTotalUkCommonsSeats select by preset", () => {
    expect(getUkCommonsSeats("1953-default")).toBe(UK_COMMONS_SEATS_1953);
    expect(getTotalUkCommonsSeats("1953-default")).toBe(625);

    expect(getUkCommonsSeats("2019-default")).toBe(UK_COMMONS_SEATS);
    expect(getUkCommonsSeats("1991-default")).toBe(UK_COMMONS_SEATS);
    expect(getUkCommonsSeats(undefined)).toBe(UK_COMMONS_SEATS);
    expect(getTotalUkCommonsSeats("2019-default")).toBe(650);
  });
});
