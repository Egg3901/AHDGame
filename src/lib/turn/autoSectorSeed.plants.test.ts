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
    // One open manufacturing pool to boost. It holds LESS claimable headroom
    // than the world has built plant (100 < 500), so it is a genuinely thin
    // market and the distress boost applies.
    setPool({ _id: "pool-1", stateId: "CA", sectorType: "manufacturing", headroomUnits: 100 });
    setOwnedCapacity(500);
    db.collectionMocks.unownedSectors!.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  /** Replace the single open pool bucket the seeder will consider. */
  function setPool(doc: Record<string, unknown>) {
    const poolCursor = {
      toArray: vi.fn().mockResolvedValue([doc]),
      project: vi.fn(() => poolCursor),
    };
    db.collectionMocks.unownedSectors!.find = vi.fn().mockReturnValue(poolCursor);
  }

  /** Built manufacturing capacity in CA, as the bucket aggregation reports it. */
  function setOwnedCapacity(units: number) {
    db.collectionMocks.corporateSectors!.aggregate = vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: { stateId: "CA", sectorType: "manufacturing" }, units }]),
    });
  }

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

/**
 * The boost is a $multiply and nothing but a build draws the pool down, so an
 * uncapped boost compounds every year a commodity stays distressed. That is how
 * a fully built-out market still advertised 60% unowned while the expand gate
 * (a real demand gap) refused to build into it — ticket #1145.
 */
describe("processAutoSectorSeed — boost is capped by built capacity", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of ["states", "unownedSectors", "corporateSectors", "gameState"]) {
      db.collection(name);
      const cursor = { toArray: vi.fn().mockResolvedValue([]), project: vi.fn(() => cursor) };
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue(cursor);
    }
    db.collectionMocks.unownedSectors!.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  function wire(pool: Record<string, unknown>, ownedUnits: number) {
    const poolCursor = {
      toArray: vi.fn().mockResolvedValue([pool]),
      project: vi.fn(() => poolCursor),
    };
    db.collectionMocks.unownedSectors!.find = vi.fn().mockReturnValue(poolCursor);
    db.collectionMocks.corporateSectors!.aggregate = vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: { stateId: "CA", sectorType: "manufacturing" }, units: ownedUnits },
        ]),
    });
  }

  async function run() {
    const { marketAtLeast } = await import("@/lib/market/featureFlag");
    vi.mocked(marketAtLeast).mockReturnValue(true);
    await processAutoSectorSeed(db as unknown as Db, 1000, {
      autoSectorSeedEnabled: true,
      lastAutoSeedTurn: 0,
    });
  }

  const pool = (headroomUnits: number) => ({
    _id: "pool-1",
    stateId: "CA",
    sectorType: "manufacturing",
    headroomUnits,
  });

  it("boosts a thin market, where less is claimable than has been built", async () => {
    wire(pool(100), 500);
    await run();
    expect(db.collectionMocks.unownedSectors!.updateMany).toHaveBeenCalled();
  });

  it("skips a market already holding more headroom than the world has built", async () => {
    wire(pool(900), 500);
    await run();
    expect(db.collectionMocks.unownedSectors!.updateMany).not.toHaveBeenCalled();
  });

  it("skips a market nobody has built in at all", async () => {
    // Every unit of it is already claimable; adding more claimable share to a
    // wholly unclaimed market relieves nothing.
    wire(pool(100), 0);
    await run();
    expect(db.collectionMocks.unownedSectors!.updateMany).not.toHaveBeenCalled();
  });

  it("heals a pre-backfill row from revenue rather than reading it as zero headroom", async () => {
    // A row with `revenue` and no `headroomUnits` must not be treated as an
    // empty pool — that would boost the most inflated markets hardest.
    wire({ _id: "pool-1", stateId: "CA", sectorType: "manufacturing", revenue: 10_000_000 }, 1);
    await run();
    expect(db.collectionMocks.unownedSectors!.updateMany).not.toHaveBeenCalled();
  });

  it("leaves the below-plants path ungated", async () => {
    const { marketAtLeast } = await import("@/lib/market/featureFlag");
    wire(pool(900), 500);
    vi.mocked(marketAtLeast).mockReturnValue(false);
    await processAutoSectorSeed(db as unknown as Db, 1000, {
      autoSectorSeedEnabled: true,
      lastAutoSeedTurn: 0,
    });
    expect(db.collectionMocks.unownedSectors!.updateMany).toHaveBeenCalled();
  });
});
