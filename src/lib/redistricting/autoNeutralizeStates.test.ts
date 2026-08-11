import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { getAutoNeutralizeStateIds } from "./autoNeutralizeStates";

function fakeDb(policies: unknown[]): Db {
  return {
    collection() {
      return { find: () => ({ toArray: async () => policies }) };
    },
  } as unknown as Db;
}

describe("getAutoNeutralizeStateIds", () => {
  it("returns states whose redistricting authority is the independent commission (index 0)", async () => {
    const db = fakeDb([
      {
        stateId: "CA",
        legislationTypeId: "us_state_redistricting_authority",
        policyOptionIndex: 0,
      },
      {
        stateId: "TX",
        legislationTypeId: "us_state_redistricting_authority",
        policyOptionIndex: 2,
      },
      {
        stateId: "WA",
        legislationTypeId: "us_state_redistricting_authority",
        policyOptionIndex: 0,
      },
    ]);
    const result = await getAutoNeutralizeStateIds(db, "US");
    expect(result.sort()).toEqual(["CA", "WA"]);
  });
});
