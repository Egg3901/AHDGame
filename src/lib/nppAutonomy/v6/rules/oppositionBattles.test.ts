import { describe, expect, it } from "vitest";
import { governmentSeatShare, oppositionBlocWorthwhile } from "./oppositionBattles";

describe("NPP engine 6.11 opposition battles", () => {
  it("counts coalition partners on the government side", () => {
    expect(governmentSeatShare({ "1": 40, "2": 20, "3": 40 }, ["1", "2"])).toBeCloseTo(0.6, 6);
  });

  it("drops the bloc against a commanding government and keeps it otherwise", () => {
    expect(oppositionBlocWorthwhile({ "1": 60, "3": 40 }, ["1"])).toBe(false);
    expect(oppositionBlocWorthwhile({ "1": 52, "3": 48 }, ["1"])).toBe(true);
  });

  it("treats an empty tally as worth contesting", () => {
    expect(oppositionBlocWorthwhile({}, ["1"])).toBe(true);
  });
});
