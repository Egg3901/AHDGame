import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCharacters: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 1, listingsCancelled: 2, offersCancelled: 3 }),
  cleanupShareMarketActivityForCorporations: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 4, listingsCancelled: 5, offersCancelled: 6 }),
}));

vi.mock("@/lib/corporations/releaseCharacterHeldSharesToFloat", () => ({
  releaseCharacterHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 700, positionsReleased: 2 }),
}));

vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 450, corpsShareholderCleared: 1 }),
}));

vi.mock("@/lib/bonds/executeCorporationBondDefaultDissolution", () => ({
  executeCorporationBondDefaultDissolution: vi.fn().mockResolvedValue({
    bondRecoveryPool: 1000,
    shareholderPool: 0,
    shareholderPayouts: [],
    corporateShareholderPayouts: [],
    publicFloatPayout: null,
    totalPayoutToPeople: 0,
  }),
}));

vi.mock("@/lib/corporations/settlementLock", () => ({
  // Pass-through lock: always "claims" and runs the work.
  withCorporationSettlementLock: vi.fn((_db, _id, _field, _now, run) => run()),
}));

describe("cascadeCharacterDeletion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 42 });
  });

  it("cleans personal and CEO-corporation activity before vacating seats", async () => {
    const charId = new ObjectId();
    const ceoCorpId = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: ceoCorpId }]),
    });
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ modifiedCount: 2 } as never);
    db.collection("electionCandidates").updateMany.mockResolvedValue({ modifiedCount: 3 } as never);

    const { cascadeCharacterDeletion } = await import("./cascadeCharacterDeletion");
    const { cleanupShareMarketActivityForCharacters, cleanupShareMarketActivityForCorporations } =
      await import("@/lib/corporations/cleanupShareMarketActivity");
    const { releaseCharacterHeldSharesToFloat } =
      await import("@/lib/corporations/releaseCharacterHeldSharesToFloat");
    const { releaseCorporationHeldSharesToFloat } =
      await import("@/lib/corporations/releaseHeldSharesToFloat");

    const result = await cascadeCharacterDeletion(db as unknown as Db, charId);

    expect(cleanupShareMarketActivityForCharacters).toHaveBeenCalledWith(
      db,
      [charId],
      expect.any(Date),
      true
    );
    expect(cleanupShareMarketActivityForCorporations).toHaveBeenCalledWith(
      db,
      [ceoCorpId],
      expect.any(Date),
      true
    );
    expect(releaseCharacterHeldSharesToFloat).toHaveBeenCalledWith(db, [charId], expect.any(Date));
    expect(releaseCorporationHeldSharesToFloat).toHaveBeenCalledWith(
      db,
      ceoCorpId,
      expect.any(Date)
    );
    expect(result).toEqual({
      sharesReleased: 700,
      corpsShareholderCleared: 2,
      corporationSharesReleased: 450,
      corporationSharePositionsCleared: 1,
      corpsCeoVacated: 1,
      corpsPendingCeoCleared: 2,
      corpsDissolvedOnAbandonment: 0,
      ordersCancelled: 5,
      listingsCancelled: 7,
      offersCancelled: 9,
      activeCandidaciesWithdrawn: 3,
    });
  });

  it("force-dissolves an abandoned CEO corp that still owes bondholders", async () => {
    const charId = new ObjectId();
    const bondedCorpId = new ObjectId();
    const cleanCorpId = new ObjectId();

    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: bondedCorpId }, { _id: cleanCorpId }]),
    });
    // Only the bonded corp has an outstanding (non-matured) bond.
    db.collection("bonds").distinct.mockResolvedValue([bondedCorpId]);
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ modifiedCount: 0 } as never);
    db.collection("electionCandidates").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { cascadeCharacterDeletion } = await import("./cascadeCharacterDeletion");
    const { executeCorporationBondDefaultDissolution } =
      await import("@/lib/bonds/executeCorporationBondDefaultDissolution");
    const { releaseCorporationHeldSharesToFloat } =
      await import("@/lib/corporations/releaseHeldSharesToFloat");

    const result = await cascadeCharacterDeletion(db as unknown as Db, charId);

    // The bonded corp runs the dissolution waterfall...
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledTimes(1);
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledWith(
      db,
      { _id: bondedCorpId },
      { requireDefaultedBonds: false }
    );
    // ...and is NOT dumped to public float; only the clean corp releases shares.
    expect(releaseCorporationHeldSharesToFloat).toHaveBeenCalledTimes(1);
    expect(releaseCorporationHeldSharesToFloat).toHaveBeenCalledWith(
      db,
      cleanCorpId,
      expect.any(Date)
    );
    expect(result.corpsDissolvedOnAbandonment).toBe(1);
  });

  it("withdraws the deleted character's still-active election candidacies", async () => {
    const charId = new ObjectId();
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 0 } as never)
      .mockResolvedValueOnce({ modifiedCount: 0 } as never);
    db.collection("electionCandidates").updateMany.mockResolvedValue({ modifiedCount: 2 } as never);

    const { cascadeCharacterDeletion } = await import("./cascadeCharacterDeletion");
    const result = await cascadeCharacterDeletion(db as unknown as Db, charId);

    expect(db.collection("electionCandidates").updateMany).toHaveBeenCalledWith(
      { characterId: charId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "withdrawn" }) })
    );
    expect(result.activeCandidaciesWithdrawn).toBe(2);
  });

  it("defaults ceoVacantSinceTurn to 0 when gameState is missing", async () => {
    const charId = new ObjectId();
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("gameState").findOne.mockResolvedValue(null);
    db.collection("corporations")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ modifiedCount: 0 } as never);

    const { cascadeCharacterDeletion } = await import("./cascadeCharacterDeletion");
    await cascadeCharacterDeletion(db as unknown as Db, charId);

    expect(db.collection("corporations").updateMany).toHaveBeenNthCalledWith(
      1,
      { ceoId: charId, ceoVacant: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({ ceoVacantSinceTurn: 0 }),
      })
    );
  });
});
