import { describe, expect, it } from "vitest";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";
import {
  primaryBallotWindow,
  accruePrimaryBallotTurn,
  ballotSharesWithinParty,
  partyPrimaryPools,
  scoreByPrimaryVotes,
} from "./primaryBallots";

describe("primaryBallotWindow", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("opens for the closing stretch of a long primary, as long as the general", () => {
    // US Senate: 240-turn primary phase, 48-turn general. Ballots count over
    // the last 48 turns of the primary, not the whole five years.
    const seat = { startTurn: 100, primaryEndTurn: 340, endTurn: 388 };
    expect(primaryBallotWindow(seat, 200, now)).toMatchObject({
      startTurn: 292,
      endTurn: 340,
      open: false,
    });
    expect(primaryBallotWindow(seat, 292, now)?.open).toBe(true);
    expect(primaryBallotWindow(seat, 339, now)?.open).toBe(true);
  });

  it("never extends past the primary itself", () => {
    // A 12-turn primary with a 48-turn general accrues over all 12 turns.
    expect(
      primaryBallotWindow({ startTurn: 14, primaryEndTurn: 26, endTurn: 74 }, 14, now)
    ).toMatchObject({
      startTurn: 14,
      endTurn: 26,
      open: true,
    });
  });

  it("falls back to the primary length when the general end is unknown", () => {
    expect(primaryBallotWindow({ startTurn: 10, primaryEndTurn: 40 }, 10, now)).toMatchObject({
      startTurn: 10,
      endTurn: 40,
      open: true,
    });
  });

  it("uses the Date bounds for un-backfilled docs and null without any bounds", () => {
    const hour = 3_600_000;
    const start = new Date(now.getTime() - 200 * hour);
    const primaryEnd = new Date(now.getTime() + 10 * hour);
    const end = new Date(primaryEnd.getTime() + 24 * hour);
    const window = primaryBallotWindow(
      { startTime: start, primaryEndTime: primaryEnd, endTime: end },
      0,
      now
    );
    expect(window?.startTime?.getTime()).toBe(primaryEnd.getTime() - 24 * hour);
    expect(window?.open).toBe(true);
    expect(primaryBallotWindow({}, 0, now)).toBeNull();
  });
});

describe("partyPrimaryPools", () => {
  const registration = new Map([
    ["1", 35],
    ["2", 50],
    ["3", 0],
  ]);

  it("scales the turnout pool by each party's registration share", () => {
    const pools = partyPrimaryPools(1_000_000, ["1", "2"], registration);
    expect(pools.get("1")).toBe(350_000);
    expect(pools.get("2")).toBe(500_000);
  });

  it("gives no pool to a party without a registration figure", () => {
    // No modeled primary electorate means no ballots to invent — that party's
    // primary keeps resolving on score.
    const pools = partyPrimaryPools(1_000_000, ["1", "3", "9"], registration);
    expect(pools.has("3")).toBe(false); // zero registration
    expect(pools.has("9")).toBe(false); // absent entirely
    expect(pools.get("1")).toBe(350_000);
  });

  it("returns nothing for a zero or negative turnout pool", () => {
    expect(partyPrimaryPools(0, ["1"], registration).size).toBe(0);
  });
});

describe("accruePrimaryBallotTurn", () => {
  const entriesByParty = new Map([
    [
      "1",
      [
        { candidateId: "a", sharePct: 60 },
        { candidateId: "b", sharePct: 40 },
      ],
    ],
    ["2", [{ candidateId: "c", sharePct: 100 }]],
  ]);
  const pools = new Map([
    ["1", 240_000],
    ["2", 120_000],
  ]);

  it("splits each party's turn slice by that turn's shares and accumulates", () => {
    const first = accruePrimaryBallotTurn({
      cumulative: {},
      entriesByParty,
      poolsByParty: pools,
      totalTurns: 24,
      turnIndex: 0,
    });
    const demTurn = turnVoteWeight(24, 0, 240_000);
    expect(first.a).toBe(Math.round(demTurn * 0.6));
    expect(first.b).toBe(Math.round(demTurn * 0.4));
    expect(first.c).toBe(Math.round(turnVoteWeight(24, 0, 120_000)));

    const second = accruePrimaryBallotTurn({
      cumulative: first,
      entriesByParty,
      poolsByParty: pools,
      totalTurns: 24,
      turnIndex: 1,
    });
    expect(second.a).toBe(first.a + Math.round(turnVoteWeight(24, 1, 240_000) * 0.6));
  });

  it("integrates to roughly the party pool across the whole window", () => {
    let cumulative: Record<string, number> = {};
    for (let t = 0; t < 24; t++) {
      cumulative = accruePrimaryBallotTurn({
        cumulative,
        entriesByParty,
        poolsByParty: pools,
        totalTurns: 24,
        turnIndex: t,
      });
    }
    const demTotal = cumulative.a + cumulative.b;
    // Conservation to rounding: one whole ballot per candidate per turn at most.
    expect(Math.abs(demTotal - 240_000)).toBeLessThanOrEqual(24 * 2);
    expect(Math.abs(cumulative.c - 120_000)).toBeLessThanOrEqual(24);
  });

  it("splits evenly on a degenerate all-zero share field", () => {
    const next = accruePrimaryBallotTurn({
      cumulative: {},
      entriesByParty: new Map([
        [
          "1",
          [
            { candidateId: "a", sharePct: 0 },
            { candidateId: "b", sharePct: 0 },
          ],
        ],
      ]),
      poolsByParty: new Map([["1", 100_000]]),
      totalTurns: 24,
      turnIndex: 0,
    });
    expect(next.a).toBe(next.b);
    expect(next.a).toBeGreaterThan(0);
  });

  it("leaves parties without a pool untouched", () => {
    const next = accruePrimaryBallotTurn({
      cumulative: { a: 5 },
      entriesByParty,
      poolsByParty: new Map([["2", 120_000]]),
      totalTurns: 24,
      turnIndex: 0,
    });
    expect(next.a).toBe(5);
    expect(next.b).toBeUndefined();
    expect(next.c).toBeGreaterThan(0);
  });
});

describe("ballotSharesWithinParty", () => {
  it("returns proportional shares at one decimal", () => {
    const shares = ballotSharesWithinParty(["a", "b"], { a: 62_000, b: 38_000 });
    expect(shares?.get("a")).toBe(62);
    expect(shares?.get("b")).toBe(38);
  });

  it("returns null when the party has no ballots, so callers keep score shares", () => {
    expect(ballotSharesWithinParty(["a", "b"], { a: 0, b: 0 })).toBeNull();
    expect(ballotSharesWithinParty(["a", "b"], undefined)).toBeNull();
    // Ballots belonging to some OTHER party's candidates do not count.
    expect(ballotSharesWithinParty(["a", "b"], { z: 500 })).toBeNull();
  });
});

describe("scoreByPrimaryVotes", () => {
  it("returns the ballot map when the party has any ballots", () => {
    expect(scoreByPrimaryVotes(["a", "b"], { a: 10, b: 0 })).toEqual({ a: 10, b: 0 });
  });

  it("returns null for legacy races with no accrued ballots", () => {
    expect(scoreByPrimaryVotes(["a", "b"], undefined)).toBeNull();
    expect(scoreByPrimaryVotes(["a", "b"], {})).toBeNull();
  });
});
