import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCorporationHeldSharesToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does nothing when the corporation holds no outside shares", async () => {
    const holderCorpId = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({
      sharesReleased: 0,
      corpsShareholderCleared: 0,
    });
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("releases every corporation-held shareholder entry to issuer publicFloat", async () => {
    const holderCorpId = new ObjectId();
    const issuerA = new ObjectId();
    const issuerB = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuerA,
          shareholders: [{ corporationId: holderCorpId, shares: 1500 }],
        },
        {
          _id: issuerB,
          shareholders: [
            { corporationId: new ObjectId(), shares: 250 },
            { corporationId: holderCorpId, shares: 3250 },
          ],
        },
      ]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({
      sharesReleased: 4750,
      corpsShareholderCleared: 2,
    });
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: issuerA,
        shareholders: {
          $elemMatch: { corporationId: holderCorpId, shares: 1500 },
        },
      },
      {
        $pull: { shareholders: { corporationId: holderCorpId } },
        $inc: { publicFloat: 1500 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      2,
      {
        _id: issuerB,
        shareholders: {
          $elemMatch: { corporationId: holderCorpId, shares: 3250 },
        },
      },
      {
        $pull: { shareholders: { corporationId: holderCorpId } },
        $inc: { publicFloat: 3250 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it("skips counters when the holding changed before the CAS update", async () => {
    const holderCorpId = new ObjectId();
    const issuerA = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuerA,
          shareholders: [{ corporationId: holderCorpId, shares: 999 }],
        },
      ]),
    });
    db.collection("corporations").updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({
      sharesReleased: 0,
      corpsShareholderCleared: 0,
    });
  });
});
