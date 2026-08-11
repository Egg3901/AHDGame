import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { scopeStateBillVotes, scopeStateBillVotesWithOfficials } from "./stateBillVoteScope";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";

function officialsCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

describe("scopeStateBillVotes", () => {
  let db: MockDb;
  const charStaying = new ObjectId();
  const charDeparted = new ObjectId();
  const charAgainst = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Instantiate the lazily-created collection mock so tests can configure its cursor.
    db.collection("electedOfficials");
  });

  it("drops voters who no longer hold the seat and re-weights survivors to current seatsHeld", async () => {
    // Pre-election the chamber voted; charStaying held 19 seats, charDeparted held 8,
    // charAgainst held 4. After the election charStaying holds 14, charDeparted left,
    // charAgainst still holds 17. Only current holders should count.
    db.collectionMocks.electedOfficials!.find.mockReturnValue(
      officialsCursor([
        {
          characterId: charStaying,
          countryId: "US",
          officeType: "stateSenator",
          seatsHeld: 14,
        },
        {
          characterId: charAgainst,
          countryId: "US",
          officeType: "stateSenator",
          seatsHeld: 17,
        },
        // charDeparted intentionally absent — lost their seat.
      ])
    );

    const votes: Record<string, "for" | "against" | "abstain"> = {
      [charStaying.toString()]: "for",
      [charDeparted.toString()]: "for",
      [charAgainst.toString()]: "against",
    };

    const scoped = await scopeStateBillVotes(db as unknown as Db, votes, {
      stateId: "AZ",
      countryId: "US",
      officeType: "stateSenator",
    });

    // Departed voter dropped from the scoped map.
    expect(scoped.votes).toBeDefined();
    expect(Object.keys(scoped.votes ?? {})).toEqual([
      charStaying.toString(),
      charAgainst.toString(),
    ]);
    // Totals reflect CURRENT seat weights, not the pre-election ones.
    expect(scoped.totals).toEqual({ for: 14, against: 17, abstain: 0 });
    // 14 + 17 = 31 — within a 31-seat chamber, never inflated by the old votes.
    expect(scoped.totals.for + scoped.totals.against + scoped.totals.abstain).toBe(31);
  });

  it("returns empty totals (no scoped votes) when no current official matches", async () => {
    db.collectionMocks.electedOfficials!.find.mockReturnValue(officialsCursor([]));

    const scoped = await scopeStateBillVotes(
      db as unknown as Db,
      { [charDeparted.toString()]: "for" },
      { stateId: "AZ", countryId: "US", officeType: "stateSenator" }
    );

    expect(Object.keys(scoped.votes ?? {})).toHaveLength(0);
    expect(scoped.totals).toEqual({ for: 0, against: 0, abstain: 0 });
  });

  it("handles an empty vote map without querying officials", async () => {
    const scoped = await scopeStateBillVotes(
      db as unknown as Db,
      {},
      {
        stateId: "AZ",
        countryId: "US",
        officeType: "stateSenator",
      }
    );

    expect(scoped.totals).toEqual({ for: 0, against: 0, abstain: 0 });
    expect(db.collectionMocks.electedOfficials!.find).not.toHaveBeenCalled();
  });
});

describe("scopeStateBillVotesWithOfficials (list-card path, #973)", () => {
  const charStaying = new ObjectId();
  const charDeparted = new ObjectId();
  const charAgainst = new ObjectId();

  const officials: ScopedVoteOfficial[] = [
    {
      characterId: charStaying,
      countryId: "US",
      nppId: undefined,
      officeType: "stateSenator",
      seatsHeld: 14,
    },
    {
      characterId: charAgainst,
      countryId: "US",
      nppId: undefined,
      officeType: "stateSenator",
      seatsHeld: 17,
    },
    // charDeparted absent — lost their seat in the election.
  ];

  it("scopes list-card totals to current holders so they never exceed chamber size", () => {
    const votes: Record<string, "for" | "against" | "abstain"> = {
      [charStaying.toString()]: "for",
      [charDeparted.toString()]: "for", // stale pre-election vote — must be dropped
      [charAgainst.toString()]: "against",
    };

    const scoped = scopeStateBillVotesWithOfficials(votes, officials, {
      countryId: "US",
      officeType: "stateSenator",
    });

    expect(Object.keys(scoped.votes ?? {})).toEqual([
      charStaying.toString(),
      charAgainst.toString(),
    ]);
    expect(scoped.totals).toEqual({ for: 14, against: 17, abstain: 0 });
    // 14 + 17 = 31, within a 31-seat chamber — not the pre-fix 48 (> 31 seats).
    expect(scoped.totals.for + scoped.totals.against + scoped.totals.abstain).toBe(31);
  });

  it("returns empty totals when no votes (falls back to stored aggregate in caller)", () => {
    const scoped = scopeStateBillVotesWithOfficials(undefined, officials, {
      countryId: "US",
      officeType: "stateSenator",
    });
    expect(scoped.totals).toEqual({ for: 0, against: 0, abstain: 0 });
    expect(Object.keys(scoped.votes ?? {})).toHaveLength(0);
  });
});
