import { describe, expect, it } from "vitest";
import {
  allocateHungaryMixed2014,
  HU_CONSTITUENCY_SEATS,
  HU_LIST_SEATS,
} from "./mixedElection2014";

function districts(votes: ReadonlyArray<{ partyId: string; votes: number }>) {
  return Array.from({ length: HU_CONSTITUENCY_SEATS }, (_, index) => ({
    id: `HU-${index + 1}`,
    votes,
  }));
}

describe("Hungary's 2014 mixed parliamentary formula", () => {
  it("combines 106 plurality seats and 93 D'Hondt list seats from separate ballots", () => {
    const result = allocateHungaryMixed2014(
      districts([
        { partyId: "a", votes: 60 },
        { partyId: "b", votes: 40 },
      ]),
      [
        { partyId: "a", votes: 6_000 },
        { partyId: "b", votes: 4_000 },
      ]
    );
    expect(result.constituencySeats).toEqual({ a: 106 });
    expect(result.compensationVotes).toEqual({ a: 106 * 19, b: 106 * 40 });
    expect(result.listSeats).toEqual({ a: 46, b: 47 });
    expect(Object.values(result.listSeats).reduce((a, b) => a + b, 0)).toBe(HU_LIST_SEATS);
    expect(Object.values(result.totalSeats).reduce((a, b) => a + b, 0)).toBe(199);
  });

  it("uses raw list votes for the 5%, 10% and 15% eligibility thresholds", () => {
    const result = allocateHungaryMixed2014(
      districts([
        { partyId: "a", votes: 51 },
        { partyId: "b", votes: 49 },
      ]),
      [
        { partyId: "a", votes: 7_470 },
        { partyId: "b", votes: 530 },
        { partyId: "two", votes: 999, memberParties: 2 },
        { partyId: "three", votes: 1_499, memberParties: 3 },
      ]
    );
    expect(result.listSeats.b).toBeGreaterThan(0);
    expect(result.listSeats.two).toBeUndefined();
    expect(result.listSeats.three).toBeUndefined();
  });

  it("rejects an incomplete district result instead of silently giving out list seats", () => {
    expect(() =>
      allocateHungaryMixed2014(districts([{ partyId: "a", votes: 1 }]).slice(1), [
        { partyId: "a", votes: 1 },
      ])
    ).toThrow("106 constituency results");
  });

  it("uses a stable party ID tie break for both plurality and D'Hondt", () => {
    const constituencyTie = allocateHungaryMixed2014(
      districts([
        { partyId: "z", votes: 100 },
        { partyId: "a", votes: 100 },
      ]),
      [
        { partyId: "z", votes: 100 },
        { partyId: "a", votes: 100 },
      ]
    );
    expect(constituencyTie.constituencySeats).toEqual({ a: 106 });
    const result = allocateHungaryMixed2014(districts([{ partyId: "a", votes: 1 }]), [
      { partyId: "z", votes: 100 },
      { partyId: "a", votes: 100 },
    ]);
    expect(result.constituencySeats).toEqual({ a: 106 });
    expect(result.listSeats.a).toBeGreaterThan(result.listSeats.z);
  });
});
