import { describe, expect, it } from "vitest";
import {
  HU_1991_TERRITORIAL_DISTRICTS,
  HU_1991_CONSTITUENCIES,
} from "../data/electoralDistricts1991";
import { HU_1991_REGION_POPULATION } from "../data/huPopulation1991";
import { HU_1990_TERRITORIAL_VOTES } from "./fixtures/territorial1990";
import {
  eligibleHu1991Parties,
  countHu1991TerritorialList,
  countHu1991NationalCompensation,
  sumHu1991Fragments,
} from "./listAllocation1991";
const lists = (votes: Record<string, number>) =>
  Object.entries(votes).map(([partyId, votes], index) => ({
    partyId,
    votes,
    ballotOrder: index + 1,
  }));

describe("Hungarian 1991 statutory lists", () => {
  it("keeps statutory 176/152/58 capacities and the full county census", () => {
    expect(HU_1991_CONSTITUENCIES).toHaveLength(176);
    expect(new Set(HU_1991_CONSTITUENCIES.map((row) => row.id)).size).toBe(176);
    expect(HU_1991_TERRITORIAL_DISTRICTS.reduce((s, r) => s + r.territorialSeats, 0)).toBe(152);
    const population: Record<string, number> = {};
    for (const row of HU_1991_TERRITORIAL_DISTRICTS)
      population[row.regionId] = (population[row.regionId] ?? 0) + row.population;
    expect(population).toEqual(HU_1991_REGION_POPULATION);
  });
  it("uses a strict four-percent threshold before compensation", () => {
    expect(eligibleHu1991Parties(lists({ A: 9600, B: 400 }))).toEqual(["A"]);
    expect(eligibleHu1991Parties(lists({ A: 9599, B: 401 }))).toEqual(["A", "B"]);
  });
  it("reproduces every official 1990 regional party total and transfers 32 seats nationally", () => {
    const nationalVotes: Record<string, number> = {};
    for (const votes of Object.values(HU_1990_TERRITORIAL_VOTES))
      for (const [party, n] of Object.entries(votes))
        nationalVotes[party] = (nationalVotes[party] ?? 0) + n;
    const eligible = eligibleHu1991Parties(lists(nationalVotes));
    expect(eligible.sort()).toEqual(["FIDESZ", "FKgP", "KDNP", "MDF", "MSZP", "SZDSZ"]);
    const seats: Record<string, number> = {};
    let unfilled = 0;
    for (const county of HU_1991_TERRITORIAL_DISTRICTS) {
      const result = countHu1991TerritorialList(
        lists({ ...HU_1990_TERRITORIAL_VOTES[county.countyCode] }),
        county.territorialSeats,
        eligible
      );
      for (const party of eligible)
        seats[party] = (seats[party] ?? 0) + (result.partySeats[party] ?? 0);
      unfilled += result.unfilledSeats;
    }
    expect(seats).toEqual({ MDF: 40, SZDSZ: 34, FKgP: 16, MSZP: 14, FIDESZ: 8, KDNP: 8 });
    expect(unfilled).toBe(32);
    expect(58 + unfilled).toBe(90);
  });
  it("requires more than two thirds of a quota and debits an under-quota mandate", () => {
    const exact = countHu1991TerritorialList(lists({ A: 500, B: 200, below: 200 }), 2, ["A", "B"]);
    expect(exact.partySeats).toEqual({ A: 1, B: 0, below: 0 });
    expect(exact.unfilledSeats).toBe(1);
    expect(exact.fragments.A).toEqual({ numerator: "600", denominator: "3" });
    const over = countHu1991TerritorialList(lists({ A: 499, B: 201, below: 200 }), 2, ["A", "B"]);
    expect(over.partySeats).toEqual({ A: 1, B: 1, below: 0 });
    expect(over.fragments.B).toEqual({ numerator: "-297", denominator: "3" });
  });
  it("sums exact deficits and positive fragments without float truncation", () => {
    expect(
      sumHu1991Fragments([
        { numerator: "-1", denominator: "3" },
        { numerator: "1", denominator: "6" },
      ])
    ).toEqual({ numerator: "-1", denominator: "6" });
    expect(sumHu1991Fragments([])).toEqual({ numerator: "0", denominator: "1" });
  });
  it("allocates national D'Hondt with explicit ballot-order quotient ties", () => {
    const rows = [
      { partyId: "A", fragments: { numerator: "100", denominator: "1" }, ballotOrder: 2 },
      { partyId: "B", fragments: { numerator: "100", denominator: "1" }, ballotOrder: 1 },
    ];
    expect(countHu1991NationalCompensation(rows, 59)).toEqual({
      partySeats: { A: 29, B: 30 },
      unfilledSeats: 0,
    });
    expect(countHu1991NationalCompensation([...rows].reverse(), 59)).toEqual({
      partySeats: { B: 30, A: 29 },
      unfilledSeats: 0,
    });
  });
  it("does not manufacture national mandates for nonpositive fragment pools", () => {
    expect(
      countHu1991NationalCompensation(
        [{ partyId: "A", fragments: { numerator: "-1", denominator: "1" }, ballotOrder: 1 }],
        58
      )
    ).toEqual({ partySeats: { A: 0 }, unfilledSeats: 58 });
  });
  it("bounds simultaneous quota claims by serial without overfilling a county", () => {
    expect(countHu1991TerritorialList(lists({ A: 600, B: 400 }), 4, ["A", "B"]).partySeats).toEqual(
      { A: 3, B: 1 }
    );
    expect(countHu1991TerritorialList(lists({ B: 400, A: 600 }), 4, ["A", "B"]).partySeats).toEqual(
      { B: 2, A: 2 }
    );
    expect(countHu1991TerritorialList(lists({ A: 1000 }), 4, ["A"]).partySeats).toEqual({ A: 4 });
  });
  it("rejects corrupt list identities and capacities", () => {
    expect(() => countHu1991TerritorialList(lists({ A: 100 }), 0, ["A"])).toThrow(/capacity/);
    expect(() =>
      countHu1991NationalCompensation(
        [{ partyId: "A", fragments: { numerator: "1", denominator: "0" }, ballotOrder: 1 }],
        58
      )
    ).toThrow(/positive/);
  });
});
