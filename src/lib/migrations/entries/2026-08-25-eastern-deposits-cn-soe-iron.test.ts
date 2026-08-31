import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-25-eastern-deposits-cn-soe-iron";

vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("clearing"),
  marketAtLeast: vi.fn().mockReturnValue(false),
}));

function cursor<T>(docs: T[]) {
  return { toArray: async () => docs };
}

let db: MockDb;
const cnSectorId = new ObjectId();

beforeEach(() => {
  db = createMockDb();
  db.collection("gameState");
  db.collection("stateResourceCapacity");
  db.collection("corporateSectors");
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    preset: "1953-default",
    currentTurn: 400,
  });
  db.collectionMocks.stateResourceCapacity!.find.mockReturnValue(
    cursor([
      { stateId: "UKR_DON", countryId: "UKR", resources: {} },
      // Non-empty: a prospected state that must never be clobbered.
      { stateId: "PL_SLK", countryId: "PL", resources: { coal: 123 } },
    ])
  );
  db.collectionMocks.stateResourceCapacity!.bulkWrite.mockResolvedValue({
    modifiedCount: 1,
    upsertedCount: 0,
  });
  db.collectionMocks.corporateSectors!.find.mockReturnValue(
    cursor([
      {
        _id: cnSectorId,
        countryId: "CN",
        stateId: "DB",
        sectorType: "extraction",
        strategyId: "coal_mining",
        revenue: 1000,
      },
    ])
  );
  db.collectionMocks.corporateSectors!.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe(migration.id, () => {
  it("dry run reads but never writes", async () => {
    await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.stateResourceCapacity!.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors!.updateOne).not.toHaveBeenCalled();
  });

  it("backfills only empty docs and retools CN sectors through the transition machinery", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.stateResourceCapacity!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { stateId: string }; update: { $set: { resources: object } } };
    }>;
    const filledStates = ops.map((op) => op.updateOne.filter.stateId);
    // The empty doc gets filled; the prospected one is skipped even though it
    // is in the backfill list; states with no stored doc at all are upserted.
    expect(filledStates).toContain("UKR_DON");
    expect(filledStates).not.toContain("PL_SLK");
    const donbass = ops.find((op) => op.updateOne.filter.stateId === "UKR_DON")!;
    // Post-headroom (coal x2): the same value a fresh 1953 seed writes.
    expect((donbass.updateOne.update.$set.resources as Record<string, number>).coal).toBe(540000);

    expect(db.collectionMocks.corporateSectors!.updateOne).toHaveBeenCalledWith(
      { _id: cnSectorId },
      {
        $set: expect.objectContaining({
          strategyId: "iron_mining",
          transitionFromStrategyId: "coal_mining",
          transitionStartTurn: 400,
        }),
      }
    );
    expect(result.documentsUpdated).toBeGreaterThanOrEqual(2);
  });
});
