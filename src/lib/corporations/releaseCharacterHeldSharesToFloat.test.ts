import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCharacterHeldSharesToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does nothing when the character holds no outside shares", async () => {
    const characterId = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({
      sharesReleased: 0,
      positionsReleased: 0,
    });
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("releases direct shareholder entries to public float", async () => {
    const characterId = new ObjectId();
    const issuerA = new ObjectId();
    const issuerB = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuerA,
          shareholders: [{ characterId, shares: 1500 }],
        },
        {
          _id: issuerB,
          shareholders: [
            { characterId: new ObjectId(), shares: 250 },
            { characterId, shares: 3250 },
          ],
        },
      ]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({
      sharesReleased: 4750,
      positionsReleased: 2,
    });
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: issuerA,
        shareholders: {
          $elemMatch: { characterId, shares: 1500 },
        },
      },
      {
        $pull: { shareholders: { characterId } },
        $inc: { publicFloat: 1500 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });
});

describe("releaseCharacterHeldSharesToFloat excludeCorporationIds", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("excludes the given corps from the find query", async () => {
    const charId = new ObjectId();
    const exemptCorp = new ObjectId();
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    db.collection("corporations").find = findSpy;

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    await releaseCharacterHeldSharesToFloat(db as unknown as Db, [charId], new Date(), {
      excludeCorporationIds: [exemptCorp],
    });

    expect(findSpy).toHaveBeenCalledWith(
      {
        "shareholders.characterId": { $in: [charId] },
        _id: { $nin: [exemptCorp] },
      },
      { projection: { _id: 1, shareholders: 1 } }
    );
  });

  it("skips a corp that is in the exclude set even if returned by the query", async () => {
    const charId = new ObjectId();
    const exemptCorp = new ObjectId();
    const swept = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: exemptCorp, shareholders: [{ characterId: charId, shares: 500 }] },
        { _id: swept, shareholders: [{ characterId: charId, shares: 700 }] },
      ]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(
      db as unknown as Db,
      [charId],
      new Date(),
      { excludeCorporationIds: [exemptCorp] }
    );

    expect(result).toEqual({ sharesReleased: 700, positionsReleased: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(1);
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: swept, shareholders: { $elemMatch: { characterId: charId, shares: 700 } } },
      {
        $pull: { shareholders: { characterId: charId } },
        $inc: { publicFloat: 700 },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it("behaves exactly as before when no exclude option is passed", async () => {
    const charId = new ObjectId();
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    db.collection("corporations").find = findSpy;

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    await releaseCharacterHeldSharesToFloat(db as unknown as Db, [charId]);

    expect(findSpy).toHaveBeenCalledWith(
      { "shareholders.characterId": { $in: [charId] } },
      { projection: { _id: 1, shareholders: 1 } }
    );
  });
});
