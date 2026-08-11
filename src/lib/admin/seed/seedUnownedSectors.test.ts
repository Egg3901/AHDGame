import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  computeUnownedSeedRevenue,
  MIN_UNOWNED_SECTOR_REVENUE,
  seedUnownedSectors,
} from "./seedUnownedSectors";

function cursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("computeUnownedSeedRevenue", () => {
  it("reproduces a small 1991 CN market (HB logistics, near the floor)", () => {
    const rev = computeUnownedSeedRevenue({
      gdp: 350_000,
      countryId: "CN",
      stateId: "HB",
      sectorType: "logistics",
      preset: "1991-default",
    });
    expect(rev).toBeGreaterThanOrEqual(MIN_UNOWNED_SECTOR_REVENUE);
    expect(rev).toBeLessThan(3_000_000); // small 1991-CN logistics market, not the 100M+ live value
  });

  it("floors tiny markets at MIN_UNOWNED_SECTOR_REVENUE", () => {
    const rev = computeUnownedSeedRevenue({
      gdp: 1,
      countryId: "CN",
      stateId: "DB",
      sectorType: "logistics",
      preset: "1991-default",
    });
    expect(rev).toBe(MIN_UNOWNED_SECTOR_REVENUE);
  });

  it("produces positive values for US and UK (multiplier wired)", () => {
    const us = computeUnownedSeedRevenue({
      gdp: 10_000_000,
      countryId: "US",
      stateId: "CA",
      sectorType: "energy",
      preset: "1991-default",
    });
    const uk = computeUnownedSeedRevenue({
      gdp: 10_000_000,
      countryId: "UK",
      stateId: "LDN",
      sectorType: "energy",
      preset: "1991-default",
    });
    expect(us).toBeGreaterThan(0);
    expect(uk).toBeGreaterThan(0);
  });

  it("differentiates 1953 UK sectors instead of pinning them all at the floor", () => {
    // Regression: at 1953 nominal magnitudes the modern ₳1,000,000 floor bound
    // on every single UK (region, sector) bucket — all 204 identical, zero
    // regional or sectoral signal in a player-enabled country.
    const ukRegions = ["LON", "SEE", "NEE", "WAL", "NIR"];
    const revenues = ukRegions.flatMap((stateId) =>
      ["financial", "manufacturing", "agriculture", "technology"].map((sectorType) =>
        computeUnownedSeedRevenue({
          gdp: stateId === "LON" ? 3_800 : 1_000,
          countryId: "UK",
          stateId,
          sectorType,
          preset: "1953-default",
        })
      )
    );
    expect(new Set(revenues).size).toBeGreaterThan(1);
    // London's financial sector must outrank Northern Ireland's agriculture.
    const [lonFinancial] = revenues;
    expect(lonFinancial).toBeGreaterThan(revenues[revenues.length - 1]);
  });

  it("leaves modern-preset output untouched by the era calibration", () => {
    // Same inputs on a modern preset resolve the unchanged scale + floor.
    const rev = computeUnownedSeedRevenue({
      gdp: 1,
      countryId: "UK",
      stateId: "LDN",
      sectorType: "financial",
      preset: "2019-default",
    });
    expect(rev).toBe(MIN_UNOWNED_SECTOR_REVENUE);
  });
});

describe("seedUnownedSectors refresh mode", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("unownedSectors");
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "HD", countryId: "CN", gdp: 680_000 }])
    );
    db.collectionMocks.unownedSectors.createIndex = vi.fn().mockResolvedValue(undefined);
  });

  it("refresh=true updates existing docs via $set.revenue", async () => {
    await seedUnownedSectors(db as unknown as Db, () => {}, 1, "1991-default", true);
    const [, update] = bulkOps(db.collectionMocks.unownedSectors.bulkWrite)[0];
    expect((update.$set as { revenue: number }).revenue).toBeGreaterThan(0);
  });

  it("default omits $set.revenue (insert-only)", async () => {
    await seedUnownedSectors(db as unknown as Db, () => {}, 1, "1991-default");
    const [, update] = bulkOps(db.collectionMocks.unownedSectors.bulkWrite)[0];
    expect((update.$set as { revenue?: number } | undefined)?.revenue).toBeUndefined();
    expect((update.$setOnInsert as { revenue: number }).revenue).toBeGreaterThan(0);
  });

  it("writes every sector in ONE round trip, and creates its indexes first", async () => {
    await seedUnownedSectors(db as unknown as Db, () => {}, 1, "1991-default");
    // One state × 17 sector types, batched.
    expect(db.collectionMocks.unownedSectors.bulkWrite).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.unownedSectors.updateOne).not.toHaveBeenCalled();
    expect(bulkOps(db.collectionMocks.unownedSectors.bulkWrite).length).toBeGreaterThan(1);
    // The upserts filter on {stateId, sectorType}; without the index in place
    // first, each one is a collection scan the batching no longer hides.
    const indexOrder = db.collectionMocks.unownedSectors.createIndex.mock.invocationCallOrder[0];
    const writeOrder = db.collectionMocks.unownedSectors.bulkWrite.mock.invocationCallOrder[0];
    expect(indexOrder).toBeLessThan(writeOrder);
  });
});
