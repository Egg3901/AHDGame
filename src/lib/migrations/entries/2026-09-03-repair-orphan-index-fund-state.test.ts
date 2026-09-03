import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-03-repair-orphan-index-fund-state";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("indexFunds").bulkWrite.mockResolvedValue({ modifiedCount: 1 });
});

describe("repair orphan index-fund state", () => {
  it("drops dead-corporation rows and reconciles supply to live positions", async () => {
    const fundId = new ObjectId();
    const liveCorpId = new ObjectId();
    const deadCorpId = new ObjectId();
    const characterId = new ObjectId();
    const reservePositionId = new ObjectId();

    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(
      createAsyncIterableCursor([{ _id: liveCorpId }])
    );
    db.collectionMocks.indexFunds = db.collection("indexFunds");
    db.collectionMocks.indexFunds.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: fundId,
          reserveUnits: 500_000,
          unitSupply: 999_999,
          holdings: [
            { corporationId: liveCorpId, shares: 10, lastValueAnchor: 100 },
            { corporationId: deadCorpId, shares: 20, lastValueAnchor: 400 },
          ],
          targetConstituents: [
            { corporationId: liveCorpId, targetWeight: 0.75, marketCapAnchor: 750 },
            { corporationId: deadCorpId, targetWeight: 0.25, marketCapAnchor: 250 },
          ],
          listingFailureStreaks: [
            { corporationId: liveCorpId, consecutiveFailures: 1, failures: [] },
            { corporationId: deadCorpId, consecutiveFailures: 2, failures: [] },
          ],
        },
      ])
    );
    db.collectionMocks.indexFundPositions = db.collection("indexFundPositions");
    db.collectionMocks.indexFundPositions.find.mockReturnValue(
      createAsyncIterableCursor([
        { _id: reservePositionId, fundId, holderKind: "fund_reserve", units: 500_000 },
        { _id: new ObjectId(), fundId, holderKind: "character", characterId, units: 250 },
      ])
    );

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.indexFunds.bulkWrite).toHaveBeenCalledOnce();
    const [ops] = db.collectionMocks.indexFunds.bulkWrite.mock.calls[0]!;
    expect(ops).toEqual([
      {
        updateOne: {
          filter: { _id: fundId },
          update: {
            $inc: { unitSupply: -499_749 },
            $pull: {
              holdings: { corporationId: { $in: [deadCorpId] } },
              targetConstituents: { corporationId: { $in: [deadCorpId] } },
              listingFailureStreaks: { corporationId: { $in: [deadCorpId] } },
            },
            $set: { updatedAt: expect.any(Date) },
          },
        },
      },
    ]);
    expect(db.collectionMocks.indexFundPositions.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(1);
    expect(result.notes?.join(" ")).toContain("1 orphan holding");
    expect(result.notes?.join(" ")).toContain("400");
  });

  it("recreates a missing seeded reserve position before reconciling supply", async () => {
    const fundId = new ObjectId();
    db.collection("corporations").find.mockReturnValue(createAsyncIterableCursor([]));
    db.collection("indexFunds").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: fundId,
          reserveUnits: 500_000,
          unitSupply: 777_000,
          holdings: [],
          targetConstituents: [],
        },
      ])
    );
    db.collection("indexFundPositions").find.mockReturnValue(
      createAsyncIterableCursor([
        { _id: new ObjectId(), fundId, holderKind: "character", units: 123 },
      ])
    );

    await migration.execute(db as unknown as Db, { dryRun: false });

    const [positionOps] = db.collectionMocks.indexFundPositions.bulkWrite.mock.calls[0]!;
    expect(positionOps).toEqual([
      {
        updateOne: {
          filter: { fundId, holderKind: "fund_reserve" },
          update: {
            $setOnInsert: expect.objectContaining({
              fundId,
              holderKind: "fund_reserve",
              units: 500_000,
            }),
          },
          upsert: true,
        },
      },
    ]);
    const [fundOps] = db.collectionMocks.indexFunds.bulkWrite.mock.calls[0]!;
    expect(fundOps[0].updateOne.update.$inc.unitSupply).toBe(-276_877);
  });

  it("reports without writing during dry run", async () => {
    const fundId = new ObjectId();
    const deadCorpId = new ObjectId();
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([{ _id: new ObjectId() }])
    );
    db.collection("indexFunds").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: fundId,
          reserveUnits: 0,
          unitSupply: 50,
          holdings: [{ corporationId: deadCorpId, shares: 2, lastValueAnchor: 12 }],
          targetConstituents: [],
        },
      ])
    );
    db.collection("indexFundPositions").find.mockReturnValue(createAsyncIterableCursor([]));

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(db.collectionMocks.indexFunds.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFundPositions.bulkWrite).not.toHaveBeenCalled();
    expect(result.notes?.join(" ")).toContain("would repair 1 fund");
  });

  it("refuses to write off every holding when the corporations collection is empty", async () => {
    db.collection("corporations").find.mockReturnValue(createAsyncIterableCursor([]));
    db.collection("indexFunds").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: new ObjectId(),
          reserveUnits: 500_000,
          unitSupply: 500_000,
          holdings: [{ corporationId: new ObjectId(), shares: 2, lastValueAnchor: 12 }],
          targetConstituents: [],
        },
      ])
    );

    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "corporations is empty"
    );
    expect(db.collectionMocks.indexFunds.bulkWrite).not.toHaveBeenCalled();
  });
});
