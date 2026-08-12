/**
 * Tests for statePartyElections.ts focused on the cross-position auto-vacate
 * behavior that prevents a single character from holding multiple state party
 * leadership offices simultaneously.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));

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

const STATE_ID = "CA";
const PARTY_ID = "1";
const ORG_KEY = `${STATE_ID}_${PARTY_ID}`;

function makeElection(id: ObjectId, position: "chair" | "viceChair" | "treasurer") {
  return {
    _id: id,
    stateId: STATE_ID,
    partyId: PARTY_ID,
    countryId: "US" as const,
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
  position: "chair" | "viceChair" | "treasurer"
) {
  return {
    _id: new ObjectId(),
    electionId,
    characterId,
    characterName: name,
    stateId: STATE_ID,
    partyId: PARTY_ID,
    countryId: "US" as const,
    position,
    enteredAt: new Date(),
    status: "active",
  };
}

describe("processCompletedElections — cross-position auto-vacate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  it("vacates a winner's existing chair seat when they win vice chair", async () => {
    const VC_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();

    const vcElection = makeElection(VC_ELECTION_ID, "viceChair");
    const vcCand = makeCandidate(VC_ELECTION_ID, PERSON_P_ID, "Person P", "viceChair");

    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([vcElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("statePartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([vcCand]),
      }),
    });

    setMockCollection("statePartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: VC_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 }]),
      }),
    });

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: PERSON_P_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
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

    const { processCompletedElections } = await import("./statePartyElections");
    const resolved = await processCompletedElections(10);

    expect(resolved).toBe(1);
    expect(orgBulkWrite).toHaveBeenCalledOnce();
    const op = orgBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.filter._id).toBe(ORG_KEY);
    expect(op.updateOne.update.$set.viceChairId.equals(PERSON_P_ID)).toBe(true);
    expect(op.updateOne.update.$set.chairId).toBeNull();
  });

  it("does not vacate chair when another winner takes chair in the same batch", async () => {
    const CHAIR_ELECTION_ID = new ObjectId();
    const VC_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();
    const PERSON_Q_ID = new ObjectId();

    const chairElection = makeElection(CHAIR_ELECTION_ID, "chair");
    const vcElection = makeElection(VC_ELECTION_ID, "viceChair");
    const chairCand = makeCandidate(CHAIR_ELECTION_ID, PERSON_Q_ID, "Person Q", "chair");
    const vcCand = makeCandidate(VC_ELECTION_ID, PERSON_P_ID, "Person P", "viceChair");

    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairElection, vcElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    });

    setMockCollection("statePartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairCand, vcCand]),
      }),
    });

    setMockCollection("statePartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { electionId: CHAIR_ELECTION_ID, candidateId: PERSON_Q_ID, count: 1 },
          { electionId: VC_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 },
        ]),
      }),
    });

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: PERSON_P_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
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

    const { processCompletedElections } = await import("./statePartyElections");
    await processCompletedElections(10);

    // Two elections, same org → consolidated into a single update.
    expect(orgBulkWrite).toHaveBeenCalledOnce();
    const ops = orgBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.updateOne.update.$set.chairId.equals(PERSON_Q_ID)).toBe(true);
    expect(op.updateOne.update.$set.viceChairId.equals(PERSON_P_ID)).toBe(true);
  });

  it("vacates both prior offices when winner already holds two", async () => {
    // Defensive: covers the case where the existing-data bug already left a
    // character holding two offices. Winning a third should clear both stale ones.
    const TREASURER_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();

    const treasurerElection = makeElection(TREASURER_ELECTION_ID, "treasurer");
    const treasurerCand = makeCandidate(
      TREASURER_ELECTION_ID,
      PERSON_P_ID,
      "Person P",
      "treasurer"
    );

    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([treasurerElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("statePartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([treasurerCand]),
      }),
    });

    setMockCollection("statePartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { electionId: TREASURER_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 },
          ]),
      }),
    });

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: PERSON_P_ID,
            viceChairId: PERSON_P_ID,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
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

    const { processCompletedElections } = await import("./statePartyElections");
    await processCompletedElections(10);

    expect(orgBulkWrite).toHaveBeenCalledOnce();
    const op = orgBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.treasurerId.equals(PERSON_P_ID)).toBe(true);
    expect(op.updateOne.update.$set.chairId).toBeNull();
    expect(op.updateOne.update.$set.viceChairId).toBeNull();
  });

  it("does not clear other fields when winner re-elects to the same position", async () => {
    // Same person wins re-election to chair — viceChairId/treasurerId untouched.
    const CHAIR_ELECTION_ID = new ObjectId();
    const PERSON_P_ID = new ObjectId();
    const OTHER_VC_ID = new ObjectId();

    const chairElection = makeElection(CHAIR_ELECTION_ID, "chair");
    const chairCand = makeCandidate(CHAIR_ELECTION_ID, PERSON_P_ID, "Person P", "chair");

    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairElection]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    setMockCollection("statePartyCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([chairCand]),
      }),
    });

    setMockCollection("statePartyVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { electionId: CHAIR_ELECTION_ID, candidateId: PERSON_P_ID, count: 1 },
          ]),
      }),
    });

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: PERSON_P_ID,
            viceChairId: OTHER_VC_ID,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
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

    const { processCompletedElections } = await import("./statePartyElections");
    await processCompletedElections(10);

    expect(orgBulkWrite).toHaveBeenCalledOnce();
    const op = orgBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.chairId.equals(PERSON_P_ID)).toBe(true);
    // VC seat held by someone else must NOT be cleared.
    expect(op.updateOne.update.$set.viceChairId).toBeUndefined();
    expect(op.updateOne.update.$set.treasurerId).toBeUndefined();
  });
});

describe("vacateInactiveLeadership — inactivity eviction (#972)", () => {
  // Mock db whose collections resolve to the shared mockCollections registry.
  const mockDb = {
    collection: (name: string) => mockCollections[name] ?? setMockCollection(name),
  } as unknown as import("mongodb").Db;

  const HOUR = 60 * 60 * 1000;
  const NOW = new Date("2026-07-18T00:00:00Z");
  // 336-turn threshold = 336 hours. 900h ago is well past it; 1h ago is active.
  const INACTIVE_TS = new Date(NOW.getTime() - 900 * HOUR);
  const ACTIVE_TS = new Date(NOW.getTime() - 1 * HOUR);

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  function projectFind<T>(rows: T[]) {
    return vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
      toArray: vi.fn().mockResolvedValue(rows),
    });
  }

  it("nulls an inactive chair seat and emits the leadership-removed notification", async () => {
    const CHAIR_CHAR_ID = new ObjectId();
    const USER_ID = new ObjectId();

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: CHAIR_CHAR_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
    });

    setMockCollection("characters", {
      find: projectFind([{ _id: CHAIR_CHAR_ID, userId: USER_ID }]),
      findOne: vi.fn().mockResolvedValue({ _id: CHAIR_CHAR_ID, userId: USER_ID, name: "Lachlan" }),
    });

    setMockCollection("users", {
      find: projectFind([{ _id: USER_ID, lastActivity: INACTIVE_TS, createdAt: INACTIVE_TS }]),
    });

    const { vacateInactiveLeadership } = await import("./statePartyElections");
    const { createNotification } = await import("@/lib/notifications");

    const vacated = await vacateInactiveLeadership(mockDb, 5000, NOW);

    expect(vacated).toBe(1);
    expect(orgBulkWrite).toHaveBeenCalledOnce();
    const op = orgBulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.filter._id).toBe(ORG_KEY);
    expect(op.updateOne.update.$set.chairId).toBeNull();
    expect(createNotification).toHaveBeenCalledOnce();
    const notif = (createNotification as Mock).mock.calls[0][0];
    expect(notif.type).toBe("leadership_removed");
  });

  it("leaves an ACTIVE chair untouched and performs no writes", async () => {
    const CHAIR_CHAR_ID = new ObjectId();
    const USER_ID = new ObjectId();

    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: CHAIR_CHAR_ID,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
    });

    setMockCollection("characters", {
      find: projectFind([{ _id: CHAIR_CHAR_ID, userId: USER_ID }]),
      findOne: vi.fn().mockResolvedValue({ _id: CHAIR_CHAR_ID, userId: USER_ID, name: "Active" }),
    });

    setMockCollection("users", {
      find: projectFind([{ _id: USER_ID, lastActivity: ACTIVE_TS, createdAt: ACTIVE_TS }]),
    });

    const { vacateInactiveLeadership } = await import("./statePartyElections");
    const { createNotification } = await import("@/lib/notifications");

    const vacated = await vacateInactiveLeadership(mockDb, 5000, NOW);

    expect(vacated).toBe(0);
    expect(orgBulkWrite).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("skips already-vacant seats (no holders to check, no writes)", async () => {
    const orgBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const charFind = projectFind([]);
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: ORG_KEY,
            stateId: STATE_ID,
            partyId: PARTY_ID,
            countryId: "US",
            chairId: null,
            viceChairId: null,
            treasurerId: null,
          },
        ]),
      }),
      bulkWrite: orgBulkWrite,
    });
    setMockCollection("characters", { find: charFind });

    const { vacateInactiveLeadership } = await import("./statePartyElections");
    const { createNotification } = await import("@/lib/notifications");

    const vacated = await vacateInactiveLeadership(mockDb, 5000, NOW);

    expect(vacated).toBe(0);
    expect(charFind).not.toHaveBeenCalled(); // short-circuits before char lookup
    expect(orgBulkWrite).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("createMissingElections — shared default-cycle alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  function makeOrg(stateId: string, partyId: string) {
    return {
      _id: `${stateId}_${partyId}`,
      stateId,
      partyId,
      countryId: "US" as const,
      organization: 0,
      hasPresence: true,
    };
  }

  it("aligns newly created state elections to the modal endTurn of active default-duration elections", async () => {
    // Org CA_1 has active elections ending turn 150 (default 72-turn cycle);
    // org NY_2 has none. At turn 120 NY_2's elections must join the shared
    // cycle (endTurn 150), not start a fresh 72-turn window.
    const active = (["chair", "viceChair", "treasurer"] as const).map((position) => ({
      ...makeElection(new ObjectId(), position),
      startTurn: 78,
      endTurn: 150,
      durationTurns: 72,
    }));

    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(active) }),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { sequentialId: 1, countryId: "US" },
          { sequentialId: 2, countryId: "US" },
        ]),
      }),
    });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([makeOrg("CA", "1"), makeOrg("NY", "2")]),
      }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingElections } = await import("./statePartyElections");
    const created = await createMissingElections(120, 72, new Date(), undefined);

    expect(created).toBe(3); // NY_2 × three positions
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(doc.stateId).toBe("NY");
      expect(doc.partyId).toBe("2");
      expect(doc.endTurn).toBe(150);
      expect(doc.durationTurns).toBe(30); // 150 - 120
    }
  });

  it("falls back to currentTurn + duration when no anchor exists", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ sequentialId: 2, countryId: "US" }]),
      }),
    });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([makeOrg("NY", "2")]),
      }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingElections } = await import("./statePartyElections");
    const created = await createMissingElections(120, 72, new Date(), undefined);

    expect(created).toBe(3);
    const docs = insertMany.mock.calls[0][0];
    for (const doc of docs) {
      expect(doc.endTurn).toBe(192); // 120 + 72
      expect(doc.durationTurns).toBe(72);
    }
  });

  it("materializes territorial party chapters with resident members and opens their elections", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 6 });
    const orgBulkWrite = vi.fn().mockResolvedValue({ upsertedCount: 2 });
    setMockCollection("gameState", {
      findOne: vi.fn().mockResolvedValue({ preset: "1953-default", currentYear: 1953 }),
    });
    setMockCollection("states", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { sequentialId: 1, countryId: "US" },
          { sequentialId: 2, countryId: "US" },
        ]),
      }),
    });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      bulkWrite: orgBulkWrite,
    });
    setMockCollection("characters", {
      find: vi.fn((query: Record<string, unknown>) => {
        const rows =
          "homeState" in query
            ? [{ _id: new ObjectId(), userId: new ObjectId(), homeState: "HI", party: "1" }]
            : [];
        return {
          toArray: vi.fn().mockResolvedValue(rows),
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
        };
      }),
    });

    const { createMissingElections } = await import("./statePartyElections");
    const created = await createMissingElections(120, 72, new Date(), undefined);

    expect(orgBulkWrite).toHaveBeenCalledOnce();
    expect(created).toBe(6); // HI × two major parties × three positions
    expect(insertMany.mock.calls[0][0]).toHaveLength(6);
    expect(insertMany.mock.calls[0][0].every((e: { stateId: string }) => e.stateId === "HI")).toBe(
      true
    );
  });

  it("stamps founding:true and uses a fixed short window (no shared-cycle anchor)", async () => {
    // Active 72-turn races exist — without founding, new orgs would join that
    // cycle. Founding must ignore them and open a fresh 12-turn window.
    const active = (["chair", "viceChair", "treasurer"] as const).map((position) => ({
      ...makeElection(new ObjectId(), position),
      startTurn: 2,
      endTurn: 74,
      durationTurns: 72,
    }));
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    setMockCollection("statePartyElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(active) }),
      insertMany,
    });
    setMockCollection("politicalParties", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { sequentialId: 1, countryId: "US" },
          { sequentialId: 2, countryId: "US" },
        ]),
      }),
    });
    setMockCollection("statePartyOrg", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([makeOrg("CA", "1"), makeOrg("NY", "2")]),
      }),
    });
    setMockCollection("characters", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { createMissingElections, FOUNDING_STATE_ELECTION_DURATION_TURNS } =
      await import("./statePartyElections");
    const created = await createMissingElections(
      2,
      FOUNDING_STATE_ELECTION_DURATION_TURNS,
      new Date("2026-08-08T21:00:00Z"),
      undefined,
      { founding: true }
    );

    expect(created).toBe(3); // NY_2 × three positions
    const docs = insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(doc.stateId).toBe("NY");
      expect(doc.founding).toBe(true);
      expect(doc.endTurn).toBe(14); // 2 + 12
      expect(doc.durationTurns).toBe(12);
    }
  });
});
