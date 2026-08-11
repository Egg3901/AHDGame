import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCharacters: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 1, listingsCancelled: 1, offersCancelled: 1 }),
  cleanupShareMarketActivityForCorporations: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 2, listingsCancelled: 2, offersCancelled: 2 }),
}));

vi.mock("@/lib/corporations/releaseCharacterHeldSharesToFloat", () => ({
  releaseCharacterHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 400, positionsReleased: 1 }),
}));

vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 250, corpsShareholderCleared: 1 }),
}));

describe("processExpiredBannedShareholders", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("skips users whose ban is still inside the grace window", async () => {
    db.collection("users").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processExpiredBannedShareholders } = await import("./processExpiredBannedShareholders");
    const result = await processExpiredBannedShareholders(db as unknown as Db, {
      now: new Date("2026-04-23T12:00:00.000Z"),
      currentTurn: 100,
      forexEnabled: true,
    });

    expect(result).toEqual({
      usersProcessed: 0,
      charactersProcessed: 0,
      sharesReleasedToFloat: 0,
      characterSharePositionsReleased: 0,
      corporationSharePositionsReleased: 0,
      ceoCorpsVacated: 0,
      pendingCeoOffersCleared: 0,
      ordersCancelled: 0,
      listingsCancelled: 0,
      offersCancelled: 0,
    });
  });

  it("releases shares and cancels open activity after the grace window", async () => {
    const userId = new ObjectId();
    const characterId = new ObjectId();
    const ceoCorpId = new ObjectId();

    db.collection("users").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: userId }]),
    });
    db.collection("characters").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: characterId, userId }]),
    });
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: ceoCorpId }]),
    });
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ modifiedCount: 1 } as never);

    const { processExpiredBannedShareholders } = await import("./processExpiredBannedShareholders");
    const result = await processExpiredBannedShareholders(db as unknown as Db, {
      now: new Date("2026-04-23T12:00:00.000Z"),
      currentTurn: 144,
      forexEnabled: true,
    });

    expect(result).toEqual({
      usersProcessed: 1,
      charactersProcessed: 1,
      sharesReleasedToFloat: 650,
      characterSharePositionsReleased: 1,
      corporationSharePositionsReleased: 1,
      ceoCorpsVacated: 1,
      pendingCeoOffersCleared: 1,
      ordersCancelled: 3,
      listingsCancelled: 3,
      offersCancelled: 3,
    });
    expect(db.collection("users").updateOne).toHaveBeenCalledWith(
      { _id: userId, isBanned: true },
      {
        $set: expect.objectContaining({ bannedShareReleaseProcessedAt: expect.any(Date) }),
        $unset: { bannedShareReleaseCorporationIds: "" },
      }
    );
  });

  it("uses snapshotted CEO corp ids even if the seat was vacated during the appeal window", async () => {
    const userId = new ObjectId();
    const characterId = new ObjectId();
    const snapshottedCorpId = new ObjectId();

    db.collection("users").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: userId, bannedShareReleaseCorporationIds: [snapshottedCorpId] },
        ]),
    });
    db.collection("characters").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: characterId, userId }]),
    });
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 0 } as never)
      .mockResolvedValueOnce({ modifiedCount: 0 } as never);

    const { processExpiredBannedShareholders } = await import("./processExpiredBannedShareholders");
    const { cleanupShareMarketActivityForCorporations } =
      await import("@/lib/corporations/cleanupShareMarketActivity");
    const { releaseCorporationHeldSharesToFloat } =
      await import("@/lib/corporations/releaseHeldSharesToFloat");

    await processExpiredBannedShareholders(db as unknown as Db, {
      now: new Date("2026-04-23T12:00:00.000Z"),
      currentTurn: 144,
      forexEnabled: true,
    });

    expect(cleanupShareMarketActivityForCorporations).toHaveBeenCalledWith(
      db,
      [snapshottedCorpId],
      expect.any(Date),
      true
    );
    expect(releaseCorporationHeldSharesToFloat).toHaveBeenCalledWith(
      db,
      snapshottedCorpId,
      expect.any(Date)
    );
  });
});
