import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { withdrawInactiveCandidates } from "./withdrawInactiveCandidates";

const TURN_MS = 60 * 60 * 1000;
const NOW = new Date("2026-06-23T00:00:00.000Z");
const ago = (turns: number) => new Date(NOW.getTime() - turns * TURN_MS);

function projectCursor<T>(docs: T[]) {
  return { project: () => ({ toArray: async () => docs }) };
}

describe("withdrawInactiveCandidates", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates");
    db.collection("characters");
    db.collection("users");
  });

  it("withdraws an inactive player's active candidacy", async () => {
    const candidateId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    db.collectionMocks.electionCandidates.find.mockReturnValue(
      projectCursor([{ _id: candidateId, characterId }])
    );
    db.collectionMocks.characters.find.mockReturnValue(
      projectCursor([{ _id: characterId, userId }])
    );
    db.collectionMocks.users.find.mockReturnValue(
      projectCursor([{ _id: userId, lastActivity: ago(200) }])
    );
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await withdrawInactiveCandidates(db as unknown as Db, NOW);

    expect(result).toEqual({ withdrawn: 1 });
    const [filter, update] = db.collectionMocks.electionCandidates.updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: [candidateId] } });
    expect(update).toEqual({ $set: { status: "withdrawn", withdrawnAt: NOW } });
  });

  it("leaves active players untouched", async () => {
    const candidateId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    db.collectionMocks.electionCandidates.find.mockReturnValue(
      projectCursor([{ _id: candidateId, characterId }])
    );
    db.collectionMocks.characters.find.mockReturnValue(
      projectCursor([{ _id: characterId, userId }])
    );
    db.collectionMocks.users.find.mockReturnValue(
      projectCursor([{ _id: userId, lastActivity: ago(2) }])
    );

    const result = await withdrawInactiveCandidates(db as unknown as Db, NOW);

    expect(result).toEqual({ withdrawn: 0 });
    expect(db.collectionMocks.electionCandidates.updateMany).not.toHaveBeenCalled();
  });

  it("queries only active, non-NPP candidacies (NPP and already-withdrawn excluded at the DB)", async () => {
    db.collectionMocks.electionCandidates.find.mockReturnValue(projectCursor([]));

    await withdrawInactiveCandidates(db as unknown as Db, NOW);

    const [filter] = db.collectionMocks.electionCandidates.find.mock.calls[0];
    expect(filter).toEqual({
      status: "active",
      isNPP: { $ne: true },
    });
  });
});
