import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  resolveBillCardTally,
  scopeStateBillVotes,
  scopeStateBillVotesWithOfficials,
} from "./stateBillVoteScope";
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

describe("resolveBillCardTally (ticket #1075)", () => {
  const player = new ObjectId();
  const nppOld = new ObjectId();
  const nppDem = new ObjectId();
  const nppFlp = new ObjectId();
  const houseScope = { countryId: "US", officeType: "house" };

  it("drops a de-seated NPP and counts the player who received those seats, so The Count stays within 435", () => {
    // Founding-House repair moved 30 seats from nppOld onto the player. Both
    // still have votes in the raw map; the stored aggregate double-counts them
    // (250-215 = 465). Live-scope must show 220-215.
    const votes = {
      [`npp_${nppOld.toString()}`]: "for" as const,
      [player.toString()]: "for" as const,
      [`npp_${nppDem.toString()}`]: "for" as const,
      [`npp_${nppFlp.toString()}`]: "against" as const,
    };
    const officials: ScopedVoteOfficial[] = [
      {
        characterId: player,
        countryId: "US",
        nppId: undefined,
        officeType: "house",
        seatsHeld: 30,
      },
      {
        characterId: null,
        nppId: nppDem,
        countryId: "US",
        officeType: "house",
        seatsHeld: 190,
      },
      {
        characterId: null,
        nppId: nppFlp,
        countryId: "US",
        officeType: "house",
        seatsHeld: 215,
      },
    ];

    const tally = resolveBillCardTally(
      votes,
      { for: 250, against: 215, abstain: 0 },
      undefined,
      officials,
      houseScope
    );

    expect(tally).toEqual({ for: 220, against: 215, abstain: 0 });
    expect(tally.for + tally.against + tally.abstain).toBe(435);
  });

  it("uses a frozen snapshot instead of re-scoping a concluded bill (#0982)", () => {
    const tally = resolveBillCardTally(
      { [player.toString()]: "for" },
      { for: 999, against: 0, abstain: 0 },
      {
        votes: { [player.toString()]: "for" },
        weights: { [player.toString()]: 260 },
        totals: { for: 260, against: 170, abstain: 5 },
        resolvedAtTurn: 12,
      },
      [],
      houseScope
    );
    expect(tally).toEqual({ for: 260, against: 170, abstain: 5 });
  });

  it("falls back to the stored aggregate when no current holder matches", () => {
    const tally = resolveBillCardTally(
      { [player.toString()]: "for" },
      { for: 250, against: 215, abstain: 0 },
      undefined,
      [],
      houseScope
    );
    expect(tally).toEqual({ for: 250, against: 215, abstain: 0 });
  });
});
