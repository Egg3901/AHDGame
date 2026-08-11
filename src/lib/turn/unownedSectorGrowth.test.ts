import { describe, it, expect, vi, beforeEach } from "vitest";
import { processUnownedSectorGrowth } from "./unownedSectorGrowth";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("processUnownedSectorGrowth", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  function makeUnowned(stateId: string, sectorType: string, revenue: number): UnownedSector {
    return {
      _id: new ObjectId(),
      stateId,
      countryId: "US",
      sectorType: sectorType as UnownedSector["sectorType"],
      revenue,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function makeSector(stateId: string, sectorType: string, growthRate: number): CorporateSector {
    return {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      stateId,
      sectorType: sectorType as CorporateSector["sectorType"],
      targetGrowthRate: growthRate,
      currentGrowthRate: growthRate,
      revenue: 1_000_000,
      profitMargin: 35,
      workers: 500,
      currentGrowthCost: 0,
      countryId: "US",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("grows unowned revenue by the avg growthRate of same state+type sectors", async () => {
    setupCollection("unownedSectors", [makeUnowned("GA", "technology", 100_000)]);
    setupCollection("corporateSectors", [
      makeSector("GA", "technology", 2),
      makeSector("GA", "technology", 4),
    ]);

    db.collection("unownedSectors");
    const bulkWriteMock = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["unownedSectors"]!.bulkWrite = bulkWriteMock;

    await processUnownedSectorGrowth(db as unknown as Db);

    expect(bulkWriteMock).toHaveBeenCalledOnce();
    const ops = bulkWriteMock.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    // avg daily growth = (2+4)/2 = 3%; per-turn = 3/48
    // unowned grows at half the avg: 3% * 0.5 = 1.5%; per-turn = 1.5/48
    expect(ops[0].updateOne.update.$set.revenue).toBe(Math.round(100_000 * (1 + 1.5 / 48 / 100)));
  });

  it("uses 1% fallback when no corp sectors exist for state+type", async () => {
    setupCollection("unownedSectors", [makeUnowned("AK", "energy", 200_000)]);
    setupCollection("corporateSectors", []);

    db.collection("unownedSectors");
    const bulkWriteMock = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["unownedSectors"]!.bulkWrite = bulkWriteMock;

    await processUnownedSectorGrowth(db as unknown as Db);

    const ops = bulkWriteMock.mock.calls[0][0];
    // fallback 1% daily; per-turn = 1/48
    expect(ops[0].updateOne.update.$set.revenue).toBe(Math.round(200_000 * (1 + 1 / 48 / 100)));
  });

  it("returns 0 when there are no unowned sectors", async () => {
    setupCollection("unownedSectors", []);
    setupCollection("corporateSectors", []);

    const result = await processUnownedSectorGrowth(db as unknown as Db);
    expect(result).toBe(0);
  });

  it("does not shrink unowned revenue when avg corp growth is negative", async () => {
    // Corps can set growthRate as low as -2 when downsizing. Unowned sectors
    // represent untapped market opportunity and should never contract — the
    // rate must floor at 0 so revenue stays flat in a downsizing market.
    setupCollection("unownedSectors", [makeUnowned("NY", "finance", 500_000)]);
    setupCollection("corporateSectors", [
      makeSector("NY", "finance", -2),
      makeSector("NY", "finance", -1),
    ]);

    db.collection("unownedSectors");
    const bulkWriteMock = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["unownedSectors"]!.bulkWrite = bulkWriteMock;

    await processUnownedSectorGrowth(db as unknown as Db);

    const ops = bulkWriteMock.mock.calls[0][0];
    // avg = -1.5%; clamped to 0%; revenue unchanged
    expect(ops[0].updateOne.update.$set.revenue).toBe(500_000);
  });

  it("does not grow unowned in a bucket a National Corporation controls", async () => {
    // Once a sector is nationalized (state holds the revenue majority), its
    // unowned pool must stop regrowing so the nationalized sector doesn't slowly
    // re-fragment turn over turn.
    const natCorpId = new ObjectId();
    setupCollection("unownedSectors", [makeUnowned("HD", "telecommunications", 100_000)]);
    setupCollection("corporateSectors", [
      {
        ...makeSector("HD", "telecommunications", 4),
        corporationId: natCorpId,
        revenue: 5_000_000,
        nationalizedAtTurn: 331,
      },
    ]);
    setupCollection("corporations", [{ _id: natCorpId, countryOwnerId: "CN" }]);

    db.collection("unownedSectors");
    const bulkWriteMock = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["unownedSectors"]!.bulkWrite = bulkWriteMock;

    await processUnownedSectorGrowth(db as unknown as Db);

    const ops = bulkWriteMock.mock.calls[0][0];
    // state-controlled bucket ⇒ growth rate 0 ⇒ revenue unchanged.
    expect(ops[0].updateOne.update.$set.revenue).toBe(100_000);
  });

  it("does not mix growth rates across different state+type combos", async () => {
    setupCollection("unownedSectors", [
      makeUnowned("CA", "retail", 50_000),
      makeUnowned("TX", "retail", 50_000),
    ]);
    setupCollection("corporateSectors", [
      makeSector("CA", "retail", 5),
      makeSector("TX", "retail", 1),
    ]);

    db.collection("unownedSectors");
    const bulkWriteMock = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    db.collectionMocks["unownedSectors"]!.bulkWrite = bulkWriteMock;

    await processUnownedSectorGrowth(db as unknown as Db);

    const ops: { updateOne: { update: { $set: { revenue: number } } } }[] =
      bulkWriteMock.mock.calls[0][0];
    const revenues = ops.map((o) => o.updateOne.update.$set.revenue).sort((a, b) => a - b);
    // unowned grows at half the avg: CA 5%*0.5=2.5%, TX 1%*0.5=0.5%
    const caExpected = Math.round(50_000 * (1 + 2.5 / 48 / 100));
    const txExpected = Math.round(50_000 * (1 + 0.5 / 48 / 100));
    expect(revenues).toEqual([txExpected, caExpected]);
  });
});
