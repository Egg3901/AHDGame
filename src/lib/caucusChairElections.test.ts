import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

const mockCollections: Record<string, Record<string, Mock>> = {};

function setMockCollection(name: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, Mock> = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    ...overrides,
  };
  mockCollections[name] = defaults;
  return defaults;
}

describe("caucusChairElections", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn((name: string) => {
        if (!mockCollections[name]) {
          setMockCollection(name);
        }
        return mockCollections[name];
      }),
    } as never);
  });

  it("anchors new caucus elections to the active national chair election window", async () => {
    const caucusId = new ObjectId();
    const anchorStart = new Date("2026-04-01T00:00:00.000Z");
    const anchorEnd = new Date("2026-04-05T00:00:00.000Z");
    const caucus = {
      _id: caucusId,
      countryId: "US",
      partyId: "1",
      name: "Unity Bloc",
      chairId: null,
      disbandedAt: null,
    };

    const electionInsert = setMockCollection("caucusChairElections", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    });
    const caucusCollection = setMockCollection("caucuses", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([caucus]) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    setMockCollection("nationalPartyElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            partyId: "1",
            countryId: "US",
            position: "chair",
            status: "voting",
            startTime: anchorStart,
            endTime: anchorEnd,
            startTurn: 50,
            endTurn: 146,
            durationTurns: 96,
          },
        ]),
      }),
    });
    setMockCollection("caucusMemberships", {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    setMockCollection("characters");

    const { createMissingCaucusChairElections } = await import("./caucusChairElections");
    const created = await createMissingCaucusChairElections(99);

    expect(created).toBe(1);
    expect(electionInsert.insertMany).toHaveBeenCalledOnce();
    const inserted = electionInsert.insertMany.mock.calls[0][0][0];
    expect(inserted.caucusId.equals(caucusId)).toBe(true);
    expect(inserted.startTurn).toBe(50);
    expect(inserted.endTurn).toBe(146);
    expect(inserted.startTime.toISOString()).toBe(anchorStart.toISOString());
    expect(inserted.endTime.toISOString()).toBe(anchorEnd.toISOString());
    expect(caucusCollection.updateOne).toHaveBeenCalledWith(
      { _id: caucusId },
      expect.objectContaining({ $set: expect.objectContaining({ nextElectionTurn: 146 }) })
    );
  });

  it("promotes the winner to caucus chair and demotes the prior chair", async () => {
    const caucusId = new ObjectId();
    const electionId = new ObjectId();
    const oldChairId = new ObjectId();
    const winnerId = new ObjectId();
    const caucusCollection = setMockCollection("caucuses", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: caucusId,
            partyId: "1",
            countryId: "US",
            name: "Unity Bloc",
            chairId: oldChairId,
          },
        ]),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    setMockCollection("caucusChairElections", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: electionId,
            caucusId,
            partyId: "1",
            countryId: "US",
            status: "voting",
            startTurn: 1,
            endTurn: 96,
          },
        ]),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    setMockCollection("caucusChairCandidates", {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            electionId,
            caucusId,
            characterId: winnerId,
            characterName: "Winner",
            status: "active",
            enteredAt: new Date("2026-04-01T00:00:00.000Z"),
          },
          {
            _id: new ObjectId(),
            electionId,
            caucusId,
            characterId: oldChairId,
            characterName: "Incumbent",
            status: "active",
            enteredAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ]),
      }),
    });
    setMockCollection("caucusChairVotes", {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { electionId, candidateId: winnerId, count: 3 },
          { electionId, candidateId: oldChairId, count: 2 },
        ]),
      }),
    });
    const membershipCollection = setMockCollection("caucusMemberships", {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    setMockCollection("characters", {
      findOne: vi.fn().mockImplementation(async ({ _id }) => ({
        _id,
        userId: new ObjectId(),
        name: _id.equals(winnerId) ? "Winner" : "Incumbent",
      })),
    });
    setMockCollection("users", {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const { processCompletedCaucusChairElections } = await import("./caucusChairElections");
    const completed = await processCompletedCaucusChairElections(96);

    expect(completed).toBe(1);
    expect(caucusCollection.updateOne).toHaveBeenCalledWith(
      { _id: caucusId },
      expect.objectContaining({
        $set: expect.objectContaining({ chairId: winnerId, lastElectedTurn: 96 }),
        $inc: { termsServed: 1 },
      })
    );
    expect(membershipCollection.updateMany).toHaveBeenCalledWith(
      { caucusId, memberType: "character", role: "chair", status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ role: "member" }) })
    );
    expect(membershipCollection.updateOne).toHaveBeenCalledWith(
      { caucusId, memberType: "character", memberId: winnerId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ role: "chair" }) })
    );
  });
});
