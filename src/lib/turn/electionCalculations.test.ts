import { describe, it, expect } from "vitest";
import {
  allocateElectoralVotes,
  determinePresidentialWinner,
  determineMultiSeatWinners,
  ELECTORAL_MAJORITY,
} from "./electionCalculations";
import { ELECTORAL_VOTE_UNITS_1991 } from "@/lib/constants/states";

// ─── allocateElectoralVotes ─────────────────────────────────────────────────

describe("allocateElectoralVotes", () => {
  it("awards EVs to the candidate with the most votes in each unit", () => {
    const result = allocateElectoralVotes({
      CA: { alice: 5000, bob: 3000 }, // CA = 54 EV
      TX: { alice: 2000, bob: 6000 }, // TX = 40 EV
    });
    expect(result.alice).toBe(54);
    expect(result.bob).toBe(40);
  });

  it("skips units with no votes", () => {
    const result = allocateElectoralVotes({
      CA: { alice: 100 },
      TX: {}, // empty
    });
    expect(result.alice).toBe(54);
    expect(result.bob).toBeUndefined();
  });

  it("skips units not in ELECTORAL_VOTE_UNITS", () => {
    const result = allocateElectoralVotes({
      FAKE_STATE: { alice: 999 },
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles ME/NE split districts independently", () => {
    const result = allocateElectoralVotes({
      ME: { alice: 100, bob: 50 }, // at-large 2 EV → alice
      ME_CD1: { alice: 60, bob: 70 }, // 1 EV → bob
      ME_CD2: { alice: 80, bob: 20 }, // 1 EV → alice
    });
    expect(result.alice).toBe(3); // 2 + 1
    expect(result.bob).toBe(1);
  });

  it("ignores candidates with zero votes in a unit", () => {
    const result = allocateElectoralVotes({
      NY: { alice: 0, bob: 100 }, // NY = 28 EV
    });
    expect(result.bob).toBe(28);
    expect(result.alice).toBeUndefined();
  });

  it("three-candidate race awards all unit EVs to plurality winner", () => {
    const result = allocateElectoralVotes({
      FL: { alice: 100, bob: 80, carol: 90 }, // FL = 30 EV → alice
    });
    expect(result.alice).toBe(30);
    expect(result.bob).toBeUndefined();
    expect(result.carol).toBeUndefined();
  });

  it("uses 1990-census EV values when 1991 units are passed", () => {
    const result = allocateElectoralVotes(
      {
        CA: { alice: 5000, bob: 3000 }, // 1990 CA = 54 EV
        TX: { alice: 2000, bob: 6000 }, // 1990 TX = 32 EV (vs 40 in 2020)
        FL: { alice: 9000, bob: 1 }, // 1990 FL = 25 EV (vs 30 in 2020)
      },
      ELECTORAL_VOTE_UNITS_1991
    );
    expect(result.alice).toBe(54 + 25);
    expect(result.bob).toBe(32);
  });

  it("defaults to 2020-census units when no bundle is passed", () => {
    const result = allocateElectoralVotes({ TX: { alice: 100, bob: 1 } });
    expect(result.alice).toBe(40); // 2020 TX
  });
});

// ─── determinePresidentialWinner ────────────────────────────────────────────

describe("determinePresidentialWinner", () => {
  it("returns the candidate with >= 270 EVs", () => {
    const result = determinePresidentialWinner({ alice: 300, bob: 238 });
    expect(result).toEqual({ winnerId: "alice", winnerEV: 300 });
  });

  it("returns winner at exactly 270 EVs", () => {
    const result = determinePresidentialWinner({ alice: 270, bob: 268 });
    expect(result).toEqual({ winnerId: "alice", winnerEV: 270 });
  });

  it("returns null for a 269-269 tie (contingent election)", () => {
    const result = determinePresidentialWinner({ alice: 269, bob: 269 });
    expect(result).toBeNull();
  });

  it("returns null for no-majority three-way split (contingent election)", () => {
    const result = determinePresidentialWinner({ alice: 200, bob: 180, carol: 158 });
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = determinePresidentialWinner({});
    expect(result).toBeNull();
  });

  it("handles single candidate with majority", () => {
    const result = determinePresidentialWinner({ alice: 538 });
    expect(result).toEqual({ winnerId: "alice", winnerEV: 538 });
  });

  it("handles landslide correctly", () => {
    const result = determinePresidentialWinner({ alice: 400, bob: 138 });
    expect(result).toEqual({ winnerId: "alice", winnerEV: 400 });
  });
});

// ─── determineMultiSeatWinners ──────────────────────────────────────────────

describe("determineMultiSeatWinners", () => {
  it("returns top candidates by vote when all exceed minShare", () => {
    const winners = determineMultiSeatWinners({ alice: 600, bob: 500, carol: 400 }, 2);
    expect(winners).toEqual(["alice", "bob"]);
  });

  it("filters candidates below minShare threshold", () => {
    // total = 1000; carol = 50/1000 = 5% < 20% minShare
    const winners = determineMultiSeatWinners({ alice: 600, bob: 350, carol: 50 }, 3);
    expect(winners).toEqual(["alice", "bob"]);
    expect(winners).not.toContain("carol");
  });

  it("returns empty array when all votes are zero", () => {
    expect(determineMultiSeatWinners({ alice: 0, bob: 0 }, 2)).toEqual([]);
  });

  it("returns fewer than totalSeats when not enough candidates qualify", () => {
    // total = 200; bob = 10/200 = 5% < 20%
    const winners = determineMultiSeatWinners({ alice: 190, bob: 10 }, 5);
    expect(winners).toEqual(["alice"]);
  });

  it("respects totalSeats cap even when many candidates qualify", () => {
    const winners = determineMultiSeatWinners({ a: 300, b: 300, c: 200, d: 200 }, 2);
    expect(winners).toHaveLength(2);
    expect(winners).toEqual(["a", "b"]);
  });

  it("uses custom minShare when provided", () => {
    // total = 100; carol = 10/100 = 10%. With minShare 0.05 she qualifies; default 0.2 she doesn't
    const withLow = determineMultiSeatWinners({ a: 50, b: 40, c: 10 }, 3, 0.05);
    expect(withLow).toContain("c");

    const withDefault = determineMultiSeatWinners({ a: 50, b: 40, c: 10 }, 3);
    expect(withDefault).not.toContain("c");
  });

  it("awards single seat to plurality winner", () => {
    const winners = determineMultiSeatWinners({ alice: 400, bob: 350, carol: 250 }, 1);
    expect(winners).toEqual(["alice"]);
  });
});

// ─── Balance: ELECTORAL_MAJORITY constant ───────────────────────────────────

describe("electoral college balance", () => {
  it("ELECTORAL_MAJORITY is 270 (majority of 538)", () => {
    expect(ELECTORAL_MAJORITY).toBe(270);
  });
});
