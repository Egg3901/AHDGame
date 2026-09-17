import { describe, expect, it } from "vitest";
import { states2027 } from "./states2027";
import { US_CONGRESS_PROJECTION_2027 } from "./usCongressProjection2027";
import { US_HOUSE_2027 } from "./usHouse2027";

function seatsForParty(party: "democrat" | "republican"): number {
  return US_HOUSE_2027.filter((seat) => seat.party === party).reduce(
    (total, seat) => total + (seat.seatsHeld ?? 1),
    0
  );
}

describe("US_HOUSE_2027", () => {
  it("matches the frozen national projection", () => {
    expect(seatsForParty("democrat")).toBe(US_CONGRESS_PROJECTION_2027.house.democrat);
    expect(seatsForParty("republican")).toBe(US_CONGRESS_PROJECTION_2027.house.republican);
  });

  it("fills every state's apportioned seats exactly", () => {
    const states = states2027.filter((state) => state._id !== "DC");
    expect(states).toHaveLength(50);

    for (const state of states) {
      const seated = US_HOUSE_2027.filter((seat) => seat.state === state._id).reduce(
        (total, seat) => total + (seat.seatsHeld ?? 1),
        0
      );
      expect(seated, state._id).toBe(state.houseDistricts);
    }
  });

  it("contains no vacancies, independents, or DC voting seats", () => {
    expect(US_HOUSE_2027.some((seat) => seat.state === "DC")).toBe(false);
    expect(US_HOUSE_2027.every((seat) => seat.officeType === "house")).toBe(true);
    expect(
      US_HOUSE_2027.every((seat) => seat.party === "democrat" || seat.party === "republican")
    ).toBe(true);
  });
});
