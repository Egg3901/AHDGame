/**
 * Tests for nationalPartyElections.ts
 * Focused on cross-country party isolation — ensures elections
 * assign winners to the correct party when sequentialIds collide.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { ObjectId } from "mongodb";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));

// Flexible mock collection that returns different data per collection name
const mockCollections: Record<string, Record<string, Mock>> = {};

function setMockCollection(name: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, Mock> = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    ...overrides,
  };
  mockCollections[name] = defaults;
  return defaults;
}

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: vi.fn((name: string) => {
      if (!mockCollections[name]) {
        setMockCollection(name);
      }
      return mockCollections[name];
    }),
  }),
}));

// ─── Test Data ──────────────────────────────────────────────────────────────

const US_PARTY_OID = new ObjectId();
const UK_PARTY_OID = new ObjectId();

/** Two parties in different countries that share sequentialId = 1 */
const usParty = {
  _id: US_PARTY_OID,
  sequentialId: 1,
  countryId: "US" as const,
  name: "Democratic Party",
  chairId: null,
  viceChairId: null,
  treasurerId: null,
};

const ukParty = {
  _id: UK_PARTY_OID,
  sequentialId: 1,
  countryId: "UK" as const,
  name: "Reform UK",
  chairId: null,
  viceChairId: null,
  treasurerId: null,
};

const US_ELECTION_ID = new ObjectId();
const UK_ELECTION_ID = new ObjectId();

const US_WINNER_ID = new ObjectId();
const UK_WINNER_ID = new ObjectId();

function makeElection(
  id: ObjectId,
  countryId: "US" | "UK",
  position: "chair" | "viceChair" | "treasurer" = "chair"
) {
  return {
    _id: id,
    partyId: "1",
    countryId,
    position,
    status: "voting",
    startTurn: 1,
    endTurn: 10,
    startTime: new Date(),
    endTime: new Date(),
    durationTurns: 96,
    winnerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCandidate(
  electionId: ObjectId,
  characterId: ObjectId,
  name: string,
  position: "chair" | "viceChair" | "treasurer" = "chair"
) {
  return {
    _id: new ObjectId(),
    electionId,
    characterId,
    characterName: name,
    position,
    enteredAt: new Date(),
    status: "active",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("processCompletedNationalElections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mock collections
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  it("assigns winner to the correct party when sequentialIds collide across countries", async () => {
    // Both elections end at the same turn, both for partyId "1" but in different countries
    const usElection = makeElection(US_ELECTION_ID, "US");
    const ukElection = makeElection(UK_ELECTION_ID, "UK");

    const usCand = makeCandidate(US_ELECTION_ID, US_WINNER_ID, "US Chair Winner");
    const ukCand = makeCandidate(UK_ELECTION_ID, UK_WINNER_ID, "UK Chair Winner");

    // Set up nationalPartyElections collection
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usElection, ukElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    });

    // Set up candidates collection — return all candidates for both elections
    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usCand, ukCand]),
      }),
    });

    // Set up votes — one vote for each candidate in their respective election
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { electionId: US_ELECTION_ID, candidateId: US_WINNER_ID, count: 3 },
          { electionId: UK_ELECTION_ID, candidateId: UK_WINNER_ID, count: 2 },
        ]),
      }),
    });

    // Set up parties — both have sequentialId: 1 but different countries
    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usParty, ukParty]),
      }),
      bulkWrite: partyBulkWrite,
    });

    // Mock characters for notification lookups
    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({
        _id: US_WINNER_ID,
        userId: new ObjectId(),
        name: "Test",
      }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");

    const result = await processCompletedNationalElections(10);
    expect(result).toBe(2);

    // Verify bulkWrite was called with correct party updates
    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const bulkOps = partyBulkWrite.mock.calls[0][0];
    expect(bulkOps).toHaveLength(2);

    // Find the US party update and UK party update
    const usUpdate = bulkOps.find((op: { updateOne: { filter: { _id: ObjectId } } }) =>
      op.updateOne.filter._id.equals(US_PARTY_OID)
    );
    const ukUpdate = bulkOps.find((op: { updateOne: { filter: { _id: ObjectId } } }) =>
      op.updateOne.filter._id.equals(UK_PARTY_OID)
    );

    // US election winner should be assigned to US party, not UK party
    expect(usUpdate).toBeDefined();
    expect(usUpdate.updateOne.update.$set.chairId.equals(US_WINNER_ID)).toBe(true);

    // UK election winner should be assigned to UK party, not US party
    expect(ukUpdate).toBeDefined();
    expect(ukUpdate.updateOne.update.$set.chairId.equals(UK_WINNER_ID)).toBe(true);
  });

  it("handles elections where only one country has that sequentialId", async () => {
    const ukElection = makeElection(UK_ELECTION_ID, "UK", "viceChair");
    const ukCand = makeCandidate(UK_ELECTION_ID, UK_WINNER_ID, "UK VC Winner", "viceChair");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([ukElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([ukCand]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: UK_ELECTION_ID, candidateId: UK_WINNER_ID, count: 1 }]),
      }),
    });

    // Return both parties (both have sequentialId 1) — only UK party should be updated
    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usParty, ukParty]),
      }),
      bulkWrite: partyBulkWrite,
    });

    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({
        _id: UK_WINNER_ID,
        userId: new ObjectId(),
        name: "Test",
      }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");

    await processCompletedNationalElections(10);

    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const bulkOps = partyBulkWrite.mock.calls[0][0];
    expect(bulkOps).toHaveLength(1);

    // Must update UK party, not US party
    const op = bulkOps[0];
    expect(op.updateOne.filter._id.equals(UK_PARTY_OID)).toBe(true);
    expect(op.updateOne.update.$set.viceChairId.equals(UK_WINNER_ID)).toBe(true);
  });

  it("excludes banned voters and banned candidates from the tally", async () => {
    const election = makeElection(US_ELECTION_ID, "US");

    const bannedUserId = new ObjectId();
    const bannedCharId = new ObjectId();
    const cleanCharId = new ObjectId();

    // Two candidates: one belongs to a banned user, one is clean.
    const bannedCand = makeCandidate(US_ELECTION_ID, bannedCharId, "Banned Cand");
    const cleanCand = makeCandidate(US_ELECTION_ID, cleanCharId, "Clean Cand");

    setMockCollection("users", {
      find: vi.fn().mockReturnValue({
        project: vi
          .fn()
          .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: bannedUserId }]) }),
      }),
    });
    setMockCollection("characters", {
      // Banned-user lookup → returns the banned character.
      find: vi.fn().mockReturnValue({
        project: vi
          .fn()
          .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: bannedCharId }]) }),
      }),
      findOne: vi
        .fn()
        .mockResolvedValue({ _id: cleanCharId, userId: new ObjectId(), name: "Clean Cand" }),
    });

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([bannedCand, cleanCand]),
      }),
    });

    // Aggregation results — the production query uses $nin on banned voter ids,
    // so only the clean voter's row is returned. The clean candidate has fewer
    // raw votes than the banned candidate, but the banned candidate's votes
    // never reach this aggregation in the real DB.
    const aggregateMock = vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ electionId: US_ELECTION_ID, candidateId: cleanCharId, count: 1 }]),
    });
    setMockCollection("nationalPartyVotes", { aggregate: aggregateMock });

    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usParty]),
      }),
      bulkWrite: partyBulkWrite,
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");
    await processCompletedNationalElections(10);

    // Clean candidate must win — banned candidate must not be the winner.
    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const op = partyBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.chairId.equals(cleanCharId)).toBe(true);

    // The aggregation must filter banned voter ids via $nin.
    const aggregateCall = aggregateMock.mock.calls[0][0];
    const matchStage = aggregateCall.find((s: Record<string, unknown>) => "$match" in s);
    const matchFilter = (matchStage as { $match: Record<string, { $nin?: ObjectId[] } | unknown> })
      .$match;
    const voterFilter = matchFilter.voterId as { $nin: ObjectId[] };
    expect(voterFilter).toBeDefined();
    expect(voterFilter.$nin.map((id) => id.toString())).toEqual([bannedCharId.toString()]);
  });

  it("auto-vacates a winner's existing office in the same party when they win a different one", async () => {
    // Scenario: P is currently chair. The chair election runs but P doesn't
    // re-enter (or there are no candidates). At the same time P wins the VC
    // election. P should be assigned VC AND vacated as chair.
    const VC_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();

    const vcElection = makeElection(VC_ELECTION_ID, "US", "viceChair");
    const vcCand = makeCandidate(VC_ELECTION_ID, PERSON_P_ID, "Person P", "viceChair");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([vcElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([vcCand]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: VC_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 }]),
      }),
    });

    // P is currently chair of usParty.
    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ ...usParty, chairId: PERSON_P_ID }]),
      }),
      bulkWrite: partyBulkWrite,
    });

    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({
        _id: PERSON_P_ID,
        userId: new ObjectId(),
        name: "Person P",
      }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const coalitionBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    setMockCollection("coalitions", { bulkWrite: coalitionBulkWrite });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");
    await processCompletedNationalElections(10);

    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const op = partyBulkWrite.mock.calls[0][0][0];
    // Winner is assigned to vice chair
    expect(op.updateOne.update.$set.viceChairId.equals(PERSON_P_ID)).toBe(true);
    // And vacated from chair
    expect(op.updateOne.update.$set.chairId).toBeNull();

    // Coalition chair sync runs because chair vacated.
    expect(coalitionBulkWrite).toHaveBeenCalledOnce();
    const coalitionOp = coalitionBulkWrite.mock.calls[0][0][0];
    expect(coalitionOp.updateMany.update.$set.chairCharacterId).toBeNull();
  });

  it("does not vacate the previous chair when someone else won that chair race in the same batch", async () => {
    // Same person P holds chair. Both chair AND VC elections resolve in this batch.
    // Person Q wins chair. Person P doesn't run for chair but wins VC.
    // Result: chairId=Q (from Q's election win), viceChairId=P (from P's election win).
    // The auto-vacate logic must NOT clobber chairId back to null.
    const CHAIR_ELECTION_ID = new ObjectId();
    const VC_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();
    const PERSON_Q_ID = new ObjectId();

    const chairElection = makeElection(CHAIR_ELECTION_ID, "US", "chair");
    const vcElection = makeElection(VC_ELECTION_ID, "US", "viceChair");
    const chairCand = makeCandidate(CHAIR_ELECTION_ID, PERSON_Q_ID, "Person Q", "chair");
    const vcCand = makeCandidate(VC_ELECTION_ID, PERSON_P_ID, "Person P", "viceChair");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairElection, vcElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairCand, vcCand]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { electionId: CHAIR_ELECTION_ID, candidateId: PERSON_Q_ID, count: 1 },
          { electionId: VC_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 },
        ]),
      }),
    });

    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ ...usParty, chairId: PERSON_P_ID }]),
      }),
      bulkWrite: partyBulkWrite,
    });

    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({
        _id: PERSON_P_ID,
        userId: new ObjectId(),
        name: "Person",
      }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const coalitionBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    setMockCollection("coalitions", { bulkWrite: coalitionBulkWrite });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");
    await processCompletedNationalElections(10);

    // Should be a single consolidated update for the party with both fields set.
    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const ops = partyBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.updateOne.update.$set.chairId.equals(PERSON_Q_ID)).toBe(true);
    expect(op.updateOne.update.$set.viceChairId.equals(PERSON_P_ID)).toBe(true);

    // Coalition sync should reflect the new chair (Q), not null.
    expect(coalitionBulkWrite).toHaveBeenCalledOnce();
    const coalitionOp = coalitionBulkWrite.mock.calls[0][0][0];
    expect(coalitionOp.updateMany.update.$set.chairCharacterId.equals(PERSON_Q_ID)).toBe(true);
  });

  it("does not update any party when the seat is already vacant and no candidates stand", async () => {
    const election = makeElection(US_ELECTION_ID, "US");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    const partyBulkWrite = vi.fn();
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([usParty]),
      }),
      bulkWrite: partyBulkWrite,
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");

    await processCompletedNationalElections(10);

    // No party updates when there are no candidates
    expect(partyBulkWrite).not.toHaveBeenCalled();
  });

  // ─── Ticket #1100: zero-candidate officer races ──────────────────────────
  //
  // A cycle that closes with no winner used to leave the incumbent seated
  // unconditionally, so an officer who never re-stood held the office forever.
  // A mandate is now only renewed by standing.
  describe("no-winner races (ticket #1100)", () => {
    const INCUMBENT_ID = new ObjectId();

    function setupNoWinnerRace(
      party: Record<string, unknown>,
      candidates: ReturnType<typeof makeCandidate>[],
      position: "chair" | "viceChair" | "treasurer" = "treasurer"
    ) {
      setMockCollection("nationalPartyElections", {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([makeElection(UK_ELECTION_ID, "UK", position)]),
        }),
        bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      });
      setMockCollection("nationalPartyCandidates", {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }),
      });
      setMockCollection("nationalPartyVotes", {
        aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      });
      const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      setMockCollection("politicalParties", {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
        bulkWrite: partyBulkWrite,
      });
      setMockCollection("characters", {
        findOne: vi.fn().mockResolvedValue({
          _id: INCUMBENT_ID,
          userId: new ObjectId(),
          name: "Incumbent",
        }),
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      });
      return partyBulkWrite;
    }

    it("vacates the seat when nobody stands and the incumbent did not re-stand", async () => {
      const partyBulkWrite = setupNoWinnerRace(
        { ...ukParty, treasurerId: INCUMBENT_ID },
        [] // zero candidates
      );

      const { processCompletedNationalElections } = await import("./nationalPartyElections");
      await processCompletedNationalElections(10);

      expect(partyBulkWrite).toHaveBeenCalledOnce();
      const ops = partyBulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.filter._id).toEqual(UK_PARTY_OID);
      expect(ops[0].updateOne.update.$set.treasurerId).toBeNull();
      // Only the contested office is touched.
      expect(ops[0].updateOne.update.$set).not.toHaveProperty("chairId");
      expect(ops[0].updateOne.update.$set).not.toHaveProperty("viceChairId");
    });

    it("keeps the incumbent when they stood but the race drew no votes", async () => {
      const partyBulkWrite = setupNoWinnerRace({ ...ukParty, treasurerId: INCUMBENT_ID }, [
        makeCandidate(UK_ELECTION_ID, INCUMBENT_ID, "Incumbent", "treasurer"),
      ]);

      const { processCompletedNationalElections } = await import("./nationalPartyElections");
      await processCompletedNationalElections(10);

      // An uncontested, unvoted race is not a repudiation, so no seat change.
      expect(partyBulkWrite).not.toHaveBeenCalled();
    });

    it("vacates a chair seat and clears the led coalition's chair", async () => {
      const partyBulkWrite = setupNoWinnerRace({ ...ukParty, chairId: INCUMBENT_ID }, [], "chair");
      const coalitionBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      setMockCollection("coalitions", { bulkWrite: coalitionBulkWrite });

      const { processCompletedNationalElections } = await import("./nationalPartyElections");
      await processCompletedNationalElections(10);

      const ops = partyBulkWrite.mock.calls[0][0];
      expect(ops[0].updateOne.update.$set.chairId).toBeNull();

      expect(coalitionBulkWrite).toHaveBeenCalledOnce();
      const coalitionOps = coalitionBulkWrite.mock.calls[0][0];
      expect(coalitionOps[0].updateMany.filter.chairPartyId).toEqual(UK_PARTY_OID);
      expect(coalitionOps[0].updateMany.update.$set.chairCharacterId).toBeNull();
    });
  });

  it("clears an older national leadership seat when the same winner takes a new one", async () => {
    const election = makeElection(US_ELECTION_ID, "US", "chair");
    const candidate = makeCandidate(US_ELECTION_ID, US_WINNER_ID, "Dual Role Winner", "chair");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([candidate]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: US_ELECTION_ID, candidateId: US_WINNER_ID, count: 4 }]),
      }),
    });

    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            ...usParty,
            viceChairId: US_WINNER_ID,
          },
        ]),
      }),
      bulkWrite: partyBulkWrite,
    });

    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({
        _id: US_WINNER_ID,
        userId: new ObjectId(),
        name: "Dual Role Winner",
      }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");

    await processCompletedNationalElections(10);

    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const update = partyBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(update.chairId.equals(US_WINNER_ID)).toBe(true);
    expect(update.viceChairId).toBeNull();
  });

  it("marks all active candidacies of resolved elections as completed", async () => {
    // Regression: resolving an election left candidate docs status:"active",
    // which tripped the per-party unique index and blocked re-entry next cycle
    // ("already running… withdraw first"). Resolution must terminalize them.
    const election = makeElection(US_ELECTION_ID, "US", "chair");
    const candidate = makeCandidate(US_ELECTION_ID, US_WINNER_ID, "Winner", "chair");

    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    const candidateUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("nationalPartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([candidate]),
      }),
      updateMany: candidateUpdateMany,
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: US_ELECTION_ID, candidateId: US_WINNER_ID, count: 1 }]),
      }),
    });

    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([usParty]) }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("characters", {
      findOne: vi.fn().mockResolvedValue({ _id: US_WINNER_ID, userId: new ObjectId(), name: "W" }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");
    await processCompletedNationalElections(10);

    expect(candidateUpdateMany).toHaveBeenCalledOnce();
    const [filter, update] = candidateUpdateMany.mock.calls[0];
    expect(filter.status).toBe("active");
    expect(filter.electionId.$in.map((id: ObjectId) => id.toString())).toContain(
      US_ELECTION_ID.toString()
    );
    expect(update.$set.status).toBe("completed");
    expect(update.$set.resolvedAt).toBeInstanceOf(Date);
  });
});

// ─── Quorum Acceleration Tests ──────────────────────────────────────────────

describe("applyQuorumAcceleration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  /** Voting-candidate find, then prior-completed-chair find (first-cycle gate). */
  function mockNationalElectionFinds(
    votingElections: unknown[],
    priorCompleted: unknown[] = [
      { partyId: "1", countryId: "US", position: "chair", status: "completed" },
    ]
  ) {
    setMockCollection("nationalPartyElections", {
      find: vi
        .fn()
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(votingElections) })
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(priorCompleted) }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
  }

  it("halves remaining timer when >50% of members have voted and chair seat is vacant", async () => {
    const electionId = new ObjectId();
    const partyOid = new ObjectId();
    // Election: startTurn=100, endTurn=196 (96 turns), current turn=120 → 76 turns remaining → halved to 38 → new endTurn=158
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 196,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const party = {
      _id: partyOid,
      sequentialId: 1,
      countryId: "US" as const,
      name: "Test Party",
      chairId: null, // vacant
      viceChairId: null,
      treasurerId: null,
      memberCount: 10,
    };

    mockNationalElectionFinds([election]);

    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([party]),
      }),
    });

    // 10 eligible player voters (NPPs excluded). Quorum denominator now derives
    // from live player membership, not the stored memberCount.
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "1", countryId: "US" }, count: 10 }]),
      }),
    });

    // 6 distinct voters (>50% of 10)
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 6 }]),
      }),
    });

    const bulkWriteMock = mockCollections["nationalPartyElections"].bulkWrite;

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(1);
    expect(bulkWriteMock).toHaveBeenCalledOnce();
    const ops = bulkWriteMock.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter._id.equals(electionId)).toBe(true);
    // Remaining = 196 - 120 = 76 → ceil(76/2) = 38 → new endTurn = 120 + 38 = 158
    expect(ops[0].updateOne.update.$set.endTurn).toBe(158);
    expect(ops[0].updateOne.update.$set.quorumAcceleratedAtTurn).toBe(120);
  });

  it("records originalEndTurn so the next election can defer to the natural cycle end", async () => {
    // Regression (chair desync): when acceleration shortens the chair election,
    // it must remember the pre-acceleration endTurn so createMissingNationalElections
    // does not immediately recreate the chair off-cycle. Without this the chair
    // cycle permanently drifts ahead of viceChair/treasurer.
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 196,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US" as const,
      name: "Test Party",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      memberCount: 10,
    };

    mockNationalElectionFinds([election]);
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "1", countryId: "US" }, count: 10 }]),
      }),
    });
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 6 }]),
      }),
    });

    const bulkWriteMock = mockCollections["nationalPartyElections"].bulkWrite;
    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    await applyQuorumAcceleration(120);

    const ops = bulkWriteMock.mock.calls[0][0];
    // The natural cycle end (196) is preserved even though endTurn drops to 158.
    expect(ops[0].updateOne.update.$set.originalEndTurn).toBe(196);
  });

  it("measures quorum against player members, not the NPP-inflated memberCount (#0701)", async () => {
    // Party has 4 player members but a stored memberCount of 21 (it carries 17
    // NPPs). NPPs do not vote in leadership elections, so 3 of 4 players voting
    // IS a >50% quorum and must accelerate — even though 3 <= floor(21/2)=10
    // would have failed against the stored count.
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      partyId: "2",
      countryId: "IE" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 196,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const party = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "IE" as const,
      name: "Fianna Fáil",
      chairId: null, // vacant
      viceChairId: null,
      treasurerId: null,
      memberCount: 21, // NPP-inflated; must be ignored by the quorum
    };

    mockNationalElectionFinds(
      [election],
      [{ partyId: "2", countryId: "IE", position: "chair", status: "completed" }]
    );
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    // 4 player members (NPPs excluded from the count).
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "2", countryId: "IE" }, count: 4 }]),
      }),
    });
    // 3 of 4 players voted → >50% quorum.
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 3 }]),
      }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(1);
    expect(mockCollections["nationalPartyElections"].bulkWrite).toHaveBeenCalledOnce();
  });

  it("does not accelerate on a party's first chair cycle (ticket #1023)", async () => {
    // Inaugural / post-reset races have no prior completed chair election. Quorum
    // would otherwise fire early (vacant seat + high early turnout) and desync
    // chair timers from viceChair/treasurer.
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 2,
      endTurn: 14,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 12,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US" as const,
      name: "Democratic Party",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      memberCount: 10,
    };

    mockNationalElectionFinds([election], []); // no prior completed chair cycle
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "1", countryId: "US" }, count: 10 }]),
      }),
    });
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 6 }]),
      }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(3);

    expect(result).toBe(0);
    expect(mockCollections["nationalPartyElections"].bulkWrite).not.toHaveBeenCalled();
  });

  it("does not accelerate when chair seat is occupied", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 196,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US" as const,
      name: "Test Party",
      chairId: new ObjectId(), // NOT vacant
      viceChairId: null,
      treasurerId: null,
      memberCount: 10,
    };

    mockNationalElectionFinds([election]);

    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([party]),
      }),
    });

    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 6 }]),
      }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(0);
    expect(mockCollections["nationalPartyElections"].bulkWrite).not.toHaveBeenCalled();
  });

  it("does not accelerate when quorum is not reached (≤50% voters)", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 196,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US" as const,
      name: "Test Party",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      memberCount: 10,
    };

    mockNationalElectionFinds([election]);

    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([party]),
      }),
    });

    // 10 eligible player voters.
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "1", countryId: "US" }, count: 10 }]),
      }),
    });

    // 5 voters = exactly 50% of 10, NOT >50%
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 5 }]),
      }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(0);
    expect(mockCollections["nationalPartyElections"].bulkWrite).not.toHaveBeenCalled();
  });

  it("does not accelerate elections that were already accelerated", async () => {
    // The find should return empty because the query filters on quorumAcceleratedAtTurn: { $exists: false }
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]), // filtered out by query
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(0);
  });

  it("does not accelerate non-chair elections", async () => {
    // Query filters position: "chair" so non-chair elections shouldn't be returned
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]), // filtered by position: "chair"
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    });

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(0);
  });

  it("correctly handles odd remaining turns by rounding up", async () => {
    const electionId = new ObjectId();
    // endTurn=123 → remaining=3 → ceil(3/2)=2 → new endTurn=122
    const election = {
      _id: electionId,
      partyId: "1",
      countryId: "US" as const,
      position: "chair" as const,
      status: "voting" as const,
      startTurn: 100,
      endTurn: 123,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 23,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US" as const,
      name: "Test Party",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      memberCount: 4,
    };

    mockNationalElectionFinds([election]);

    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([party]),
      }),
    });

    // 4 eligible player voters.
    setMockCollection("characters", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: { party: "1", countryId: "US" }, count: 4 }]),
      }),
    });

    // 3 voters > 50% of 4 (2)
    setMockCollection("nationalPartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ electionId, distinctVoters: 3 }]),
      }),
    });

    const bulkWriteMock = mockCollections["nationalPartyElections"].bulkWrite;

    const { applyQuorumAcceleration } = await import("./nationalPartyElections");
    const result = await applyQuorumAcceleration(120);

    expect(result).toBe(1);
    // remaining=3, ceil(3/2)=2, newEndTurn=120+2=122
    const ops = bulkWriteMock.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set.endTurn).toBe(122);
  });
});

// ─── Deferred recreation (cycle re-sync after acceleration) ─────────────────

describe("createMissingNationalElections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  const party = {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US" as const,
    name: "Test Party",
    chairId: null,
    viceChairId: null,
    treasurerId: null,
  };

  function activeElection(position: "chair" | "viceChair" | "treasurer") {
    return {
      _id: new ObjectId(),
      partyId: "1",
      countryId: "US" as const,
      position,
      status: "voting" as const,
      startTurn: 173,
      endTurn: 269,
      startTime: new Date(),
      endTime: new Date(),
      durationTurns: 96,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /** Routes nationalPartyElections.find by the query's status field. */
  function electionFind(active: unknown[], deferred: unknown[]) {
    return vi.fn().mockImplementation((q: { status?: string }) => ({
      toArray: vi
        .fn()
        .mockResolvedValue(
          q?.status === "voting" ? active : q?.status === "completed" ? deferred : []
        ),
    }));
  }

  it("does not recreate a chair election still inside its accelerated deferral window", async () => {
    // chair was accelerated and resolved early; its natural cycle end is turn 269.
    // At turn 250 the chair must stay closed (no active, no recreate) while
    // viceChair/treasurer keep running, so all three re-sync at 269.
    const deferredChair = {
      ...activeElection("chair"),
      status: "completed" as const,
      quorumAcceleratedAtTurn: 218,
      endTurn: 244,
      originalEndTurn: 269,
      winnerId: new ObjectId(),
    };

    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 0 });
    setMockCollection("nationalPartyElections", {
      find: electionFind(
        [activeElection("viceChair"), activeElection("treasurer")],
        [deferredChair]
      ),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(250, 96, new Date(), undefined);

    expect(created).toBe(0);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it("recreates the chair election once its deferral window has passed", async () => {
    // At/after turn 269 the deferred query returns nothing (originalEndTurn is no
    // longer > currentTurn), so the chair — the only position without an active
    // election — is recreated on the shared cycle.
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    setMockCollection("nationalPartyElections", {
      find: electionFind([activeElection("viceChair"), activeElection("treasurer")], []),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(269, 96, new Date(), undefined);

    expect(created).toBe(1);
    expect(insertMany).toHaveBeenCalledOnce();
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].position).toBe("chair");
  });

  it("creates all three positions for a party with no active or deferred elections", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("nationalPartyElections", {
      find: electionFind([], []),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(269, 96, new Date(), undefined);

    expect(created).toBe(3);
    expect(insertMany).toHaveBeenCalledOnce();
    const positions = insertMany.mock.calls[0][0].map((d: { position: string }) => d.position);
    expect(positions.sort()).toEqual(["chair", "treasurer", "viceChair"]);
  });

  it("aligns a new party's elections to the modal endTurn of active default-duration elections", async () => {
    // Existing default party (seq 1) is mid-cycle: elections end at turn 150.
    // New party (seq 2) has none. At turn 120 its elections must join the
    // shared cycle (endTurn 150), not start a fresh 72-turn window.
    const newParty = { ...party, _id: new ObjectId(), sequentialId: 2 };
    const active = (["chair", "viceChair", "treasurer"] as const).map((position) => ({
      ...activeElection(position),
      startTurn: 78,
      endTurn: 150,
      durationTurns: 72,
    }));

    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("nationalPartyElections", {
      find: electionFind(active, []),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party, newParty]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(120, 72, new Date(), undefined);

    expect(created).toBe(3);
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(doc.partyId).toBe("2");
      expect(doc.endTurn).toBe(150);
      expect(doc.durationTurns).toBe(30); // 150 - 120
    }
  });

  it("does not align parties with a voted custom duration", async () => {
    const customParty = {
      ...party,
      _id: new ObjectId(),
      sequentialId: 2,
      customElectionDurationTurns: 300,
    };
    const active = (["chair", "viceChair", "treasurer"] as const).map((position) => ({
      ...activeElection(position),
      startTurn: 78,
      endTurn: 150,
      durationTurns: 72,
    }));

    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("nationalPartyElections", {
      find: electionFind(active, []),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party, customParty]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(120, 72, new Date(), undefined);

    expect(created).toBe(3);
    const docs = insertMany.mock.calls[0][0];
    for (const doc of docs) {
      expect(doc.endTurn).toBe(420); // 120 + 300
      expect(doc.durationTurns).toBe(300);
    }
  });

  it("falls back to currentTurn + duration when no default-duration anchor exists", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("nationalPartyElections", {
      find: electionFind([], []),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(120, 72, new Date(), undefined);

    expect(created).toBe(3);
    const docs = insertMany.mock.calls[0][0];
    for (const doc of docs) {
      expect(doc.endTurn).toBe(192); // 120 + 72
      expect(doc.durationTurns).toBe(72);
    }
  });
});

describe("createMissingNationalElections — founding phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
    setMockCollection("gameState", {
      findOne: vi.fn().mockResolvedValue({ preIteration: { active: true } }),
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });
  });

  const party = {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US" as const,
    name: "Test Party",
    chairId: null,
    viceChairId: null,
    treasurerId: null,
  };

  it("spawns 12-turn founding-marked elections for every vacant leadership seat", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertMany,
    });

    const { createMissingNationalElections, FOUNDING_CHAIR_ELECTION_DURATION_TURNS } =
      await import("./nationalPartyElections");
    const created = await createMissingNationalElections(1, 96, new Date(), undefined);

    expect(created).toBe(3);
    expect(insertMany).toHaveBeenCalledOnce();
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(3);
    expect(docs.map((d: { position: string }) => d.position).sort()).toEqual([
      "chair",
      "treasurer",
      "viceChair",
    ]);
    for (const doc of docs) {
      expect(doc.durationTurns).toBe(FOUNDING_CHAIR_ELECTION_DURATION_TURNS);
      expect(doc.durationTurns).toBe(12);
      expect(doc.founding).toBe(true);
      expect(doc.endTurn).toBe(doc.startTurn + 12);
    }
  });

  it("skips seats that are already filled or already have an active founding race", async () => {
    const activeChair = {
      _id: new ObjectId(),
      partyId: "1",
      countryId: "US" as const,
      position: "chair",
      status: "voting" as const,
      startTurn: 1,
      endTurn: 13,
      durationTurns: 12,
      founding: true,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Party already has a vice-chair seated; only treasurer should spawn.
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ ...party, viceChairId: new ObjectId() }]),
      }),
    });
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([activeChair]) }),
      insertMany,
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(2, 96, new Date(), undefined);

    expect(created).toBe(1);
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].position).toBe("treasurer");
    expect(docs[0].founding).toBe(true);
  });

  it("does not spawn anything when every seat is covered", async () => {
    const active = (["chair", "viceChair", "treasurer"] as const).map((position) => ({
      _id: new ObjectId(),
      partyId: "1",
      countryId: "US" as const,
      position,
      status: "voting" as const,
      startTurn: 1,
      endTurn: 13,
      durationTurns: 12,
      founding: true,
      winnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 0 });
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(active) }),
      insertMany,
    });

    const { createMissingNationalElections } = await import("./nationalPartyElections");
    const created = await createMissingNationalElections(2, 96, new Date(), undefined);

    expect(created).toBe(0);
    expect(insertMany).not.toHaveBeenCalled();
  });
});

describe("vacateInactiveNationalLeadership — inactivity eviction (#3308)", () => {
  const mockDb = {
    collection: (name: string) => mockCollections[name] ?? setMockCollection(name),
  } as unknown as import("mongodb").Db;

  const HOUR = 60 * 60 * 1000;
  const NOW = new Date("2026-07-18T00:00:00Z");
  // 336-turn threshold = 336 hours. 900h ago is well past it; 1h ago is active.
  const INACTIVE_TS = new Date(NOW.getTime() - 900 * HOUR);
  const ACTIVE_TS = new Date(NOW.getTime() - 1 * HOUR);
  const PARTY_OID = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) delete mockCollections[key];
  });

  function projectFind<T>(rows: T[]) {
    return vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
      toArray: vi.fn().mockResolvedValue(rows),
    });
  }

  it("nulls an inactive chair, syncs the led coalition, and notifies", async () => {
    const CHAIR_CHAR_ID = new ObjectId();
    const USER_ID = new ObjectId();

    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: PARTY_OID,
            sequentialId: 1,
            countryId: "US",
            chairId: CHAIR_CHAR_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: partyBulkWrite,
    });
    setMockCollection("characters", {
      find: projectFind([{ _id: CHAIR_CHAR_ID, userId: USER_ID }]),
      findOne: vi.fn().mockResolvedValue({ _id: CHAIR_CHAR_ID, userId: USER_ID, name: "Absentee" }),
    });
    setMockCollection("users", {
      find: projectFind([{ _id: USER_ID, lastActivity: INACTIVE_TS, createdAt: INACTIVE_TS }]),
    });
    const coalitionUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("coalitions", { updateMany: coalitionUpdateMany });

    const { vacateInactiveNationalLeadership } = await import("./nationalPartyElections");
    const { createNotification } = await import("@/lib/notifications");

    const vacated = await vacateInactiveNationalLeadership(mockDb, 5000, NOW);

    expect(vacated).toBe(1);
    expect(partyBulkWrite).toHaveBeenCalledOnce();
    const op = partyBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.chairId).toBeNull();
    // Coalition led by this party had its chair synced to null.
    expect(coalitionUpdateMany).toHaveBeenCalledOnce();
    const [filter, update] = coalitionUpdateMany.mock.calls[0];
    expect(filter.chairPartyId.$in.map((o: ObjectId) => o.toString())).toContain(
      PARTY_OID.toString()
    );
    expect(update.$set.chairCharacterId).toBeNull();
    expect(createNotification).toHaveBeenCalledOnce();
    expect((createNotification as Mock).mock.calls[0][0].type).toBe("national_leadership_removed");
  });

  it("leaves an ACTIVE chair untouched — no party or coalition writes", async () => {
    const CHAIR_CHAR_ID = new ObjectId();
    const USER_ID = new ObjectId();

    const partyBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: PARTY_OID,
            sequentialId: 1,
            countryId: "US",
            chairId: CHAIR_CHAR_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: partyBulkWrite,
    });
    setMockCollection("characters", {
      find: projectFind([{ _id: CHAIR_CHAR_ID, userId: USER_ID }]),
    });
    setMockCollection("users", {
      find: projectFind([{ _id: USER_ID, lastActivity: ACTIVE_TS, createdAt: ACTIVE_TS }]),
    });
    const coalitionUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    setMockCollection("coalitions", { updateMany: coalitionUpdateMany });

    const { vacateInactiveNationalLeadership } = await import("./nationalPartyElections");

    const vacated = await vacateInactiveNationalLeadership(mockDb, 5000, NOW);

    expect(vacated).toBe(0);
    expect(partyBulkWrite).not.toHaveBeenCalled();
    expect(coalitionUpdateMany).not.toHaveBeenCalled();
  });
});
