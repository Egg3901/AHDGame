import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stubElectionCandidates } from "@/lib/test-utils/stubElectionCandidates";

vi.mock("@/lib/players/playerActivity", () => ({
  activeUserIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

const NOW = new Date("2026-09-15T12:00:00Z");

/**
 * An inactivity withdrawal takes the player out of the race, so their campaign
 * must leave Campaign Operations with them — same as a manual withdrawal.
 */
describe("withdrawInactiveCandidates — campaign archival", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const electionId = new ObjectId();
  const candidacyId = new ObjectId();
  const userId = new ObjectId();

  function stubFind(collection: string, docs: unknown[]) {
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      toArray: async () => docs,
    };
    db.collectionMocks[collection]!.find.mockReturnValue(cursor as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates");
    db.collection("characters");
    db.collection("campaigns");
    db.collectionMocks.campaigns!.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  it("archives the campaign of a candidate withdrawn for inactivity", async () => {
    stubElectionCandidates(db, [{ _id: candidacyId, characterId, electionId, status: "active" }]);
    stubFind("characters", [{ _id: characterId, userId }]);

    const { withdrawInactiveCandidates } = await import("./withdrawInactiveCandidates");
    const result = await withdrawInactiveCandidates(db as unknown as Db, NOW);

    expect(result.withdrawn).toBe(1);
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalled();
    const [filter, update] = db.collectionMocks.campaigns!.updateMany.mock.calls[0];
    expect(filter.electionId).toEqual(electionId);
    expect(filter.candidateId.$in.map(String)).toContain(characterId.toString());
    expect(update.$set.status).toBe("archived");
    expect(update.$set.archivedReason).toBe("withdrawn");
  });
});
