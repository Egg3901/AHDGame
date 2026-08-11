/**
 * Unit tests for the seat-weighted recompute helpers. These are the single
 * source of truth for government-vote and cabinet-nomination tallies: the
 * headline number, the resolver decision, and the per-party breakdown all
 * derive from the same scoped recompute, so they can never disagree and a
 * total can never exceed the chamber's current seat count. Stale (de-seated)
 * and cross-country vote-map keys are excluded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, type MockCollection } from "@/lib/test-utils/mockDb";
import {
  computeParliamentaryGovernmentTally,
  computeCabinetNominationTally,
  computeCongressLeadershipTally,
} from "./governmentVoteBreakdown";

/** Stub a collection's find() to return `docs` regardless of filter, while
 *  still recording the filter for assertions. Mimics what Mongo returns for an
 *  already-scoped query. */
function stubFind(coll: MockCollection, docs: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
  coll.find.mockReturnValue(cursor);
}

describe("computeParliamentaryGovernmentTally", () => {
  let db: MockDb;
  const charId = new ObjectId();
  const nppId = new ObjectId();
  const ghostNppId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    stubFind(db.collection("politicalParties") as unknown as MockCollection, [
      { _id: "p1", countryId: "DE", sequentialId: 1, name: "Alpha", color: "#111" },
      { _id: "p2", countryId: "DE", sequentialId: 2, name: "Beta", color: "#222" },
    ]);
    stubFind(db.collection("characters") as unknown as MockCollection, [
      { _id: charId, party: "1" },
    ]);
    stubFind(db.collection("npps") as unknown as MockCollection, [{ _id: nppId, party: "2" }]);
    // Only the two seated officials are returned (as a country/office-scoped
    // Mongo query would); the ghost NPP holds no current bundestag seat.
    stubFind(db.collection("electedOfficials") as unknown as MockCollection, [
      { characterId: charId, countryId: "DE", officeType: "bundestag", seatsHeld: 5 },
      { nppId, isNPP: true, countryId: "DE", officeType: "bundestag", seatsHeld: 10 },
    ]);
  });

  it("weights by current seats, excludes stale voters, and header equals breakdown", async () => {
    const votes: Record<string, "aye" | "nay"> = {
      [charId.toString()]: "aye",
      [`npp_${nppId.toString()}`]: "aye",
      [`npp_${ghostNppId.toString()}`]: "nay", // de-seated -> excluded
    };
    const tally = await computeParliamentaryGovernmentTally(
      db as unknown as Db,
      "DE",
      "bundestag",
      votes
    );

    expect(tally.votesFor).toBe(15); // 5 + 10
    expect(tally.votesAgainst).toBe(0); // ghost nay dropped

    const sumFor = tally.voteByParty.reduce((s, p) => s + p.for, 0);
    const sumAgainst = tally.voteByParty.reduce((s, p) => s + p.against, 0);
    expect(sumFor).toBe(tally.votesFor);
    expect(sumAgainst).toBe(tally.votesAgainst);
  });

  it("returns zeros for an empty votes map", async () => {
    const tally = await computeParliamentaryGovernmentTally(
      db as unknown as Db,
      "DE",
      "bundestag",
      {}
    );
    expect(tally).toEqual({ votesFor: 0, votesAgainst: 0, voteByParty: [] });
  });
});

describe("computeCabinetNominationTally", () => {
  let db: MockDb;
  const senatorId = new ObjectId();
  const usNppId = new ObjectId();
  const brNppId = new ObjectId();
  const ghostNppId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    stubFind(db.collection("characters") as unknown as MockCollection, []);
    stubFind(db.collection("npps") as unknown as MockCollection, []);
    // A country-scoped query returns only the US senate seats; BR senate seats
    // and de-seated NPPs are not in the result, so they carry no weight.
    stubFind(db.collection("electedOfficials") as unknown as MockCollection, [
      { characterId: senatorId, countryId: "US", officeType: "senate", seatsHeld: 1 },
      { nppId: usNppId, isNPP: true, countryId: "US", officeType: "senate", seatsHeld: 40 },
    ]);
  });

  it("weights US senate seats and excludes stale + cross-country voters", async () => {
    const votes: Record<string, "for" | "against" | "abstain"> = {
      [senatorId.toString()]: "for",
      [`npp_${usNppId.toString()}`]: "against",
      [`npp_${brNppId.toString()}`]: "for", // Brazil senate -> excluded
      [`npp_${ghostNppId.toString()}`]: "for", // de-seated -> excluded
    };
    const tally = await computeCabinetNominationTally(db as unknown as Db, "US", votes);
    expect(tally).toEqual({ votesFor: 1, votesAgainst: 40, votesAbstain: 0 });
  });

  it("scopes the seat query to the nomination's country", async () => {
    await computeCabinetNominationTally(db as unknown as Db, "US", {
      [senatorId.toString()]: "for",
    });
    const calls = db.collectionMocks["electedOfficials"]!.find.mock.calls;
    const filter = calls[0]![0] as Record<string, unknown>;
    expect(filter.countryId).toBe("US");
    expect(filter.officeType).toBe("senate");
  });
});

describe("computeCongressLeadershipTally", () => {
  let db: MockDb;
  const memberId = new ObjectId();
  const nppBlocId = new ObjectId();
  const ghostId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    stubFind(db.collection("politicalParties") as unknown as MockCollection, [
      { _id: "p1", countryId: "US", sequentialId: 1, name: "Alpha", color: "#111" },
    ]);
    stubFind(db.collection("characters") as unknown as MockCollection, [
      { _id: memberId, party: "1" },
    ]);
    stubFind(db.collection("npps") as unknown as MockCollection, [{ _id: nppBlocId, party: "1" }]);
    // The NPP bloc holds 50 seats, but leadership elections are
    // one-member-one-vote: it must count as a single vote, not 50.
    stubFind(db.collection("electedOfficials") as unknown as MockCollection, [
      { characterId: memberId, countryId: "US", officeType: "house", seatsHeld: 1 },
      { nppId: nppBlocId, isNPP: true, countryId: "US", officeType: "house", seatsHeld: 50 },
    ]);
  });

  it("counts one vote per member (not seat-weighted) and drops de-seated voters", async () => {
    const votes: Record<string, "for" | "against"> = {
      [memberId.toString()]: "for",
      [`npp_${nppBlocId.toString()}`]: "for",
      [`npp_${ghostId.toString()}`]: "for", // de-seated -> excluded
    };
    const tally = await computeCongressLeadershipTally(db as unknown as Db, "house", votes);
    // member(1) + npp bloc(1, NOT 50); ghost dropped.
    expect(tally.votesFor).toBe(2);
    expect(tally.votesAgainst).toBe(0);
    const sumFor = tally.voteByParty.reduce((s, p) => s + p.for, 0);
    expect(sumFor).toBe(tally.votesFor);
  });

  it("returns zeros for an empty votes map", async () => {
    const tally = await computeCongressLeadershipTally(db as unknown as Db, "house", {});
    expect(tally).toEqual({ votesFor: 0, votesAgainst: 0, voteByParty: [] });
  });
});
