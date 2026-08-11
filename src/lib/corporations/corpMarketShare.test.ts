import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { computeCorpMarketShare } from "./corpMarketShare";

function makeCursor<T>(rows: T[]) {
  return {
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("computeCorpMarketShare", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("computes home-country industry share and rank for the focal corp", async () => {
    const focalId = new ObjectId();
    const rivalId = new ObjectId();

    db.collectionMocks.states = db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(
      makeCursor([{ _id: "US-CA", gdp: 0, countryId: "US" }])
    );

    db.collectionMocks.corporateSectors = db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      makeCursor([
        { corporationId: focalId, sectorType: "manufacturing", stateId: "US-CA", revenue: 700_000 },
        { corporationId: rivalId, sectorType: "manufacturing", stateId: "US-CA", revenue: 300_000 },
      ])
    );

    db.collectionMocks.unownedSectors = db.collection("unownedSectors");
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      // Persisted unowned pool present → market = owned + unowned (no GDP fallback).
      makeCursor([{ sectorType: "manufacturing", stateId: "US-CA", revenue: 0 }])
    );

    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(
      makeCursor([
        { _id: focalId, countryId: "US", liquidCurrencyCode: "USD" },
        { _id: rivalId, countryId: "US", liquidCurrencyCode: "USD" },
      ])
    );

    db.collectionMocks.exchangeRates = db.collection("exchangeRates");
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      makeCursor([{ currencyCode: "USD", rate: 1 }])
    );

    const positions = await computeCorpMarketShare(
      db as unknown as Db,
      { _id: focalId, countryId: "US" },
      [{ sectorType: "manufacturing" }]
    );

    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.sectorType).toBe("manufacturing");
    // 700k of a 1M market (owned 1M + 0 unowned) → 70%.
    expect(p.marketSharePercent).toBeCloseTo(70, 0);
    expect(p.rank).toBe(1); // focal outranks the 300k rival
    expect(p.competitors).toBe(2);
  });

  it("returns an empty array when the corp has no sectors", async () => {
    const positions = await computeCorpMarketShare(
      db as unknown as Db,
      { _id: new ObjectId(), countryId: "US" },
      []
    );
    expect(positions).toEqual([]);
  });
});
