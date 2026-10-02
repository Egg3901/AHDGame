import { describe, expect, it } from "vitest";
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import { countHuMixed1991, type Hu1991MixedBallots } from "./mixedElection1991";

function ballots(): Hu1991MixedBallots {
  return {
    constituencies: HU_1991_CONSTITUENCIES.map((row) => ({
      id: row.id,
      first: {
        registeredVoters: 1000,
        ballotsCast: 600,
        candidates: [
          { candidateId: row.id + ":A", partyId: "A", votes: 400 },
          { candidateId: row.id + ":B", partyId: "B", votes: 200 },
        ],
      },
    })),
    territorial: HU_1991_TERRITORIAL_DISTRICTS.map((row) => ({
      id: row.id,
      first: {
        registeredVoters: 1000,
        ballotsCast: 600,
        lists: [
          { partyId: "A", votes: 360, ballotOrder: 1 },
          { partyId: "B", votes: 240, ballotOrder: 2 },
        ],
      },
    })),
    nationalLists: [
      { partyId: "A", ballotOrder: 1 },
      { partyId: "B", ballotOrder: 2 },
    ],
  };
}

describe("Hungarian 1991 whole mixed count", () => {
  it("conserves 386 mandates across all three tiers and keeps winner surplus out", () => {
    const result = countHuMixed1991(ballots());
    expect(result.kind).toBe("counted");
    if (result.kind !== "counted") throw new Error("Fixture has valid majorities");
    expect(Object.keys(result.constituencyWinners)).toHaveLength(176);
    expect(result.constituencySeats).toEqual({ A: 176 });
    expect(Object.values(result.partySeats).reduce((s, n) => s + n, 0)).toBe(386);
    expect(
      result.nationalCapacity +
        Object.values(result.territorialSeats)
          .flatMap(Object.values)
          .reduce((s, n) => s + n, 0)
    ).toBe(210);
    expect(result.constituencyVacancies).toEqual([]);
    expect(result.nationalVacancies).toBe(0);
    const reversed = ballots();
    reversed.constituencies = [...reversed.constituencies].reverse();
    reversed.territorial = [...reversed.territorial].reverse();
    expect(countHuMixed1991(reversed)).toEqual(result);
  });
  it("waits for qualified second rounds without manufacturing a majority", () => {
    const input = ballots();
    const first = input.constituencies[0];
    first.first.candidates = [
      { ...first.first.candidates[0], votes: 300 },
      { ...first.first.candidates[1], votes: 300 },
    ];
    expect(countHuMixed1991(input)).toMatchObject({
      kind: "pending",
      reason: "runoff-required",
      constituencyRunoffs: { [first.id]: [first.id + ":A", first.id + ":B"] },
    });
    first.second = {
      registeredVoters: 1000,
      ballotsCast: 300,
      candidates: [
        { ...first.first.candidates[0], votes: 160 },
        { ...first.first.candidates[1], votes: 140 },
      ],
    };
    expect(countHuMixed1991(input).kind).toBe("counted");
  });
  it("retains a tied constituency vacancy while conserving all statutory seats", () => {
    const input = ballots();
    const first = input.constituencies[0];
    first.first.candidates = [
      { ...first.first.candidates[0], votes: 300 },
      { ...first.first.candidates[1], votes: 300 },
    ];
    first.second = {
      registeredVoters: 1000,
      ballotsCast: 300,
      candidates: [
        { ...first.first.candidates[0], votes: 150 },
        { ...first.first.candidates[1], votes: 150 },
      ],
    };
    const result = countHuMixed1991(input);
    expect(result.kind).toBe("counted");
    if (result.kind !== "counted") throw new Error("Runoff has closed");
    expect(result.constituencyVacancies).toEqual([first.id]);
    expect(result.constituencyWinners[first.id]).toBeNull();
    expect(Object.values(result.partySeats).reduce((s, n) => s + n, 0)).toBe(385);
  });
  it("requires a valid territorial rerun when initial turnout equals half", () => {
    const input = ballots();
    const first = input.territorial[0];
    first.first = {
      ...first.first,
      ballotsCast: 500,
      lists: [
        { partyId: "A", votes: 300, ballotOrder: 1 },
        { partyId: "B", votes: 200, ballotOrder: 2 },
      ],
    };
    expect(countHuMixed1991(input)).toMatchObject({
      kind: "pending",
      territorialRunoffs: [first.id],
    });
    first.second = {
      registeredVoters: 1000,
      ballotsCast: 300,
      lists: [
        { partyId: "A", votes: 180, ballotOrder: 1 },
        { partyId: "B", votes: 120, ballotOrder: 2 },
      ],
    };
    expect(countHuMixed1991(input).kind).toBe("counted");
  });
  it("rejects incomplete coverage and a person contesting multiple constituencies", () => {
    const input = ballots();
    input.constituencies = input.constituencies.slice(1);
    expect(() => countHuMixed1991(input)).toThrow(/all 176/);
    const duplicate = ballots();
    duplicate.constituencies[1].first.candidates = [
      duplicate.constituencies[0].first.candidates[0],
      duplicate.constituencies[1].first.candidates[1],
    ];
    expect(() => countHuMixed1991(duplicate)).toThrow(/person/);
  });
  it("rejects a national filing with only six territorial lists even below four percent", () => {
    const input = ballots();
    input.territorial = input.territorial.map((row, index) => ({
      ...row,
      first: {
        ...row.first,
        lists: row.first.lists.filter((list) => list.partyId !== "B" || index < 6),
      },
    }));
    expect(() => countHuMixed1991(input)).toThrow(/seven filed/);
  });
  it("rejects a county list without its statutory constituency nominations", () => {
    const input = ballots();
    const countyId = HU_1991_CONSTITUENCIES[0].countyId;
    input.constituencies = input.constituencies.map((row) => ({
      ...row,
      first: {
        ...row.first,
        candidates: row.first.candidates.filter(
          (candidate) =>
            candidate.partyId !== "B" ||
            HU_1991_CONSTITUENCIES.find((d) => d.id === row.id)!.countyId !== countyId
        ),
      },
    }));
    expect(() => countHuMixed1991(input)).toThrow(/statutory filed/);
  });
  it("validates national list identities and serials before eligibility filtering", () => {
    for (const invalid of [
      { partyId: "A", ballotOrder: 3 },
      { partyId: "minor", ballotOrder: 1 },
      { partyId: "independent", ballotOrder: 3 },
      { partyId: "minor", ballotOrder: 0 },
    ]) {
      const input = ballots();
      input.nationalLists = [...input.nationalLists, invalid];
      expect(() => countHuMixed1991(input)).toThrow(/identity or serial/);
    }
  });
  it("freezes territorial list serials for the second round", () => {
    const input = ballots();
    const first = input.territorial[0];
    first.first = {
      ...first.first,
      ballotsCast: 0,
      lists: first.first.lists.map((row) => ({ ...row, votes: 0 })),
    };
    first.second = {
      registeredVoters: 1000,
      ballotsCast: 300,
      lists: [
        { partyId: "A", votes: 180, ballotOrder: 2 },
        { partyId: "B", votes: 120, ballotOrder: 1 },
      ],
    };
    expect(() => countHuMixed1991(input)).toThrow(/new list/);
  });
});
