import { describe, it, expect } from "vitest";
import { electoralVoteUnitsFromSeats } from "./apportionment";
import {
  ELECTORAL_VOTE_UNITS,
  ELECTORAL_VOTE_UNITS_1953,
  ELECTORAL_VOTE_UNITS_1991,
} from "@/lib/constants/states";
import type { ElectoralVoteUnit } from "@/lib/constants/states";

function sharesFor(units: ElectoralVoteUnit[], stateId: string) {
  return units.filter((u) => u.stateId === stateId);
}

describe("ME/NE district electorate shares (#1464)", () => {
  // The defect: every unit resolved its electorate from `unit.stateId`, so ME
  // (3 units) and NE (4 units) each drew the whole state once per leg.
  it.each([
    ["ME", ELECTORAL_VOTE_UNITS],
    ["NE", ELECTORAL_VOTE_UNITS],
    ["ME", ELECTORAL_VOTE_UNITS_1991],
    ["NE", ELECTORAL_VOTE_UNITS_1991],
  ])("%s draws its electorate exactly once across all legs", (stateId, units) => {
    const total = sharesFor(units as ElectoralVoteUnit[], stateId).reduce(
      (sum, u) => sum + u.electorateShare,
      0
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("gives the at-large leg no electorate of its own", () => {
    const atLarge = ELECTORAL_VOTE_UNITS.find((u) => u.unitId === "ME");
    expect(atLarge?.derivesFromDistricts).toBe(true);
    expect(atLarge?.electorateShare).toBe(0);
  });

  it("splits Maine two ways and Nebraska three", () => {
    const me = sharesFor(ELECTORAL_VOTE_UNITS, "ME").filter((u) => !u.derivesFromDistricts);
    const ne = sharesFor(ELECTORAL_VOTE_UNITS, "NE").filter((u) => !u.derivesFromDistricts);
    expect(me.map((u) => u.electorateShare)).toEqual([1 / 2, 1 / 2]);
    expect(ne.map((u) => u.electorateShare)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("leaves every whole-state unit on a full share", () => {
    for (const u of ELECTORAL_VOTE_UNITS) {
      if (u.derivesFromDistricts || u.unitId.includes("_CD")) continue;
      expect(u.electorateShare, u.unitId).toBe(1);
    }
  });

  // 1952: Maine did not adopt the district method until 1972, Nebraska 1992.
  it("has no split at all in the 1950-census bundle", () => {
    expect(ELECTORAL_VOTE_UNITS_1953.some((u) => u.derivesFromDistricts)).toBe(false);
    expect(ELECTORAL_VOTE_UNITS_1953.every((u) => u.electorateShare === 1)).toBe(true);
  });

  describe("the live, year-gated builder agrees", () => {
    const seats = { ME: 2, NE: 3, CA: 52 };

    it("does not split before the adoption year", () => {
      const units = electoralVoteUnitsFromSeats(seats, { year: 1960 });
      expect(units.some((u) => u.unitId.includes("_CD"))).toBe(false);
      expect(units.every((u) => u.electorateShare === 1)).toBe(true);
    });

    it("splits once the year is reached, still summing to one state", () => {
      const units = electoralVoteUnitsFromSeats(seats, { year: 2000 });
      for (const stateId of ["ME", "NE"]) {
        const total = sharesFor(units, stateId).reduce((s, u) => s + u.electorateShare, 0);
        expect(total, stateId).toBeCloseTo(1, 10);
      }
      expect(sharesFor(units, "CA")[0].electorateShare).toBe(1);
    });

    it("scales district shares by the state's live house-seat count", () => {
      // A reapportionment that moves NE to 2 districts must re-split by halves,
      // not stay pinned to the seeded thirds.
      const units = electoralVoteUnitsFromSeats({ NE: 2 }, { year: 2000 });
      const districts = sharesFor(units, "NE").filter((u) => !u.derivesFromDistricts);
      expect(districts).toHaveLength(2);
      expect(districts.map((u) => u.electorateShare)).toEqual([1 / 2, 1 / 2]);
    });
  });
});
