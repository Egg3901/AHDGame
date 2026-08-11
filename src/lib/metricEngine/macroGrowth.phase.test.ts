import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { runMetricEngine } from "./phase";

/**
 * Macro-growth v1 (design §4): the ONLY variable under test is
 * gameState.macroGrowthV1. Era system is off (isolate O2/O3). Two regions in two
 * countries — US is the rich frontier, CN is poor + market-open (low SOCI) — so
 * the convergence bonus lands on CN. Asserts CN's persisted potentialGrowth is
 * strictly higher with the flag ON.
 */
function seedWorld(db: MockDb, macroGrowthV1: boolean): void {
  const setupCollection = <T>(name: string, data: T[]): void => {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  };

  db.collection("gameState");
  db.collectionMocks.gameState!.findOne = vi
    .fn()
    .mockResolvedValue({ _id: "current", eraSystemEnabled: false, macroGrowthV1 });

  // US region (rich → the frontier) + CN region (poor). Same fx (exchangeRates
  // empty ⇒ fx 1) so anchor pc == local pc.
  setupCollection("states", [
    {
      _id: "s_us",
      name: "s_us",
      countryId: "US",
      population: 100,
      gdp: 5_000_000,
      workingAgePopulation: 70,
      militaryServicePopulation: 0,
    },
    {
      _id: "s_cn",
      name: "s_cn",
      countryId: "CN",
      population: 100,
      gdp: 100_000,
      workingAgePopulation: 70,
      militaryServicePopulation: 0,
    },
  ]);
  // Prev metrics: real regions (sector signal) + national docs (lagged gate inputs).
  setupCollection("stateMetrics", [
    { _id: "s_us", countryId: "US", economic: { sectorGrowth: { value: 1 } } },
    { _id: "s_cn", countryId: "CN", economic: { sectorGrowth: { value: 1 } } },
    {
      _id: "cn_national",
      countryId: "CN",
      economic: { tradeGrowth: { value: 5 }, economicFreedom: { value: 60 } },
    },
    { _id: "federal", countryId: "US", economic: {} },
  ]);
  // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
  db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
  // CN is market-open (low state-ownership) so its openness gate stays high.
  setupCollection("federalBudget", [
    { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    { _id: "CN", countryId: "CN", taxRates: { salesTax: 0 }, stateOwnershipConcentration: 0.1 },
  ]);
  setupCollection("corporateSectors", []);
  setupCollection("unownedSectors", []);
  setupCollection("corporations", []);
  setupCollection("exchangeRates", []);
  setupCollection("stateBudgets", [
    { _id: "s_us", taxRates: { salesTax: 0 } },
    { _id: "s_cn", taxRates: { salesTax: 0 } },
  ]);

  const metricOps: Array<{
    updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
  }> = [];
  db.collection("stateMetrics");
  db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((o: typeof metricOps) => {
    metricOps.push(...o);
    return Promise.resolve({ ok: 1 });
  });
  (db as unknown as { _metricOps: typeof metricOps })._metricOps = metricOps;

  db.collection("states");
  db.collectionMocks.states!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
}

function cnPotentialFor(db: MockDb, stateId: string): number {
  const ops = (
    db as unknown as {
      _metricOps: Array<{
        updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
      }>;
    }
  )._metricOps;
  const doc = ops.find((o) => o.updateOne.filter._id === stateId);
  return doc!.updateOne.update.$set["economic.potentialGrowth.value"];
}

function cnPotential(db: MockDb): number {
  return cnPotentialFor(db, "s_cn");
}

describe("macroGrowthV1: O2 convergence on potential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
  });

  it("a poor, market-open region's potentialGrowth is higher with the flag ON", async () => {
    const dbOff = createMockDb();
    seedWorld(dbOff, false);
    await runMetricEngine(dbOff as unknown as Db, 100);
    const off = cnPotential(dbOff);

    resetCorpFxRateCacheForTests();
    const dbOn = createMockDb();
    seedWorld(dbOn, true);
    await runMetricEngine(dbOn as unknown as Db, 100);
    const on = cnPotential(dbOn);

    expect(Number.isFinite(off)).toBe(true);
    expect(on).toBeGreaterThan(off);
  });
});

describe("macroGrowthV1: O1c corp investment on capital → potential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
  });

  const usStates = (invest?: { anchor: number; turn: number }) => [
    {
      _id: "s_us",
      name: "s_us",
      countryId: "US",
      population: 100,
      gdp: 5_000_000,
      workingAgePopulation: 70,
      militaryServicePopulation: 0,
      capitalStock: 15_000_000,
      ...(invest
        ? { corpGrowthInvestmentAnchor: invest.anchor, corpGrowthInvestmentTurn: invest.turn }
        : {}),
    },
    {
      _id: "s_cn",
      name: "s_cn",
      countryId: "CN",
      population: 100,
      gdp: 100_000,
      workingAgePopulation: 70,
      militaryServicePopulation: 0,
    },
  ];

  const runWithStates = async (states: unknown[]): Promise<number> => {
    const db = createMockDb();
    seedWorld(db, true);
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
      toArray: vi.fn().mockResolvedValue(states),
    });
    resetCorpFxRateCacheForTests();
    await runMetricEngine(db as unknown as Db, 100);
    return cnPotentialFor(db, "s_us");
  };

  it("a region's fresh (this-turn) paid corp investment raises its potentialGrowth", async () => {
    const base = await runWithStates(usStates());
    const withInvest = await runWithStates(usStates({ anchor: 200_000_000_000, turn: 100 }));
    expect(withInvest).toBeGreaterThan(base);
  });

  it("a STALE investment tag (wrong turn) is ignored", async () => {
    const base = await runWithStates(usStates());
    const stale = await runWithStates(usStates({ anchor: 200_000_000_000, turn: 42 }));
    expect(stale).toBeCloseTo(base, 6);
  });
});
