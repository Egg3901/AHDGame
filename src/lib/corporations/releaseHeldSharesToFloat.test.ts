import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("releaseCorporationHeldSharesToFloat", () => {
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
    const unrelatedCorp = new ObjectId();
    const holdersA = [{ corporationId: holderCorpId, shares: 1500 }];
    const holdersB = [
      { corporationId: unrelatedCorp, shares: 250 },
      { corporationId: holderCorpId, shares: 3250 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: issuerA, shareholders: holdersA, publicFloat: 100 },
        { _id: issuerB, shareholders: holdersB, publicFloat: 200 },
      ]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({
      sharesReleased: 4750,
      corpsShareholderCleared: 2,
    });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: issuerA, shareholders: holdersA, publicFloat: 100 },
      { $set: { shareholders: [], publicFloat: 1600, updatedAt: expect.any(Date) } }
    );
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: issuerB, shareholders: holdersB, publicFloat: 200 },
      {
        $set: {
          shareholders: [{ corporationId: unrelatedCorp, shares: 250 }],
          publicFloat: 3450,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("sums every duplicate row for the holder instead of crediting the first entry", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const other = new ObjectId();
    const holders = [
      { corporationId: holderCorpId, shares: 400 },
      { corporationId: holderCorpId, shares: 600 },
      { corporationId: other, shares: 75 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 2000 }]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    // Old code read only the first entry (400) while $pull-ing both holder
    // rows, destroying 600 shares. Now one write credits 400 + 600 = 1000 and
    // still counts a single cleared issuer.
    expect(result).toEqual({ sharesReleased: 1000, corpsShareholderCleared: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(1);
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: issuer, shareholders: holders, publicFloat: 2000 },
      {
        $set: {
          shareholders: [{ corporationId: other, shares: 75 }],
          publicFloat: 3000,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("ignores rows keyed only by another holder kind", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const characterId = new ObjectId();
    const holders = [
      { characterId, shares: 800 },
      { corporationId: holderCorpId, shares: 200 },
    ];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ sharesReleased: 200, corpsShareholderCleared: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledWith(
      { _id: issuer, shareholders: holders, publicFloat: 0 },
      {
        $set: {
          shareholders: [{ characterId, shares: 800 }],
          publicFloat: 200,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("retries from a fresh exact read when a competing mutation wins the race", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const staleHolders = [{ corporationId: holderCorpId, shares: 999 }];
    // A trade lands between the snapshot and the CAS: the holder now owns 1100.
    const freshHolders = [{ corporationId: holderCorpId, shares: 1100 }];

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

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    // The stale 999 is never credited; the fresh 1100 is.
    expect(result).toEqual({ sharesReleased: 1100, corpsShareholderCleared: 1 });
    expect(db.collection("corporations").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("corporations").updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: issuer, shareholders: freshHolders, publicFloat: 0 },
      { $set: { shareholders: [], publicFloat: 1100, updatedAt: expect.any(Date) } }
    );
  });

  it("throws instead of reporting success when conflicts exhaust the retry budget", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ corporationId: holderCorpId, shares: 400 }];

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

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/conflict exhausted/);
  });

  it("fails closed on malformed affected rows instead of burning them", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();

    for (const badShares of [-10, Number.POSITIVE_INFINITY, Number.NaN]) {
      db.collection("corporations").find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: issuer,
            shareholders: [{ corporationId: holderCorpId, shares: badShares }],
            publicFloat: 0,
          },
        ]),
      });
      db.collection("corporations").updateOne.mockClear();

      const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
      await expect(
        releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
      ).rejects.toThrow(/Refusing share release/);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    }
  });

  it("leaves zero-share-only issuers untouched without a write", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuer,
          shareholders: [{ corporationId: holderCorpId, shares: 0 }],
          publicFloat: 17,
        },
      ]),
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    const result = await releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId);

    expect(result).toEqual({ sharesReleased: 0, corpsShareholderCleared: 0 });
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("throws on an ambiguous unacknowledged write without counting shares", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ corporationId: holderCorpId, shares: 500 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: false,
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/outcome unknown/);
  });

  it("skips counters when the holding changed before the CAS update and stays changed", async () => {
    const holderCorpId = new ObjectId();
    const issuerA = new ObjectId();

    // The snapshot row carries 999, but every write attempt misses: the test
    // stands in for a holding that changed before the CAS update. Exhaustion
    // now throws so the caller cannot delete the holder on top of it.
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuerA,
          shareholders: [{ corporationId: holderCorpId, shares: 999 }],
          publicFloat: 0,
        },
      ]),
    });
    db.collection("corporations").updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collection("corporations").findOne.mockResolvedValue({
      _id: issuerA,
      shareholders: [{ corporationId: holderCorpId, shares: 999 }],
      publicFloat: 0,
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/conflict exhausted/);
  });

  it("treats a missing acknowledged flag as an ambiguous write", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const holders = [{ corporationId: holderCorpId, shares: 500 }];

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: issuer, shareholders: holders, publicFloat: 0 }]),
    });
    // No `acknowledged` field at all: the write may or may not have committed.
    db.collection("corporations").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/outcome unknown/);
  });

  it("fails closed on a null stored float without writing", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuer,
          shareholders: [{ corporationId: holderCorpId, shares: 100 }],
          publicFloat: null as unknown as number,
        },
      ]),
    });
    db.collection("corporations").updateOne.mockClear();

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/Refusing share release/);
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("fails closed on an affected row carrying another holder key", async () => {
    const holderCorpId = new ObjectId();
    const issuer = new ObjectId();
    const fundId = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: issuer,
          shareholders: [{ corporationId: holderCorpId, fundId, shares: 100 }],
          publicFloat: 0,
        },
      ]),
    });
    db.collection("corporations").updateOne.mockClear();

    const { releaseCorporationHeldSharesToFloat } = await import("./releaseHeldSharesToFloat");
    await expect(
      releaseCorporationHeldSharesToFloat(db as unknown as Db, holderCorpId)
    ).rejects.toThrow(/multiple holder keys/);
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });
});
