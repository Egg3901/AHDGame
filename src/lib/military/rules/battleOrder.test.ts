import { describe, expect, it } from "vitest";
import { compareBattleUnits } from "./battleOrder";

describe("compareBattleUnits", () => {
  it("produces one stable country-and-id order from any Mongo return order", () => {
    const units = [
      { _id: "u2", countryId: "US" },
      { _id: "u1", countryId: "US" },
      { _id: "u9", countryId: "CN" },
    ];
    const forward = [...units].sort(compareBattleUnits);
    const reversed = [...units].reverse().sort(compareBattleUnits);

    expect(forward).toEqual(reversed);
    expect(forward.map((unit) => unit._id)).toEqual(["u9", "u1", "u2"]);
  });
});
