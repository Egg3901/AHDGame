import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { claimPlayerEndorsementLock } from "./playerEndorsementLock";

describe("claimPlayerEndorsementLock", () => {
  it("releases only the token it acquired", async () => {
    const db = createMockDb();
    db.collection("playerEndorsementLocks");
    db.collectionMocks.playerEndorsementLocks.updateOne.mockResolvedValue({
      matchedCount: 0,
      upsertedCount: 1,
    });

    const release = await claimPlayerEndorsementLock(
      db as unknown as Db,
      new ObjectId(),
      new ObjectId()
    );
    expect(release).not.toBeNull();
    await release!();

    const releaseFilter = db.collectionMocks.playerEndorsementLocks.deleteOne.mock.calls[0][0];
    expect(releaseFilter.token).toBeInstanceOf(ObjectId);
  });

  it("reports contention on duplicate-key upsert", async () => {
    const db = createMockDb();
    db.collection("playerEndorsementLocks");
    db.collectionMocks.playerEndorsementLocks.updateOne.mockRejectedValue({ code: 11000 });

    await expect(
      claimPlayerEndorsementLock(db as unknown as Db, new ObjectId(), new ObjectId())
    ).resolves.toBeNull();
  });
});
