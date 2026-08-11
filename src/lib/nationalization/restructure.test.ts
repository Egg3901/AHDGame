import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./nationalCorporation", () => ({
  ensurePrimaryNationalCorporation: vi.fn(),
  buildNationalCorporationDoc: vi.fn((countryId: string, overrides: Record<string, unknown>) => ({
    countryId,
    ...overrides,
  })),
}));

let db: MockDb;

function findCursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
});

describe("splitOffSectorType", () => {
  it("creates a secondary NatCorp and moves all sectors of the type into it", async () => {
    const primaryId = new ObjectId();
    const newId = new ObjectId();

    // No existing claim for the type.
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({ _id: primaryId } as never);
    db.collectionMocks.corporations.insertOne.mockResolvedValue({ insertedId: newId });
    // Country NatCorp set = primary only (before the new corp).
    db.collectionMocks.corporations.find.mockReturnValue(
      findCursor([{ _id: primaryId }, { _id: newId }])
    );
    db.collectionMocks.corporateSectors.updateMany.mockResolvedValue({ modifiedCount: 3 });

    const { splitOffSectorType } = await import("./restructure");
    const result = await splitOffSectorType(db as unknown as Db, {
      countryId: "CN",
      sectorType: "energy",
      newCorpName: "China Energy Corporation",
    });

    expect(result.newNationalCorporationId).toEqual(newId);
    expect(result.sectorsMoved).toBe(3);

    const insertedDoc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(insertedDoc.name).toBe("China Energy Corporation");
    expect(insertedDoc.isPrimaryNationalCorporation).toBe(false);
    expect(insertedDoc.assignedSectorTypes).toEqual(["energy"]);

    // Sectors moved from the OTHER natcorps (not the new one) and filtered by type.
    const move = db.collectionMocks.corporateSectors.updateMany.mock.calls[0];
    expect(move[0].sectorType).toBe("energy");
    expect(move[0].corporationId.$in.map(String)).toEqual([primaryId.toString()]);
    expect(move[1].$set.corporationId).toEqual(newId);
  });

  it("supports the empty pre-claim case (no sectors yet)", async () => {
    const primaryId = new ObjectId();
    const newId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({ _id: primaryId } as never);
    db.collectionMocks.corporations.insertOne.mockResolvedValue({ insertedId: newId });
    db.collectionMocks.corporations.find.mockReturnValue(
      findCursor([{ _id: primaryId }, { _id: newId }])
    );
    db.collectionMocks.corporateSectors.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const { splitOffSectorType } = await import("./restructure");
    const result = await splitOffSectorType(db as unknown as Db, {
      countryId: "CN",
      sectorType: "defense",
      newCorpName: "Norinco State Arms",
    });
    expect(result.sectorsMoved).toBe(0);
    expect(result.newNationalCorporationId).toEqual(newId);
  });

  it("rejects a duplicate claim for the same sector type", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({ _id: new ObjectId() });
    const { splitOffSectorType } = await import("./restructure");
    await expect(
      splitOffSectorType(db as unknown as Db, {
        countryId: "CN",
        sectorType: "energy",
        newCorpName: "Dupe",
      })
    ).rejects.toThrow(/already owns/);
    expect(db.collectionMocks.corporations.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a too-short name", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { splitOffSectorType } = await import("./restructure");
    await expect(
      splitOffSectorType(db as unknown as Db, {
        countryId: "CN",
        sectorType: "energy",
        newCorpName: " x ",
      })
    ).rejects.toThrow(/too short/);
  });
});

describe("mergeBackSectorType", () => {
  it("moves the split-off's sectors into the primary and dissolves the shell", async () => {
    const primaryId = new ObjectId();
    const splitId = new ObjectId();
    // 1st findOne → the split-off owning the type.
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: splitId,
      countryOwnerId: "CN",
      assignedSectorTypes: ["energy"],
      isPrimaryNationalCorporation: false,
    });
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({
      _id: primaryId,
      isPrimaryNationalCorporation: true,
    } as never);
    db.collectionMocks.corporateSectors.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const { mergeBackSectorType } = await import("./restructure");
    const result = await mergeBackSectorType(db as unknown as Db, {
      countryId: "CN",
      sectorType: "energy",
    });

    expect(result.targetNationalCorporationId).toEqual(primaryId);
    expect(result.dissolvedNationalCorporationId).toEqual(splitId);
    expect(result.sectorsMoved).toBe(2);

    const move = db.collectionMocks.corporateSectors.updateMany.mock.calls[0];
    expect(move[0]).toEqual({ corporationId: splitId });
    expect(move[1].$set.corporationId).toEqual(primaryId);

    // Primary keeps empty assignedSectorTypes (remainder) — no $addToSet on it.
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: splitId });
  });

  it("rejects when no split-off owns the type", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { mergeBackSectorType } = await import("./restructure");
    await expect(
      mergeBackSectorType(db as unknown as Db, { countryId: "CN", sectorType: "energy" })
    ).rejects.toThrow(/No split-off/);
    expect(db.collectionMocks.corporations.deleteOne).not.toHaveBeenCalled();
  });
});
