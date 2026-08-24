import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { claimFundRedemptionLock } from "./redemptionLock";

describe("claimFundRedemptionLock", () => {
  it("serializes fallback redemption and releases by token", async () => {
    const db = createMockDb();
    db.collection("indexFunds");
    db.collectionMocks.indexFunds.updateOne.mockResolvedValueOnce({ matchedCount: 1 });

    const release = await claimFundRedemptionLock(
      db as unknown as Db,
      new ObjectId(),
      new Date("2026-08-24T00:00:00Z")
    );
    expect(release).not.toBeNull();
    await release!();

    const releaseFilter = db.collectionMocks.indexFunds.updateOne.mock.calls[1][0];
    expect(releaseFilter["redemptionLock.token"]).toBeInstanceOf(ObjectId);
  });

  it("returns null when another redemption owns the lock", async () => {
    const db = createMockDb();
    db.collection("indexFunds");
    db.collectionMocks.indexFunds.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(claimFundRedemptionLock(db as unknown as Db, new ObjectId())).resolves.toBeNull();
  });
});
