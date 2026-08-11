/**
 * P3b: the annual auto-seed distress boost, under plants.
 *
 * Which field LEADS flips with the mode. Pre-plants `revenue` leads and
 * `headroomUnits` is re-derived from the post-boost figure. Under plants
 * `headroomUnits` IS the pool — it is what market share divides by and what
 * founding builds draw down — so re-deriving it from revenue would resurrect
 * headroom that expansions had already consumed. The boost applies to the units
 * and revenue is reconstructed from them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processAutoSectorSeed } from "./autoSectorSeed";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/economy/sectorDistress", () => ({
  computeSectorDistressRanking: vi.fn().mockResolvedValue([]),
  // One distressed type, so exactly one boost pipeline is issued.
  distressRankingToBoostMap: vi.fn().mockReturnValue(new Map([["manufacturing", 0.06]])),
}));
vi.mock("@/lib/nationalization/stateControlledBuckets", () => ({
  bucketKey: (s: string, t: string) => `${s}:${t}`,
  loadSeedProtectedBucketKeys: vi.fn().mockResolvedValue(new Set()),
  loadNationalCorpIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

describe("processAutoSectorSeed — plants boost basis", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of ["states", "unownedSectors", "corporateSectors", "gameState"]) {
      db.collection(name);
      const cursor = {
        toArray: vi.fn().mockResolvedValue([]),
        project: vi.fn(() => cursor),
      };
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue(cursor);
    }
    // One open manufacturing pool to boost.
    const poolCursor = {
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "pool-1", stateId: "CA", sectorType: "manufacturing" }]),
      project: vi.fn(function (this: unknown) {
        return this;
      }),
    };
    poolCursor.project = vi.fn(() => poolCursor);
    db.collectionMocks.unownedSectors!.find = vi.fn().mockReturnValue(poolCursor);
    db.collectionMocks.unownedSectors!.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  async function boostStage(plants: boolean) {
    const { marketAtLeast } = await import("@/lib/market/featureFlag");
    vi.mocked(marketAtLeast).mockReturnValue(plants);
    await processAutoSectorSeed(db as unknown as Db, 1000, {
      autoSectorSeedEnabled: true,
      lastAutoSeedTurn: 0,
    });
    const call = db.collectionMocks.unownedSectors!.updateMany.mock.calls[0];
    return (call[1] as Array<{ $set: Record<string, unknown> }>)[0].$set;
  }

  it("boosts headroomUnits and reconstructs revenue from it", async () => {
    const stage = await boostStage(true);
    // headroomUnits is multiplied directly off its own prior value…
    const units = JSON.stringify(stage.headroomUnits);
    expect(units).toContain("$multiply");
    expect(units).toContain("$headroomUnits");
    expect(units).toContain("1.06");
    // …and revenue is DIVIDED back out of the boosted units.
    const revenue = JSON.stringify(stage.revenue);
    expect(revenue).toContain("$divide");
    expect(revenue).toContain("$headroomUnits");
  });

  it("boosts revenue and re-derives headroomUnits off plants (unchanged)", async () => {
    const stage = await boostStage(false);
    const revenue = JSON.stringify(stage.revenue);
    expect(revenue).toContain("$multiply");
    expect(revenue).toContain("$revenue");
    expect(revenue).not.toContain("$divide");
    // headroomUnits derived FROM the post-boost revenue, as before.
    const units = JSON.stringify(stage.headroomUnits);
    expect(units).toContain("$revenue");
    expect(units).not.toContain("$headroomUnits");
  });
});
