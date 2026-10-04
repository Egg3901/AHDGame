import { describe, expect, it } from "vitest";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./assemblyTransition";
import { bgDhondtSeats, bgNationwideEligibleParties } from "./ordinaryElection";

const ballots = Object.entries(BG_ORDINARY_ASSEMBLY_SEATS).map(([state, totalSeats], index) => ({
  state,
  totalSeats,
  status: "completed",
  votes: { a: index === 0 ? 3 : 40, b: index === 0 ? 20 : 0, c: 100 },
  candidateParties: { a: "A", b: "B", c: "C" },
}));

describe("Bulgaria October 1991 closed-list election", () => {
  it("uses a nationwide gate, not the share in one macroregion", () => {
    const eligible = bgNationwideEligibleParties(ballots);
    expect(eligible).not.toBeNull();
    expect(eligible?.has("A")).toBe(true);
    expect(eligible?.has("B")).toBe(false);
    expect(eligible?.has("C")).toBe(true);
    expect(bgNationwideEligibleParties(ballots.slice(1))).toBeNull();
    expect(
      bgNationwideEligibleParties([{ ...ballots[0], totalSeats: 400 }, ...ballots.slice(1)])
    ).toBeNull();
    expect(
      bgNationwideEligibleParties([{ ...ballots[0], votes: {} }, ...ballots.slice(1)])
    ).toBeNull();
  });

  it("allocates by D'Hondt party quotients and seats the list head", () => {
    const seats = bgDhondtSeats(
      [
        { id: "a-head", party: "A", votes: 40, listOrder: 1 },
        { id: "a-later", party: "A", votes: 60, listOrder: 2 },
        { id: "b", party: "B", votes: 80, listOrder: 1 },
        { id: "c", party: "C", votes: 30, listOrder: 1 },
      ],
      5,
      new Set(["A", "B", "C"])
    );
    expect(seats).toEqual({ "a-head": 3, "a-later": 0, b: 2, c: 0 });
  });

  it("excludes a below-threshold party, allows independents, and breaks ties stably", () => {
    const candidates = [
      { id: "z", party: "Z", votes: 100, listOrder: 1 },
      { id: "a", party: "A", votes: 100, listOrder: 1 },
      { id: "i", party: "independent", votes: 60, listOrder: 1 },
    ];
    expect(bgDhondtSeats(candidates, 3, new Set(["A"]))).toEqual({ z: 0, a: 2, i: 1 });
    expect(bgDhondtSeats(candidates, 1, new Set(["A", "Z"]))).toEqual({ z: 0, a: 1, i: 0 });
  });
});
