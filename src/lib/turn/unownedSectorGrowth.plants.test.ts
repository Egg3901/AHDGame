/**
 * P3b §5 dynamics: under plants an unowned sector is UNMET DEMAND in capacity
 * units, so it grows with the state's economy — not with the corporate growth
 * rates of the very corps that are eating it.
 *
 * The pre-plants behaviour (revenue compounding at half the local corporate
 * growth rate) is circular: serving demand created demand, so a market could
 * never saturate. These pin the replacement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CorporateSector, StateMetrics, UnownedSector } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import {
  computeUnownedHeadroomUnits,
  unownedHeadroomUnitsPerAnchor,
} from "@/lib/market/unownedHeadroom";
import { processUnownedSectorGrowth } from "./unownedSectorGrowth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const POOL_REVENUE = 10_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1);
const UNITS_PER_ANCHOR = unownedHeadroomUnitsPerAnchor("manufacturing", 1);

describe("processUnownedSectorGrowth — plants", () => {
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

  function unowned(overrides: Partial<UnownedSector> = {}): UnownedSector {
    return {
      _id: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "manufacturing",
      revenue: POOL_REVENUE,
      headroomUnits: POOL_UNITS,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as UnownedSector;
  }

  function corpSector(growthRate: number): CorporateSector {
    return {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "manufacturing",
      targetGrowthRate: growthRate,
      currentGrowthRate: growthRate,
      revenue: 1_000_000,
      profitMargin: 35,
      workers: 500,
      currentGrowthCost: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CorporateSector;
  }

  function stateMetric(stateId: string, gdpGrowth: number): StateMetrics {
    return {
      _id: stateId,
      economic: { gdpGrowth: { value: gdpGrowth } },
    } as unknown as StateMetrics;
  }

  async function run(
    pools: UnownedSector[],
    corpSectors: CorporateSector[],
    metrics: StateMetrics[]
  ) {
    setupCollection("unownedSectors", pools);
    setupCollection("corporateSectors", corpSectors);
    setupCollection("macroMetrics", metrics);
    setupCollection("corporations", []);
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", marketSystemMode: "plants" });
    await processUnownedSectorGrowth(db as unknown as Db);
    const ops = db.collectionMocks.unownedSectors!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, number> } };
    }>;
    return ops.map((op) => op.updateOne.update.$set);
  }

  it("grows headroom at the state's GDP growth rate, per turn", async () => {
    const gdpGrowth = 4.8; // % per game year
    const [set] = await run([unowned()], [], [stateMetric("CA", gdpGrowth)]);
    const perTurn = gdpGrowth / GROWTH_RATE_TURNS_PER_YEAR;
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS * (1 + perTurn / 100), 6);
  });

  it("ignores corporate growth rates entirely", async () => {
    // A state full of corps growing at 10%/yr in a 1%-growth economy: the pool
    // must follow the ECONOMY. Pre-plants this grew at 5% (half of 10).
    const [set] = await run([unowned()], [corpSector(10), corpSector(10)], [stateMetric("CA", 1)]);
    const perTurn = 1 / GROWTH_RATE_TURNS_PER_YEAR;
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS * (1 + perTurn / 100), 6);
  });

  it("keeps the legacy revenue view in lockstep with the units", async () => {
    const [set] = await run([unowned()], [], [stateMetric("CA", 4.8)]);
    expect(set.revenue).toBe(Math.round(set.headroomUnits / UNITS_PER_ANCHOR));
  });

  it("does not contract headroom in a shrinking economy", async () => {
    const [set] = await run([unowned()], [], [stateMetric("CA", -3)]);
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS, 6);
  });

  it("falls back to 1%/yr for an unmetered state", async () => {
    const [set] = await run([unowned()], [], []);
    const perTurn = 1 / GROWTH_RATE_TURNS_PER_YEAR;
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS * (1 + perTurn / 100), 6);
  });

  it("derives units for a pool that never got the headroomUnits backfill", async () => {
    const [set] = await run([unowned({ headroomUnits: undefined })], [], [stateMetric("CA", 4.8)]);
    const perTurn = 4.8 / GROWTH_RATE_TURNS_PER_YEAR;
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS * (1 + perTurn / 100), 6);
  });

  it("does not resurrect headroom that expansions drew down", async () => {
    // A pool drawn down to a tenth of what its stale ₳ revenue implies. Growth
    // must compound the UNITS, not re-derive them from the revenue nameplate.
    const drawn = unowned({ headroomUnits: POOL_UNITS * 0.1 });
    const [set] = await run([drawn], [], [stateMetric("CA", 4.8)]);
    const perTurn = 4.8 / GROWTH_RATE_TURNS_PER_YEAR;
    expect(set.headroomUnits).toBeCloseTo(POOL_UNITS * 0.1 * (1 + perTurn / 100), 6);
    expect(set.headroomUnits).toBeLessThan(POOL_UNITS);
  });
});
