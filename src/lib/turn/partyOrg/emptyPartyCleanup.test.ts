/**
 * Unit tests for emptyPartyCleanup — removes parties with zero actual members.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/** Shared collection names the source module touches. */
const ALL_COLLECTIONS = [
  "politicalParties",
  "characters",
  "npps",
  "electedOfficials",
  "states",
  "statePartyElections",
  "statePartyCandidates",
  "statePartyVotes",
  "nationalPartyElections",
  "nationalPartyCandidates",
  "nationalPartyVotes",
  "nationalCommitteeElections",
  "nationalCommitteeCandidates",
  "nationalCommitteeVotes",
  "statePartyOrg",
  "partyBudget",
  "billWhips",
  "caucuses",
  "caucusMemberships",
  "caucusPolicyPositions",
  "recruitmentSlates",
  "slateCandidates",
  "treasuryTransactions",
  "coalitions",
  "partyCharters",
];

/**
 * Wire up an "all-zero, nothing-to-delete" state for aggregate counts so tests
 * that want an empty party don't have to repeat the boilerplate.
 */
function setupEmptyMemberCounts(db: MockDb) {
  db.collectionMocks["characters"]!.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks["npps"]!.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
}

/** Minimal coalition document factory. */
function makeCoalition(
  overrides: Partial<{
    _id: ObjectId;
    chairPartyId: ObjectId;
    chairCharacterId: ObjectId;
    members: { partyId: ObjectId; partySequentialId: number; joinedAt: Date }[];
  }> = {}
) {
  return {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US",
    name: "Test Coalition",
    abbreviation: "TC",
    color: "#fff",
    chairPartyId: new ObjectId(),
    chairCharacterId: new ObjectId(),
    members: [],
    pendingInvites: [],
    joinRequests: [],
    createdBy: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("cleanupEmptyParties", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of ALL_COLLECTIONS) db.collection(name);
    db.collectionMocks["caucuses"]!.find.mockReturnValue(makeCursor([]));
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  // ── Guard: nothing to do ──────────────────────────────────────────────────

  it("returns empty result when no non-default parties exist", async () => {
    // politicalParties.find returns [] (default)
    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
    expect(result.deletedStatePartyOrgs).toBe(0);
  });

  // ── Membership guards (character / NPP / official) ────────────────────────

  it("does not delete parties that have active character members", async () => {
    const party = {
      _id: new ObjectId(),
      sequentialId: 42,
      countryId: "US",
      isDefault: false,
    };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: { countryId: "US", party: "42" }, count: 3 }]),
    });
    db.collectionMocks["npps"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
    expect(db.collectionMocks["politicalParties"]!.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete parties that have active NPP members (retired NPPs excluded)", async () => {
    // NPPs count only those with retiredAt: null — an active NPP in the party prevents deletion.
    const party = {
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "UK",
      isDefault: false,
    };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    // No character members
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    // Active NPP in the party
    db.collectionMocks["npps"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: { countryId: "UK", party: "7" }, count: 1 }]),
    });
    db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
    expect(db.collectionMocks["politicalParties"]!.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete parties with elected officials", async () => {
    const party = {
      _id: new ObjectId(),
      sequentialId: 42,
      countryId: "US",
      isDefault: false,
    };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["npps"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    // Has elected officials
    db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "42", count: 2 }]),
    });

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
  });

  it("cross-country sequential ID collision: blocks only the matching country", async () => {
    // US party seqId=5 has a character; UK party seqId=5 has none.
    // Both have the same sequentialId — composite key resolution must prevent cross-country deletion.
    const usParty = { _id: new ObjectId(), sequentialId: 5, countryId: "US", isDefault: false };
    const ukParty = { _id: new ObjectId(), sequentialId: 5, countryId: "UK", isDefault: false };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([usParty, ukParty]));
    // Character belongs to US:5 only
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: { countryId: "US", party: "5" }, count: 2 }]),
    });
    db.collectionMocks["npps"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    // Set up election/states lookups for the UK party that will be deleted
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    // Only the UK party (empty) should be deleted — not the US one
    expect(result.deletedParties).toEqual(["5"]);
    const deleteCall = db.collectionMocks["politicalParties"]!.deleteMany.mock.calls[0];
    const deletedIds = deleteCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(deletedIds).toContain(ukParty._id.toString());
    expect(deletedIds).not.toContain(usParty._id.toString());
  });

  // ── Default party immunity ────────────────────────────────────────────────

  it("does not delete chartered parties (Phase 6 cleanup-immunity)", async () => {
    // A non-default party with no characters / NPPs / officials but
    // referenced by a ratified charter is exempt from cleanup.
    const party = {
      _id: new ObjectId(),
      sequentialId: 77,
      countryId: "US",
      isDefault: false,
    };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["partyCharters"]!.find.mockReturnValue(
      makeCursor([{ partyId: "77", countryId: "US" }])
    );

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
    expect(db.collectionMocks["politicalParties"]!.deleteMany).not.toHaveBeenCalled();
  });

  it("still deletes empty non-chartered parties when other parties are chartered", async () => {
    // Two parties both empty: one chartered (#77), one not (#78). Only #78 is deleted.
    const charteredParty = {
      _id: new ObjectId(),
      sequentialId: 77,
      countryId: "US",
      isDefault: false,
    };
    const orphanParty = {
      _id: new ObjectId(),
      sequentialId: 78,
      countryId: "US",
      isDefault: false,
    };
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      makeCursor([charteredParty, orphanParty])
    );
    setupEmptyMemberCounts(db);
    db.collectionMocks["partyCharters"]!.find.mockReturnValue(
      makeCursor([{ partyId: "77", countryId: "US" }])
    );
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual(["78"]);
  });

  it("never processes default parties (isDefault: true is excluded from query)", async () => {
    // The find query uses { isDefault: { $ne: true } }, so default parties are
    // never returned. Simulate the DB correctly filtering them out.
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual([]);
    // Verify the find was called with the right filter
    const findCall = db.collectionMocks["politicalParties"]!.find.mock.calls[0];
    expect(findCall[0]).toEqual({ isDefault: { $ne: true } });
  });

  // ── Full cascade delete ───────────────────────────────────────────────────

  it("deletes empty party and all associated data, returning accurate counts", async () => {
    const party = { _id: new ObjectId(), sequentialId: 99, countryId: "US", isDefault: false };
    const caucusId = new ObjectId();

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);

    // States for country scoping
    db.collectionMocks["states"]!.find.mockReturnValue(
      makeCursor([{ _id: "US-CA" }, { _id: "US-TX" }])
    );

    // Election lookups return empty (no elections to cascade)
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["caucuses"]!.find.mockReturnValue(makeCursor([{ _id: caucusId }]));

    // deleteMany return values for each collection
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 3 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 2 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual(["99"]);
    expect(result.deletedStatePartyOrgs).toBe(3);
    expect(result.deletedPartyBudgets).toBe(1);
    expect(result.deletedBillWhips).toBe(2);
    expect(result.deletedStateElections).toBe(1);

    // Party itself should be deleted by _id
    expect(db.collectionMocks["politicalParties"]!.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [party._id] },
    });
    expect(db.collectionMocks["caucusMemberships"]!.deleteMany).toHaveBeenCalledWith({
      caucusId: { $in: [caucusId] },
    });
    expect(db.collectionMocks["caucusPolicyPositions"]!.deleteMany).toHaveBeenCalledWith({
      caucusId: { $in: [caucusId] },
    });
    expect(db.collectionMocks["recruitmentSlates"]!.deleteMany).toHaveBeenCalledWith({
      $or: [{ countryId: "US", partyId: "99" }],
    });
    expect(db.collectionMocks["slateCandidates"]!.deleteMany).toHaveBeenCalledWith({
      $or: [{ countryId: "US", partyId: "99" }],
    });
    expect(db.collectionMocks["treasuryTransactions"]!.deleteMany).toHaveBeenCalledWith({
      $or: [{ countryId: "US", partyId: "99" }],
    });
    expect(db.collectionMocks["caucuses"]!.deleteMany).toHaveBeenCalledWith({
      $or: [{ countryId: "US", partyId: "99" }],
    });
  });

  it("cascades candidate and vote deletes when elections exist for deleted party", async () => {
    const party = { _id: new ObjectId(), sequentialId: 10, countryId: "US", isDefault: false };
    const stateElectionId = new ObjectId();
    const nationalElectionId = new ObjectId();

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([{ _id: "US-CA" }]));

    // Existing elections
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(
      makeCursor([{ _id: stateElectionId }])
    );
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(
      makeCursor([{ _id: nationalElectionId }])
    );
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));

    // Candidate/vote deletes return counts
    db.collectionMocks["statePartyCandidates"]!.deleteMany.mockResolvedValue({ deletedCount: 4 });
    db.collectionMocks["statePartyVotes"]!.deleteMany.mockResolvedValue({ deletedCount: 12 });
    db.collectionMocks["nationalPartyCandidates"]!.deleteMany.mockResolvedValue({
      deletedCount: 2,
    });
    db.collectionMocks["nationalPartyVotes"]!.deleteMany.mockResolvedValue({ deletedCount: 6 });
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedStateCandidates).toBe(4);
    expect(result.deletedStateVotes).toBe(12);
    expect(result.deletedNationalCandidates).toBe(2);
    expect(result.deletedNationalVotes).toBe(6);
    expect(result.deletedStateElections).toBe(1);
    expect(result.deletedNationalElections).toBe(1);

    // Candidates deleted with electionId filter scoped to found election IDs
    expect(db.collectionMocks["statePartyCandidates"]!.deleteMany).toHaveBeenCalledWith({
      electionId: { $in: [stateElectionId] },
    });
    expect(db.collectionMocks["nationalPartyCandidates"]!.deleteMany).toHaveBeenCalledWith({
      electionId: { $in: [nationalElectionId] },
    });
  });

  // ── Multiple empty parties in one pass ───────────────────────────────────

  it("deletes multiple empty parties atomically in a single pass", async () => {
    const partyA = { _id: new ObjectId(), sequentialId: 20, countryId: "US", isDefault: false };
    const partyB = { _id: new ObjectId(), sequentialId: 21, countryId: "US", isDefault: false };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([partyA, partyB]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 2 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 2 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    // Both sequential IDs should be reported
    expect(result.deletedParties).toEqual(expect.arrayContaining(["20", "21"]));
    expect(result.deletedParties).toHaveLength(2);

    // The parties deleteMany call should include both _ids
    const deleteCall = db.collectionMocks["politicalParties"]!.deleteMany.mock.calls[0];
    const deletedIds = deleteCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(deletedIds).toContain(partyA._id.toString());
    expect(deletedIds).toContain(partyB._id.toString());
  });

  it("only deletes empty parties when mixed populated/empty exist in same pass", async () => {
    const emptyParty = {
      _id: new ObjectId(),
      sequentialId: 30,
      countryId: "US",
      isDefault: false,
    };
    const populatedParty = {
      _id: new ObjectId(),
      sequentialId: 31,
      countryId: "US",
      isDefault: false,
    };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      makeCursor([emptyParty, populatedParty])
    );
    // Party 31 has NPP members; party 30 has none
    db.collectionMocks["characters"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["npps"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: { countryId: "US", party: "31" }, count: 2 }, // populated party has NPPs
      ]),
    });
    db.collectionMocks["electedOfficials"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    const result = await cleanupEmptyParties();

    expect(result.deletedParties).toEqual(["30"]);
    const deleteCall = db.collectionMocks["politicalParties"]!.deleteMany.mock.calls[0];
    const deletedIds = deleteCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(deletedIds).toContain(emptyParty._id.toString());
    expect(deletedIds).not.toContain(populatedParty._id.toString());
  });

  // ── State election country scoping ────────────────────────────────────────

  it("scopes state party election lookups to the correct country's states", async () => {
    // UK party — state elections should be scoped to UK state IDs, not US ones.
    const ukParty = { _id: new ObjectId(), sequentialId: 3, countryId: "UK", isDefault: false };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([ukParty]));
    setupEmptyMemberCounts(db);

    // States lookup — only UK states returned
    const ukStateId = "LON";
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([{ _id: ukStateId }]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    await cleanupEmptyParties();

    // The states.find should have been called with UK countryId to scope state election lookup
    const statesFindCalls = db.collectionMocks["states"]!.find.mock.calls;
    expect(statesFindCalls.length).toBeGreaterThan(0);
    expect(statesFindCalls[0][0]).toMatchObject({ countryId: "UK" });

    // statePartyElections.find filter should include the UK stateId
    const speFindCalls = db.collectionMocks["statePartyElections"]!.find.mock.calls;
    expect(speFindCalls.length).toBeGreaterThan(0);
    const orFilter = speFindCalls[0][0].$or as { partyId: string; stateId: { $in: string[] } }[];
    expect(orFilter.some((f) => f.stateId.$in.includes(ukStateId))).toBe(true);
  });

  // ── Coalition cascade: last member → dissolve ─────────────────────────────

  it("deletes coalition entirely when deleted party is the last member", async () => {
    const partyOid = new ObjectId();
    const party = {
      _id: partyOid,
      sequentialId: 50,
      countryId: "US",
      isDefault: false,
    };

    const coalitionId = new ObjectId();
    const coalition = makeCoalition({
      _id: coalitionId,
      chairPartyId: partyOid,
      members: [{ partyId: partyOid, partySequentialId: 50, joinedAt: new Date() }],
    });

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });

    // Coalition contains only this party
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(coalition);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    await cleanupEmptyParties();

    // Should delete the coalition entirely (last member)
    expect(db.collectionMocks["coalitions"]!.deleteOne).toHaveBeenCalledWith({
      _id: coalitionId,
    });
    expect(db.collectionMocks["coalitions"]!.updateOne).not.toHaveBeenCalled();
  });

  // ── Coalition cascade: non-chair member removed ───────────────────────────

  it("removes deleted party from coalition members list when it is a non-chair member", async () => {
    const chairPartyId = new ObjectId();
    const memberPartyId = new ObjectId();
    const party = { _id: memberPartyId, sequentialId: 60, countryId: "US", isDefault: false };

    const coalitionId = new ObjectId();
    const coalition = makeCoalition({
      _id: coalitionId,
      chairPartyId,
      members: [
        { partyId: chairPartyId, partySequentialId: 55, joinedAt: new Date("2025-01-01") },
        { partyId: memberPartyId, partySequentialId: 60, joinedAt: new Date("2025-06-01") },
      ],
    });

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(coalition);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    await cleanupEmptyParties();

    // Coalition should be updated (not deleted), removing the member
    expect(db.collectionMocks["coalitions"]!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["coalitions"]!.updateOne).toHaveBeenCalledWith(
      { _id: coalitionId },
      expect.objectContaining({
        $pull: { members: { partyId: memberPartyId } },
        $set: expect.objectContaining({ updatedAt: expect.any(Date) }),
      })
    );
  });

  // ── Coalition cascade: chair's party deleted → transfer leadership ────────

  it("transfers coalition chair to earliest-joining remaining member when chair party is deleted", async () => {
    const deletedPartyId = new ObjectId();
    const nextChairPartyId = new ObjectId();
    const nextChairCharId = new ObjectId();

    const party = { _id: deletedPartyId, sequentialId: 70, countryId: "US", isDefault: false };

    const coalitionId = new ObjectId();
    const coalition = makeCoalition({
      _id: coalitionId,
      chairPartyId: deletedPartyId,
      members: [
        // Oldest joining member → should become new chair
        {
          partyId: nextChairPartyId,
          partySequentialId: 71,
          joinedAt: new Date("2024-01-01"),
        },
        // The deleted party joined later
        {
          partyId: deletedPartyId,
          partySequentialId: 70,
          joinedAt: new Date("2024-06-01"),
        },
      ],
    });

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(coalition);

    // The successor party has a chairId (character leading it)
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: nextChairPartyId,
      chairId: nextChairCharId,
    });

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    await cleanupEmptyParties();

    // Coalition should be updated with new chairPartyId and chairCharacterId
    expect(db.collectionMocks["coalitions"]!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["coalitions"]!.updateOne).toHaveBeenCalledWith(
      { _id: coalitionId },
      expect.objectContaining({
        $pull: { members: { partyId: deletedPartyId } },
        $set: expect.objectContaining({
          chairPartyId: nextChairPartyId,
          chairCharacterId: nextChairCharId,
          updatedAt: expect.any(Date),
        }),
      })
    );
  });

  it("does nothing to coalitions when deleted party has no coalition membership", async () => {
    const party = { _id: new ObjectId(), sequentialId: 80, countryId: "US", isDefault: false };

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([party]));
    setupEmptyMemberCounts(db);
    db.collectionMocks["states"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["nationalCommitteeElections"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalPartyElections"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["nationalCommitteeElections"]!.deleteMany.mockResolvedValue({
      deletedCount: 0,
    });
    db.collectionMocks["statePartyOrg"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["partyBudget"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks["billWhips"]!.deleteMany.mockResolvedValue({ deletedCount: 0 });
    // No coalition found for this party
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(null);

    const { cleanupEmptyParties } = await import("./emptyPartyCleanup");
    await cleanupEmptyParties();

    expect(db.collectionMocks["coalitions"]!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["coalitions"]!.updateOne).not.toHaveBeenCalled();
  });
});
