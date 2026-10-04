import { describe, expect, it } from "vitest";
import {
  BG_1990_CONSTITUENCIES,
  BG_1990_LIST_DISTRICTS,
  BG_1990_REGION_CAPACITY,
} from "../data/foundingDistricts1990";
import { countBgFoundingLists } from "./foundingLists1990";

function ballots(votes = { a: 600, b: 360, threshold: 40 }) {
  return BG_1990_LIST_DISTRICTS.map((row) => ({ districtId: row.id, partyVotes: votes }));
}
describe("Bulgarian founding parallel list tier", () => {
  it("provides200 constituency seats and200 list seats in28 districts", () => {
    expect(BG_1990_CONSTITUENCIES).toHaveLength(200);
    expect(new Set(BG_1990_CONSTITUENCIES.map((row) => row.id)).size).toBe(200);
    expect(BG_1990_LIST_DISTRICTS).toHaveLength(28);
    expect(BG_1990_LIST_DISTRICTS.reduce((sum, row) => sum + row.seats, 0)).toBe(200);
    expect(Object.values(BG_1990_REGION_CAPACITY).reduce((sum, value) => sum + value, 0)).toBe(400);
  });
  it("uses the exact nationwide four-percent threshold and conserves200 list seats", () => {
    const result = countBgFoundingLists(ballots());
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Missing founding allocation");
    expect(result.partySeats).toEqual({ a: 120, b: 72, threshold: 8 });
    for (const district of BG_1990_LIST_DISTRICTS)
      expect(
        Object.values(result.districtSeats[district.id]).reduce((sum, value) => sum + value, 0)
      ).toBe(district.seats);
    expect(countBgFoundingLists(ballots({ a: 600, b: 361, threshold: 39 }))).toMatchObject({
      partySeats: { threshold: 0 },
    });
  });
  it("retains national seats when district capacities require balancing", () => {
    const result = countBgFoundingLists(
      BG_1990_LIST_DISTRICTS.map((row, index) => ({
        districtId: row.id,
        partyVotes: { a: index % 2 ? 100 : 900, b: index % 2 ? 900 : 100 },
      }))
    );
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Missing balanced allocation");
    for (const party of ["a", "b"])
      expect(
        Object.values(result.districtSeats).reduce((sum, row) => sum + (row[party] ?? 0), 0)
      ).toBe(result.partySeats[party]);
  });
  it("does not admit independents into the party-list tier", () => {
    expect(() =>
      countBgFoundingLists(ballots().map((row) => ({ ...row, partyVotes: { independent: 100 } })))
    ).toThrow("party list");
  });
  it("defers a count with no valid votes or no list above the threshold", () => {
    expect(countBgFoundingLists(ballots({ a: 0, b: 0, threshold: 0 }))).toEqual({
      kind: "deferred",
      reason: "no-valid-list-votes",
    });
    const votes = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, 100]));
    expect(
      countBgFoundingLists(
        BG_1990_LIST_DISTRICTS.map((row) => ({ districtId: row.id, partyVotes: votes }))
      )
    ).toEqual({ kind: "deferred", reason: "no-eligible-list" });
  });
  it("does not award list seats in a district with no supported registered lists", () => {
    const rows = ballots();
    rows[0] = { ...rows[0], partyVotes: { a: 0, b: 0, threshold: 0 } };
    expect(countBgFoundingLists(rows)).toEqual({
      kind: "deferred",
      reason: "insufficient-district-list-support",
    });
  });
  it("rejects missing, duplicated or unknown districts and unsafe totals", () => {
    expect(() => countBgFoundingLists(ballots().slice(1))).toThrow("all28");
    expect(() => countBgFoundingLists([...ballots().slice(1), ballots()[1]])).toThrow("all28");
    expect(() =>
      countBgFoundingLists(ballots({ a: Number.MAX_SAFE_INTEGER, b: 1, threshold: 1 }))
    ).toThrow("precision");
  });
});
