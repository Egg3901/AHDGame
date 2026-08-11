import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { chamberMajorityParty, checkStateTrifecta } from "./trifecta";

describe("chamberMajorityParty", () => {
  it("returns the >50% party by seats", () => {
    expect(
      chamberMajorityParty([
        { party: "1", seatsHeld: 30 },
        { party: "2", seatsHeld: 20 },
      ])
    ).toBe("1");
  });
  it("returns null when no party has a majority", () => {
    expect(
      chamberMajorityParty([
        { party: "1", seatsHeld: 10 },
        { party: "2", seatsHeld: 10 },
        { party: "3", seatsHeld: 10 },
      ])
    ).toBeNull();
  });
});

function fakeDb(governor: unknown, chamber: unknown[]): Db {
  return {
    collection(name: string) {
      return {
        findOne: async () => (name === "electedOfficials" ? governor : null),
        find: () => ({ toArray: async () => chamber }),
      };
    },
  } as unknown as Db;
}

describe("checkStateTrifecta", () => {
  it("is a trifecta when governor party == chamber majority party", async () => {
    const db = fakeDb({ party: "1", state: "CA" }, [
      { party: "1", seatsHeld: 30 },
      { party: "2", seatsHeld: 10 },
    ]);
    const res = await checkStateTrifecta(db, "US", "CA");
    expect(res.hasTrifecta).toBe(true);
    expect(res.partyId).toBe("1");
  });

  it("is not a trifecta when governor and chamber differ", async () => {
    const db = fakeDb({ party: "2", state: "CA" }, [
      { party: "1", seatsHeld: 30 },
      { party: "2", seatsHeld: 10 },
    ]);
    const res = await checkStateTrifecta(db, "US", "CA");
    expect(res.hasTrifecta).toBe(false);
    expect(res.partyId).toBeNull();
  });
});
