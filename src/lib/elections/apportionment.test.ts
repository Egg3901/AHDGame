import { describe, expect, it } from "vitest";
import {
  electoralVotesFromSeats,
  electoralVoteUnitsFromSeats,
  apportionHouseSeats,
  buildApportionment,
} from "./apportionment";
import {
  HOUSE_SEATS,
  HOUSE_SEATS_1991,
  ELECTORAL_VOTES,
  ELECTORAL_VOTES_1991,
  ELECTORAL_VOTE_UNITS,
  ELECTORAL_VOTE_UNITS_1991,
} from "@/lib/constants/states";

describe("EV builders reproduce the seed constants (golden — safe-swap gate)", () => {
  it("electoralVotesFromSeats == ELECTORAL_VOTES for both presets", () => {
    expect(electoralVotesFromSeats(HOUSE_SEATS)).toEqual(ELECTORAL_VOTES);
    expect(electoralVotesFromSeats(HOUSE_SEATS_1991)).toEqual(ELECTORAL_VOTES_1991);
  });
  it("electoralVoteUnitsFromSeats == ELECTORAL_VOTE_UNITS for both presets", () => {
    // Order-independent: consumers iterate the units (sum EV), they don't depend on
    // array order, and DC sorts differently when built vs the seed iteration order.
    const byId = (a: { unitId: string }, b: { unitId: string }) => a.unitId.localeCompare(b.unitId);
    expect([...electoralVoteUnitsFromSeats(HOUSE_SEATS)].sort(byId)).toEqual(
      [...ELECTORAL_VOTE_UNITS].sort(byId)
    );
    expect([...electoralVoteUnitsFromSeats(HOUSE_SEATS_1991)].sort(byId)).toEqual(
      [...ELECTORAL_VOTE_UNITS_1991].sort(byId)
    );
  });
});

describe("buildApportionment (live seats over seed)", () => {
  it("with no live override reproduces the seed apportionment (safe swap)", () => {
    const a = buildApportionment({}, "2019-default");
    expect(a.houseSeats).toEqual(HOUSE_SEATS);
    expect(a.electoralVotes).toEqual(ELECTORAL_VOTES);
  });
  it("with seed-equal live data is identical to seed (golden equivalence)", () => {
    const a = buildApportionment(HOUSE_SEATS, "2019-default");
    expect(a.electoralVotes).toEqual(ELECTORAL_VOTES);
  });
  it("a census override changes that state's seats + EV (and only that state)", () => {
    const a = buildApportionment(
      { TX: HOUSE_SEATS.TX + 2, NY: HOUSE_SEATS.NY - 1 },
      "2019-default"
    );
    expect(a.houseSeats.TX).toBe(HOUSE_SEATS.TX + 2);
    expect(a.electoralVotes.TX).toBe(ELECTORAL_VOTES.TX + 2);
    expect(a.electoralVotes.NY).toBe(ELECTORAL_VOTES.NY - 1);
    expect(a.electoralVotes.CA).toBe(ELECTORAL_VOTES.CA); // untouched
  });
  it("ignores live values for unknown (non-House) states like DC", () => {
    const a = buildApportionment({ DC: 5 }, "2019-default"); // DC has no House seats
    expect(a.electoralVotes.DC).toBe(3); // stays the fixed 23rd-Amendment 3
  });
});

describe("apportionHouseSeats (method of equal proportions)", () => {
  it("gives every state ≥1 seat and sums to totalSeats", () => {
    const seats = apportionHouseSeats({ A: 1_000_000, B: 500_000, C: 100_000 }, 10);
    expect(Object.values(seats).reduce((a, b) => a + b, 0)).toBe(10);
    for (const s of Object.values(seats)) expect(s).toBeGreaterThanOrEqual(1);
  });
  it("larger population → at least as many seats (monotone)", () => {
    const seats = apportionHouseSeats({ A: 3_000_000, B: 1_000_000 }, 5);
    expect(seats.A).toBeGreaterThanOrEqual(seats.B);
  });
  it("handles more states than seats without going negative", () => {
    const seats = apportionHouseSeats({ A: 100, B: 90, C: 80 }, 2);
    for (const s of Object.values(seats)) expect(s).toBeGreaterThanOrEqual(1);
  });
  it("reapportions 435 seats across realistic populations, sum preserved + ordered", () => {
    const pops = { CA: 39_000_000, TX: 29_000_000, FL: 21_000_000, WY: 580_000, VT: 640_000 };
    const seats = apportionHouseSeats(pops, 435);
    expect(Object.values(seats).reduce((a, b) => a + b, 0)).toBe(435);
    expect(seats.CA).toBeGreaterThan(seats.TX);
    expect(seats.TX).toBeGreaterThan(seats.FL);
    expect(seats.FL).toBeGreaterThan(seats.VT);
    expect(seats.VT).toBeGreaterThanOrEqual(seats.WY); // VT slightly larger pop
  });
});
