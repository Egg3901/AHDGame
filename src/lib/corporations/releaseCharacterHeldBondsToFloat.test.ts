import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCharacterHeldBondsToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does nothing when the character holds no bonds", async () => {
    const characterId = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { releaseCharacterHeldBondsToFloat } = await import("./releaseCharacterHeldBondsToFloat");
    const result = await releaseCharacterHeldBondsToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ unitsReleased: 0, bondsCleared: 0 });
    expect(db.collection("bonds").updateOne).not.toHaveBeenCalled();
  });

  it("returns every held bond's units to the issuer's public float", async () => {
    const characterId = new ObjectId();
    const bondA = new ObjectId();
    const bondB = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondA,
          holders: [{ characterId, units: 50 }],
        },
        {
          _id: bondB,
          holders: [
            { characterId: new ObjectId(), units: 10 },
            { characterId, units: 25 },
          ],
        },
      ]),
    });

    const { releaseCharacterHeldBondsToFloat } = await import("./releaseCharacterHeldBondsToFloat");
    const result = await releaseCharacterHeldBondsToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ unitsReleased: 75, bondsCleared: 2 });
    expect(db.collection("bonds").updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: bondA,
        holders: { $elemMatch: { characterId, units: 50 } },
      },
      {
        $pull: { holders: { characterId } },
        $inc: { publicFloat: 50 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
    expect(db.collection("bonds").updateOne).toHaveBeenNthCalledWith(
      2,
      {
        _id: bondB,
        holders: { $elemMatch: { characterId, units: 25 } },
      },
      {
        $pull: { holders: { characterId } },
        $inc: { publicFloat: 25 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it("ignores other characters' holder entries in the same bond", async () => {
    const characterId = new ObjectId();
    const otherCharacterId = new ObjectId();
    const bondA = new ObjectId();

    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondA,
          holders: [
            { characterId, units: 12 },
            { characterId: otherCharacterId, units: 8 },
          ],
        },
      ]),
    });

    const { releaseCharacterHeldBondsToFloat } = await import("./releaseCharacterHeldBondsToFloat");
    const result = await releaseCharacterHeldBondsToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ unitsReleased: 12, bondsCleared: 1 });
    expect(db.collection("bonds").updateOne).toHaveBeenCalledTimes(1);
  });
});
