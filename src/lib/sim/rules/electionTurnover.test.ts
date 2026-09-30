import { describe, expect, it } from "vitest";
import { summarizeElectionTurnover, type TurnoverCycle } from "./electionTurnover";
import { storedTurnoverCycle } from "./electionTurnoverRecords";
const cycle = (n: number, change: Partial<TurnoverCycle> = {}): TurnoverCycle => ({
  id: String(n),
  countryId: "US",
  family: "house",
  scope: "US:house:CA",
  outcomeScope: "stored candidate allocation",
  cycle: n,
  resolvedTurn: n * 48,
  seats: { D: 6, R: 4 },
  people: ["npp:a"],
  winningActors: ["npp"],
  actorMix: "npp-only",
  resolutionPath: null,
  missing: [],
  ...change,
});
describe("standing election turnover denominators", () => {
  it("distinguishes party weight, representative identity and unique control", () => {
    const [r] = summarizeElectionTurnover([
      cycle(1),
      cycle(2, { seats: { D: 7, R: 3 }, people: ["npp:b"] }),
      cycle(3, { seats: { D: 3, R: 7 }, people: ["npp:b"] }),
    ]);
    expect(r.partySeatVectorChange).toEqual({ count: 2, comparableCycles: 2, per100: 100 });
    expect(r.uniqueControlFlips.per100).toBe(50);
    expect(r.personReplacement.per100).toBe(50);
    expect(r.completeIncumbentHold.per100).toBe(50);
    expect(r.resolverPathShares.unknown.per100).toBe(100);
  });
  it("excludes tied control only from unique-control denominator", () => {
    const [r] = summarizeElectionTurnover([
      cycle(1),
      cycle(2, { seats: { D: 5, R: 5 } }),
      cycle(3),
    ]);
    expect(r.uniqueControlFlips).toEqual({ count: 0, comparableCycles: 0, per100: null });
    expect(r.tiedControlComparison.per100).toBe(100);
  });
  it("does not bridge missing outcomes, duplicate cycles, changed capacity or different scopes", () => {
    const [r] = summarizeElectionTurnover([
      cycle(1),
      cycle(2, { seats: null }),
      cycle(3),
      cycle(4, { seats: { D: 5 } }),
      cycle(5, { scope: "other" }),
    ]);
    expect(r.comparableCycles).toBe(0);
    expect(r.excludedComparisons).toEqual({
      "missing stored outcome": 2,
      "changed seat capacity": 1,
    });
    expect(
      summarizeElectionTurnover([cycle(1), cycle(1, { id: "duplicate" }), cycle(2)])[0]
        .comparableCycles
    ).toBe(0);
  });
  it("does not count absent identity as retention or replacement, and mixed wins overlap", () => {
    const [r] = summarizeElectionTurnover([
      cycle(1, { people: null, winningActors: null }),
      cycle(2, {
        winningActors: ["player", "npp"],
        actorMix: "mixed",
        resolutionPath: "hare_quota",
      }),
    ]);
    expect(r.personReplacement.per100).toBeNull();
    expect(r.unknownPersonComparisonCount).toBe(1);
    expect(r.playerWinCycles).toEqual({ count: 1, comparableCycles: 1, per100: 100 });
    expect(r.nppWinCycles.per100).toBe(100);
    expect(r.resolverPathShares.hare_quota.per100).toBe(50);
  });
});
describe("stored historical election outcomes", () => {
  const election = {
    _id: "e",
    countryId: "US",
    electionType: "house",
    state: "CA",
    cycle: 1,
    totalSeats: 10,
  };
  const candidates = [
    { _id: "a", electionId: "e", party: "D", isNPP: true, nppId: "actor-a" },
    { _id: "b", electionId: "e", party: "R", isNPP: false, characterId: "actor-b" },
  ];
  it("preserves actual aggregate representatives once and recorded resolver metadata", () => {
    const r = storedTurnoverCycle(
      election,
      {
        electionId: "e",
        finalized: true,
        seatsEstimate: { a: 6, b: 4 },
        totalVotes: { a: 60, b: 40 },
        resolutionPath: "districted_house",
        resolvedAtTurn: 48,
      },
      candidates
    );
    expect(r.seats).toEqual({ D: 6, R: 4 });
    expect(r.people).toEqual(["npp:actor-a", "player:actor-b"]);
    expect(r.actorMix).toBe("mixed");
    expect(r.resolutionPath).toBe("districted_house");
    expect(r.resolvedTurn).toBe(48);
  });
  it("uses actual completed AMS holder receipts including distinct list representatives", () => {
    const r = storedTurnoverCycle(
      election,
      {
        electionId: "e",
        finalized: true,
        seatsEstimate: { a: 6, b: 4 },
        resolutionPath: "ams",
        resolvedTotalSeats: 20,
        resolvedSeatHolders: [
          { identity: "npp:actor-a", party: "D", seats: 6, seatSource: "direct" },
          { identity: "player:actor-b", party: "R", seats: 4, seatSource: "direct" },
          { identity: "player:list", party: "R", seats: 10, seatSource: "list" },
        ],
      },
      candidates
    );
    expect(r.seats).toEqual({ D: 6, R: 14 });
    expect(r.people).toContain("player:list");
    expect(r.outcomeScope).toBe("complete direct and list holder receipt");
    expect(r.missing).toEqual([]);
    const legacy = storedTurnoverCycle(
      election,
      { electionId: "e", finalized: true, seatsEstimate: { a: 6, b: 4 }, resolutionPath: "ams" },
      candidates
    );
    expect(legacy.outcomeScope).toContain("direct tier only");
    expect(legacy.scope).not.toBe(r.scope);
  });
  it("does not fall back to a partial tally when an explicit complete receipt is inconsistent", () => {
    expect(
      storedTurnoverCycle(
        election,
        {
          electionId: "e",
          finalized: true,
          seatsEstimate: { a: 10 },
          resolvedTotalSeats: 20,
          resolvedSeatHolders: [{ identity: "npp:a", party: "D", seats: 10, seatSource: "direct" }],
        },
        candidates
      ).seats
    ).toBeNull();
  });
  it("retains legacy missing metadata and missing identities as unknown", () => {
    const r = storedTurnoverCycle(
      election,
      { electionId: "e", finalized: true, seatsEstimate: { a: 10 }, candidateParties: { a: "D" } },
      []
    );
    expect(r.seats).toEqual({ D: 10 });
    expect(r.people).toBeNull();
    expect(r.resolutionPath).toBeNull();
    expect(r.resolvedTurn).toBeNull();
  });
  it("rejects unfinished or capacity-incomplete allocation including incomplete AMS", () => {
    expect(
      storedTurnoverCycle(
        election,
        { electionId: "e", finalized: false, seatsEstimate: { a: 10 } },
        candidates
      ).seats
    ).toBeNull();
    expect(
      storedTurnoverCycle(
        election,
        { electionId: "e", finalized: true, seatsEstimate: { a: 5 }, resolutionPath: "ams_direct" },
        candidates
      ).seats
    ).toBeNull();
  });
  it("uses frozen single-winner outcome without inventing archived person identity", () => {
    const r = storedTurnoverCycle({ ...election, totalSeats: 1 }, undefined, [], {
      electionId: "e",
      summary: { projectedWinner: "a" },
      candidates: [{ id: "a", party: "D", isNPP: true }],
    });
    expect(r.seats).toEqual({ D: 1 });
    expect(r.people).toBeNull();
    expect(r.winningActors).toEqual(["npp"]);
  });
});
