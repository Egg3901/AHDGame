import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolvePhaseVotes } from "./resolvePhaseVotes";

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

describe("resolvePhaseVotes", () => {
  it("scopes to current holders and snapshots the scoped totals", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        { characterId: a, nppId: null, countryId: "US", officeType: "house", seatsHeld: 3 },
        { characterId: b, nppId: null, countryId: "US", officeType: "house", seatsHeld: 2 },
      ])
    );
    const bill = {
      countryId: "US",
      votes: { [a.toString()]: "for", [b.toString()]: "against" },
      votesFor: 3,
      votesAgainst: 2,
      votesAbstain: 0,
    };

    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "votes", officeType: "house", countryId: "US" },
      7
    );

    expect(res.totals).toEqual({ for: 3, against: 2, abstain: 0 });
    expect(res.snapshot.totals).toEqual({ for: 3, against: 2, abstain: 0 });
    expect(res.snapshot.weights[a.toString()]).toBe(3);
    expect(res.snapshot.resolvedAtTurn).toBe(7);
  });

  it("freezes the stored aggregate when no current holder survives", async () => {
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(cursor([]));
    const bill = {
      countryId: "US",
      votes: { [new ObjectId().toString()]: "for" },
      votesFor: 9,
      votesAgainst: 1,
      votesAbstain: 0,
    };
    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "votes", officeType: "house", countryId: "US" },
      1
    );
    expect(res.totals).toEqual({ for: 9, against: 1, abstain: 0 });
  });

  it("restricts the officials query to the bill's state when stateId is passed", async () => {
    const a = new ObjectId();
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: a,
          nppId: null,
          countryId: "UK",
          officeType: "regionalCouncil",
          seatsHeld: 5,
        },
      ])
    );
    const bill = {
      countryId: "UK",
      stateId: "NIR",
      votes: { [a.toString()]: "for" },
      votesFor: 5,
      votesAgainst: 0,
      votesAbstain: 0,
    };

    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "votes", officeType: "regionalCouncil", countryId: "UK", stateId: "NIR" },
      4
    );

    expect(res.totals).toEqual({ for: 5, against: 0, abstain: 0 });
    // The chamber filter must pin state + officeType so a same-officeType seat in
    // another region cannot leak into the weight map.
    const filter = db.collectionMocks["electedOfficials"]!.find.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(filter.state).toBe("NIR");
    expect(filter.officeType).toBe("regionalCouncil");
  });

  it("tallies the override vote map when voteField is overrideVotes", async () => {
    const a = new ObjectId();
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: a,
          nppId: null,
          countryId: "US",
          officeType: "stateSenate",
          seatsHeld: 40,
        },
      ])
    );
    const bill = {
      countryId: "US",
      stateId: "CA",
      overrideVotes: { [a.toString()]: "for" },
      overrideVotesFor: 40,
      overrideVotesAgainst: 0,
    };

    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "overrideVotes", officeType: "stateSenate", countryId: "US", stateId: "CA" },
      9
    );

    expect(res.totals).toEqual({ for: 40, against: 0, abstain: 0 });
    expect(res.snapshot.weights[a.toString()]).toBe(40);
  });

  it("falls back to the stored override aggregate when no holder survives", async () => {
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(cursor([]));
    const bill = {
      countryId: "US",
      stateId: "CA",
      overrideVotes: { [new ObjectId().toString()]: "for" },
      overrideVotesFor: 27,
      overrideVotesAgainst: 3,
    };
    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "overrideVotes", officeType: "stateSenate", countryId: "US", stateId: "CA" },
      2
    );
    expect(res.totals).toEqual({ for: 27, against: 3, abstain: 0 });
  });

  it("tallies the other-chamber vote map when voteField is otherChamberVotes", async () => {
    const a = new ObjectId();
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([{ characterId: a, nppId: null, countryId: "US", officeType: "senate", seatsHeld: 1 }])
    );
    const bill = {
      countryId: "US",
      otherChamberVotes: { [a.toString()]: "for" },
      otherChamberVotesFor: 1,
      otherChamberVotesAgainst: 0,
      otherChamberVotesAbstain: 0,
    };
    const res = await resolvePhaseVotes(
      db as unknown as Db,
      bill as never,
      { voteField: "otherChamberVotes", officeType: "senate", countryId: "US" },
      3
    );
    expect(res.totals).toEqual({ for: 1, against: 0, abstain: 0 });
    expect(res.snapshot.votes[a.toString()]).toBe("for");
  });
});
