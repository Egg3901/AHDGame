/**
 * Unit tests for the elections-only balance report math: margin of victory,
 * lead changes (dynamism), closing surge, and the contested/roll-up tallies.
 * Uses a tiny in-memory fake Db (the report is a pure read model, so a full
 * MockDb is unnecessary here).
 */
import { describe, it, expect } from "vitest";
import { collectElectionReport } from "./electionReport";

type Doc = Record<string, unknown>;
function fakeDb(data: Record<string, Doc[]>) {
  return {
    collection(name: string) {
      const docs = data[name] ?? [];
      return {
        findOne: async (_filter?: unknown, _opts?: unknown) => docs[0] ?? null,
        find: (_filter?: unknown, _opts?: unknown) => ({ toArray: async () => docs }),
      };
    },
  } as never;
}

describe("collectElectionReport", () => {
  it("computes winner, margin, lead changes, closing surge and roll-ups", async () => {
    const eid = { toString: () => "e1" };
    const db = fakeDb({
      gameState: [{ currentTurn: 100 }],
      simRuns: [{ electionScope: null, emptyCandidateSupplyCountries: [] }],
      elections: [
        { _id: eid, countryId: "US", electionType: "governor", state: "CA", status: "resolved" },
      ],
      electionVoteTallies: [
        {
          electionId: eid,
          totalVotes: { a: 55, b: 45 },
          candidateNames: { a: "Alice", b: "Bob" },
          candidateParties: { a: "D", b: "R" },
          turnSnapshots: [
            { turn: 1, sharesPct: { a: 40, b: 60 }, cumulativeVotes: { a: 40, b: 60 } }, // B leads
            { turn: 2, sharesPct: { a: 48, b: 52 }, cumulativeVotes: { a: 48, b: 52 } }, // B leads
            { turn: 3, sharesPct: { a: 55, b: 45 }, cumulativeVotes: { a: 55, b: 45 } }, // A takes lead
          ],
        },
      ],
    });

    const r = await collectElectionReport(db, { maxTrajectoryPoints: 10 });
    expect(r.turn).toBe(100);
    expect(r.totals).toMatchObject({ elections: 1, withTally: 1, resolved: 1, contested: 1 });
    expect(r.totals.contestedPct).toBe(1);

    const e = r.elections[0];
    expect(e.winnerId).toBe("a");
    expect(e.winnerName).toBe("Alice");
    expect(e.winnerParty).toBe("D");
    expect(e.marginPct).toBeCloseTo(10, 5); // 55 - 45
    expect(e.leadChanges).toBe(1); // B → A exactly once
    expect(e.winnerClosingDeltaPct).toBeCloseTo(15, 5); // A: 40 → 55
    expect(e.trajectory).toHaveLength(3);

    expect(r.margin?.median).toBeCloseTo(10, 5);
    expect(r.dynamism.meanLeadChanges).toBe(1);
    expect(r.byCountry.US).toMatchObject({ elections: 1, resolved: 1 });
    expect(r.byElectionType.governor.meanMarginPct).toBeCloseTo(10, 5);
  });

  it("counts a tally-less election (primary-only / empty supply) without crashing", async () => {
    const eid = { toString: () => "e2" };
    const db = fakeDb({
      gameState: [{ currentTurn: 5 }],
      simRuns: [],
      elections: [
        { _id: eid, countryId: "UK", electionType: "commons", state: "LON", status: "upcoming" },
      ],
      electionVoteTallies: [],
    });

    const r = await collectElectionReport(db);
    expect(r.totals.elections).toBe(1);
    expect(r.totals.withTally).toBe(0);
    expect(r.elections[0].trajectory).toEqual([]);
    expect(r.margin).toBeNull();
  });

  it("respects an explicit scope filter", async () => {
    const us = { toString: () => "us1" };
    const uk = { toString: () => "uk1" };
    const db = fakeDb({
      gameState: [{ currentTurn: 10 }],
      simRuns: [{ electionScope: ["US"], emptyCandidateSupplyCountries: [] }],
      elections: [
        { _id: us, countryId: "US", electionType: "senate", state: "PA", status: "resolved" },
        { _id: uk, countryId: "UK", electionType: "commons", state: "LON", status: "resolved" },
      ],
      electionVoteTallies: [],
    });

    const r = await collectElectionReport(db);
    expect(r.scope).toEqual(["US"]);
    expect(r.totals.elections).toBe(1); // UK filtered out
    expect(r.byCountry.UK).toBeUndefined();
    expect(r.byCountry.US).toBeDefined();
  });
});
