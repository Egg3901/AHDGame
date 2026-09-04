import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    countryId: "US",
    stateId: "CA",
    sectorType: "technology",
    targetGrowthRate: 1,
    currentGrowthRate: 1,
    currentGrowthCost: 100,
    revenue: 1000,
    profitMargin: 35,
    workers: 500,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("restoreSectorsToUnowned", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("exchangeRates");
    db.collection("unownedSectors");
    db.collection("states");
    db.collectionMocks.unownedSectors.findOneAndUpdate.mockResolvedValue(null);
  });

  it("normalizes deleted sector revenue to anchor units and deletes sectors after restoring the pool", async () => {
    const corpId = new ObjectId();
    const now = new Date("2026-04-26T23:00:00.000Z");

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "UK", liquidCurrencyCode: "GBP" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "GBP", rate: 2 }],
    });
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 2 });
    db.collectionMocks.unownedSectors.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        stateId: "LON",
        countryId: "UK",
        sectorType: "energy",
        revenue: 100,
        recentCorporateSectorRestores: [
          {
            sectorId: "another-sector",
            restoredAt: new Date("2026-04-26T22:00:00.000Z"),
          },
        ],
        createdAt: now,
        updatedAt: now,
      } satisfies UnownedSector);

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    const result = await restoreSectorsToUnowned(
      db as unknown as Db,
      [
        makeSector({
          corporationId: corpId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "energy",
          revenue: 200,
        }),
        makeSector({
          corporationId: corpId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "energy",
          revenue: 50,
        }),
      ],
      now
    );

    expect(result).toEqual({
      sectorsProcessed: 2,
      sectorsDeleted: 2,
      poolsUpdated: 1,
      totalRevenueRestored: 125,
    });
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      _id: {
        $in: expect.arrayContaining([expect.any(Object), expect.any(Object)]),
      },
    });
  });

  it("skips the unowned write when nothing has positive revenue but still deletes the sectors", async () => {
    const corpId = new ObjectId();

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    const result = await restoreSectorsToUnowned(
      db as unknown as Db,
      [
        makeSector({
          corporationId: corpId,
          countryId: "US",
          stateId: "MN",
          sectorType: "energy",
          revenue: 0,
        }),
      ],
      new Date("2026-04-26T23:00:00.000Z")
    );

    expect(result).toEqual({
      sectorsProcessed: 1,
      sectorsDeleted: 1,
      poolsUpdated: 0,
      totalRevenueRestored: 0,
    });
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("does not double-credit the unowned pool when a retry resumes after restore succeeded", async () => {
    const corpId = new ObjectId();
    const now = new Date("2026-04-26T23:00:00.000Z");
    const sector = makeSector({
      corporationId: corpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "technology",
      revenue: 250,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.unownedSectors.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        stateId: "CA",
        countryId: "US",
        sectorType: "technology",
        revenue: 250,
        recentCorporateSectorRestores: [
          {
            sectorId: sector._id.toString(),
            restoredAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      } satisfies UnownedSector);
    db.collectionMocks.corporateSectors.deleteMany
      .mockRejectedValueOnce(new Error("simulated delete crash"))
      .mockResolvedValueOnce({ deletedCount: 1 });

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    await expect(restoreSectorsToUnowned(db as unknown as Db, [sector], now)).rejects.toThrow(
      "simulated delete crash"
    );
    const retried = await restoreSectorsToUnowned(db as unknown as Db, [sector], now);

    expect(retried).toEqual({
      sectorsProcessed: 1,
      sectorsDeleted: 1,
      poolsUpdated: 0,
      totalRevenueRestored: 0,
    });
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it("treats an already-deleted sector as a successful no-op instead of resurrecting it", async () => {
    const corpId = new ObjectId();
    const now = new Date("2026-04-26T23:00:00.000Z");
    const sector = makeSector({
      corporationId: corpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "technology",
      revenue: 250,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.unownedSectors.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 250,
      recentCorporateSectorRestores: [
        {
          sectorId: sector._id.toString(),
          restoredAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    } satisfies UnownedSector);
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    const result = await restoreSectorsToUnowned(db as unknown as Db, [sector], now);

    expect(result).toEqual({
      sectorsProcessed: 1,
      sectorsDeleted: 1,
      poolsUpdated: 0,
      totalRevenueRestored: 0,
    });
    expect(db.collectionMocks.corporateSectors.countDocuments).toHaveBeenCalledWith({
      _id: { $in: [sector._id] },
    });
  });

  it("ignores stale restore tokens outside the retry window", async () => {
    const corpId = new ObjectId();
    const now = new Date("2026-04-26T23:00:00.000Z");
    const sector = makeSector({
      corporationId: corpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "technology",
      revenue: 250,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.unownedSectors.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 250,
      recentCorporateSectorRestores: [
        {
          sectorId: sector._id.toString(),
          restoredAt: new Date("2026-04-10T23:00:00.000Z"),
        },
      ],
      createdAt: now,
      updatedAt: now,
    } satisfies UnownedSector);
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    const result = await restoreSectorsToUnowned(db as unknown as Db, [sector], now);

    expect(result).toEqual({
      sectorsProcessed: 1,
      sectorsDeleted: 1,
      poolsUpdated: 1,
      totalRevenueRestored: 250,
    });
  });

  // Ticket #1271. The pool row this credits CARRIES a countryId and every reader
  // filters on it, so it has to be the country the STATE is in. A sector whose
  // stored country went stale when its region changed hands would otherwise
  // return its capacity to a market the country it sits in cannot see.
  it("credits the pool under the country the STATE is in, not the sector's stale value", async () => {
    const corpId = new ObjectId();
    const now = new Date("2026-09-04T12:00:00.000Z");

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    // The region changed hands: the state says UKR, the sector still says US.
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: "UKR_WES", countryId: "UKR" }],
      }),
    });
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const { restoreSectorsToUnowned } = await import("./restoreSectorsToUnowned");
    await restoreSectorsToUnowned(
      db as unknown as Db,
      [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "UKR_WES",
          sectorType: "agriculture",
          revenue: 250,
        },
      ] as never,
      now
    );

    const call = db.collectionMocks.unownedSectors.findOneAndUpdate.mock.calls[0];
    const stages = call[1] as Array<{ $set: Record<string, unknown> }>;
    expect(JSON.stringify(stages[0].$set.countryId)).toContain("UKR");
    expect(JSON.stringify(stages[0].$set.countryId)).not.toContain('"US"');
  });
});
