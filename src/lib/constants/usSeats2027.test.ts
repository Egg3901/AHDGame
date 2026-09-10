import { describe, expect, it } from "vitest";
import { getPresetSeats } from "./historicalSeats";
import { states2027 } from "@/lib/seeds/reference/states2027";
import { US_CONGRESS_PROJECTION_2027 } from "@/lib/seeds/reference/usCongressProjection2027";

describe("2027 projected US federal roster", () => {
  const seats = getPresetSeats("2027-default");

  it("uses an explicit roster instead of the 2019 fallback", () => {
    expect(seats).not.toEqual(getPresetSeats("2019-default"));
    expect(seats.some((seat) => seat.officeType === "house")).toBe(true);
    expect(seats.some((seat) => seat.officeType === "senate")).toBe(true);
  });

  it("matches the projected chamber totals", () => {
    const house = seats.filter((seat) => seat.officeType === "house");
    const senate = seats.filter((seat) => seat.officeType === "senate");
    const countHouse = (party: string) =>
      house
        .filter((seat) => seat.party === party)
        .reduce((total, seat) => total + (seat.seatsHeld ?? 1), 0);

    expect(countHouse("democrat")).toBe(US_CONGRESS_PROJECTION_2027.house.democrat);
    expect(countHouse("republican")).toBe(US_CONGRESS_PROJECTION_2027.house.republican);
    expect(senate).toHaveLength(100);
  });

  it("fills every state's House apportionment", () => {
    for (const state of states2027.filter((entry) => entry._id !== "DC")) {
      const total = seats
        .filter((seat) => seat.officeType === "house" && seat.state === state._id)
        .reduce((sum, seat) => sum + (seat.seatsHeld ?? 1), 0);
      expect(total, state._id).toBe(state.houseDistricts);
    }
  });
});
