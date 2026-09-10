import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCharacterHeldSharesToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Deliberate: every write assertion below states its ack explicitly. The
    // shared mock factory leaves `acknowledged` unset, and an unset ack must
    // fail closed, so success-path tests pin `acknowledged: true` here.
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    });
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

  it("releases direct shareholder entries to public float with one conserving write per issuer", async () => {
    const characterId = new ObjectId();
    const issuerA = new ObjectId();
    const issuerB = new ObjectId();
    const unrelated = new ObjectId();
    const holdersA = [{ characterId, shares: 1500 }];
    const holdersB = [
      { characterId: unrelated, shares: 250 },
      { characterId, shares: 3250 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: issuerA, shareholders: holdersA, publicFloat: 100 },
        { _id: issuerB, shareholders: holdersB, publicFloat: 200 },
      ]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({
      sharesReleased: 4750,
      positionsReleased: 2,
    });
    // One write per issuer: full-snapshot CAS plus the summed credit.
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: issuerA, shareholders: holdersA, publicFloat: 100 },
      {
        $set: { shareholders: [], publicFloat: 1600, updatedAt: expect.any(Date) },
      }
    );
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: issuerB, shareholders: holdersB, publicFloat: 200 },
      {
        // Unrelated holder rows survive in place; only the float moves.
        $set: {
          shareholders: [{ characterId: unrelated, shares: 250 }],
          publicFloat: 3450,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("sums every duplicate row for one holder instead of crediting a single entry", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const other = new ObjectId();
    const holders = [
      { characterId, shares: 100 },
      { characterId, shares: 250 },
      { characterId: other, shares: 50 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 1000 }]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    // Old code $pull-ed all three matching rows while $inc-ing one entry (100),
    // destroying 250 shares. Now the single write credits 100 + 250 = 350.
    expect(result).toEqual({ sharesReleased: 350, positionsReleased: 2 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(1);
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: issuer, shareholders: holders, publicFloat: 1000 },
      {
        $set: {
          shareholders: [{ characterId: other, shares: 50 }],
          publicFloat: 1350,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("does not overcount duplicate caller ids", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ characterId, shares: 700 }];

    const findSpy = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    db.collection("corporations").find = findSpy;

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [
      characterId,
      characterId,
    ]);

    expect(findSpy).toHaveBeenCalledWith(
      { "shareholders.characterId": { $in: [characterId] } },
      { projection: { _id: 1, shareholders: 1, publicFloat: 1 } }
    );
    expect(result).toEqual({ sharesReleased: 700, positionsReleased: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(1);
  });

  it("ignores rows keyed only by another holder kind", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const corpHolder = new ObjectId();
    const holders = [
      { corporationId: corpHolder, shares: 900 },
      { characterId, shares: 100 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 10 }]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ sharesReleased: 100, positionsReleased: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: issuer, shareholders: holders, publicFloat: 10 },
      {
        $set: {
          shareholders: [{ corporationId: corpHolder, shares: 900 }],
          publicFloat: 110,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("retries from a fresh exact read when a competing mutation wins the race", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const staleHolders = [{ characterId, shares: 999 }];
    // A trade lands between the snapshot and the CAS: the holder now owns 1200.
    const freshHolders = [{ characterId, shares: 1200 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: issuer, shareholders: staleHolders, publicFloat: 0 }]),
    });
    db.collection("corporations")
      .updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    db.collection("corporations").findOne.mockResolvedValue({
      _id: issuer,
      shareholders: freshHolders,
      publicFloat: 0,
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    // The stale 999 is never credited; the fresh 1200 is.
    expect(result).toEqual({ sharesReleased: 1200, positionsReleased: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: issuer, shareholders: freshHolders, publicFloat: 0 },
      { $set: { shareholders: [], publicFloat: 1200, updatedAt: expect.any(Date) } }
    );
  });

  it("throws instead of reporting success when conflicts exhaust the retry budget", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ characterId, shares: 400 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collection("corporations").findOne.mockResolvedValue({
      _id: issuer,
      shareholders: holders,
      publicFloat: 0,
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    await expect(
      releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId])
    ).rejects.toThrow(/conflict exhausted/);
  });

  it("fails closed on malformed affected rows instead of burning them", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();

    for (const badShares of [-50, Number.POSITIVE_INFINITY, Number.NaN]) {
      db.collection("corporations").find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { _id: issuer, shareholders: [{ characterId, shares: badShares }], publicFloat: 0 },
          ]),
      });
      db.collection("corporations").updateOne.mockClear();

      const { releaseCharacterHeldSharesToFloat } =
        await import("./releaseCharacterHeldSharesToFloat");
      await expect(
        releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId])
      ).rejects.toThrow(/Refusing share release/);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    }
  });

  it("ignores malformed rows that belong to other holders", async () => {
    const characterId = new ObjectId();
    const other = new ObjectId();
    const issuer = new ObjectId();
    const holders = [
      { characterId: other, shares: -25 },
      { characterId, shares: 300 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 5 }]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ sharesReleased: 300, positionsReleased: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: issuer, shareholders: holders, publicFloat: 5 },
      {
        $set: {
          shareholders: [{ characterId: other, shares: -25 }],
          publicFloat: 305,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("leaves zero-share-only issuers untouched without a write", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: issuer, shareholders: [{ characterId, shares: 0 }], publicFloat: 42 },
        ]),
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    const result = await releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId]);

    expect(result).toEqual({ sharesReleased: 0, positionsReleased: 0 });
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("throws on an ambiguous unacknowledged write without counting shares", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ characterId, shares: 600 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: false,
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    await expect(
      releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId])
    ).rejects.toThrow(/outcome unknown/);
  });

  it("treats a missing acknowledged flag as an ambiguous write", async () => {
    const characterId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ characterId, shares: 600 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    // No `acknowledged` field at all: the write may or may not have committed.
    db.collection("corporations").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { releaseCharacterHeldSharesToFloat } =
      await import("./releaseCharacterHeldSharesToFloat");
    await expect(
      releaseCharacterHeldSharesToFloat(db as unknown as Db, [characterId])
    ).rejects.toThrow(/outcome unknown/);
  });
});

describe("releaseCharacterHeldSharesToFloat excludeCorporationIds", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Same deliberate ack default as the main suite: unset ack fails closed.
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    });
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
      { projection: { _id: 1, shareholders: 1, publicFloat: 1 } }
    );
  });

  it("skips a corp that is in the exclude set even if returned by the query", async () => {
    const charId = new ObjectId();
    const exemptCorp = new ObjectId();
    const swept = new ObjectId();
    const sweptHolders = [{ characterId: charId, shares: 700 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: exemptCorp, shareholders: [{ characterId: charId, shares: 500 }], publicFloat: 0 },
        { _id: swept, shareholders: sweptHolders, publicFloat: 0 },
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
      { _id: swept, shareholders: sweptHolders, publicFloat: 0 },
      {
        $set: { shareholders: [], publicFloat: 700, updatedAt: expect.any(Date) },
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
      { projection: { _id: 1, shareholders: 1, publicFloat: 1 } }
    );
  });
});
