import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCorporationHeldBondsToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does nothing when the corporation holds no bonds", async () => {
    const holderCorpId = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { releaseCorporationHeldBondsToFloat } = await import("./releaseHeldBondsToFloat");
    const result = await releaseCorporationHeldBondsToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ unitsReleased: 0, bondsCleared: 0 });
    expect(db.collection("bonds").updateOne).not.toHaveBeenCalled();
  });

  it("returns every held bond's units to the issuer's public float", async () => {
    const holderCorpId = new ObjectId();
    const bondA = new ObjectId();
    const bondB = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondA,
          holders: [{ corporationId: holderCorpId, units: 50000 }],
        },
        {
          _id: bondB,
          holders: [
            { corporationId: new ObjectId(), units: 1000 },
            { corporationId: holderCorpId, units: 250 },
          ],
        },
      ]),
    });

    const { releaseCorporationHeldBondsToFloat } = await import("./releaseHeldBondsToFloat");
    const result = await releaseCorporationHeldBondsToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ unitsReleased: 50250, bondsCleared: 2 });
    expect(db.collection("bonds").updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: bondA,
        holders: { $elemMatch: { corporationId: holderCorpId, units: 50000 } },
      },
      {
        $pull: { holders: { corporationId: holderCorpId } },
        $inc: { publicFloat: 50000 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
    expect(db.collection("bonds").updateOne).toHaveBeenNthCalledWith(
      2,
      {
        _id: bondB,
        holders: { $elemMatch: { corporationId: holderCorpId, units: 250 } },
      },
      {
        $pull: { holders: { corporationId: holderCorpId } },
        $inc: { publicFloat: 250 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it("scrubs a stale zero-unit holder entry without incrementing float", async () => {
    const holderCorpId = new ObjectId();
    const bondA = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondA,
          holders: [{ corporationId: holderCorpId, units: 0 }],
        },
      ]),
    });

    const { releaseCorporationHeldBondsToFloat } = await import("./releaseHeldBondsToFloat");
    const result = await releaseCorporationHeldBondsToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ unitsReleased: 0, bondsCleared: 1 });
    expect(db.collection("bonds").updateOne).toHaveBeenCalledWith(
      {
        _id: bondA,
        holders: { $elemMatch: { corporationId: holderCorpId, units: 0 } },
      },
      {
        $pull: { holders: { corporationId: holderCorpId } },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it("skips counters when the holding changed before the update applied", async () => {
    const holderCorpId = new ObjectId();
    const bondA = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondA,
          holders: [{ corporationId: holderCorpId, units: 999 }],
        },
      ]),
    });
    db.collection("bonds").updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const { releaseCorporationHeldBondsToFloat } = await import("./releaseHeldBondsToFloat");
    const result = await releaseCorporationHeldBondsToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ unitsReleased: 0, bondsCleared: 0 });
  });
});
