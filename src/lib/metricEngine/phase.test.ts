import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { GDP_GROWTH_SCENARIOS, captureGoldenOutput } from "./__fixtures__/gdpGrowthGolden";
import { runMetricEngine } from "./phase";

describe("runMetricEngine — golden-master parity with updateGdpGrowth", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
  });

  for (const scenario of GDP_GROWTH_SCENARIOS) {
    it(`${scenario.name}: produces the frozen gdpGrowth output (parity)`, async () => {
      scenario.seed(db);
      const out = await captureGoldenOutput(db, runMetricEngine, scenario.turn);
      expect(out).toEqual(scenario.expected);
    });
  }
});

describe("runMetricEngine — phase behavior", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
  });

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  it("compounds state.gdp per turn from the region's gdpGrowth (SSOT level moves)", async () => {
    setupCollection("states", [
      { _id: "federal", name: "federal", countryId: "US", population: 1, gdp: 999 }, // national-scope: skip
      { _id: "s1", name: "s1", countryId: "US", population: 100, gdp: 1000 },
    ]);
    setupCollection("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", [{ _id: "uA", stateId: "s1", revenue: 500 }]);
    setupCollection("stateMetrics", []);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", [{ _id: "s1", taxRates: { salesTax: 6 } }]);

    db.collection("stateMetrics");
    const metricOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.stateMetrics!.bulkWrite = vi
      .fn()
      .mockImplementation((o: typeof metricOps) => {
        metricOps.push(...o);
        return Promise.resolve({ ok: 1 });
      });
    db.collection("states");
    const stateOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.states!.bulkWrite = vi.fn().mockImplementation((o: typeof stateOps) => {
      stateOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });

    const { compoundGdpLevel } = await import("./gdpLevel");
    const { TURNS_PER_YEAR } = await import("@/lib/constants/turnTime");

    await runMetricEngine(db as unknown as Db, 10);

    // Only the real state's gdp is written; national-scope skipped.
    expect(stateOps).toHaveLength(1);
    expect(stateOps[0].updateOne.filter._id).toBe("s1");

    const growth = metricOps.find((o) => o.updateOne.filter._id === "s1")!.updateOne.update.$set[
      "economic.gdpGrowth.value"
    ];
    const expectedGdp = compoundGdpLevel(1000, growth, TURNS_PER_YEAR);
    expect(stateOps[0].updateOne.update.$set.gdp).toBeCloseTo(expectedGdp, 6);
    // positive growth → the level actually grew
    expect(stateOps[0].updateOne.update.$set.gdp).toBeGreaterThan(1000);
  });

  it("advances + persists state.capitalStock (cold-start seeds ≈3×gdp; below-steady grows) — P1c-0", async () => {
    setupCollection("states", [
      { _id: "s1", name: "s1", countryId: "US", population: 100, gdp: 1000 }, // no capitalStock → cold-start seed 3000
      { _id: "s2", name: "s2", countryId: "US", population: 100, gdp: 1000, capitalStock: 1000 }, // K/Y=1 < 3
    ]);
    setupCollection("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
      { _id: "secB", stateId: "s2", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("stateMetrics", []);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("centralBanks", []); // no bank doc → config-default prime rate
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", []);

    db.collection("stateMetrics");
    db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
    db.collection("states");
    const stateOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.states!.bulkWrite = vi.fn().mockImplementation((o: typeof stateOps) => {
      stateOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });

    await runMetricEngine(db as unknown as Db, 10);

    const s1 = stateOps.find((o) => o.updateOne.filter._id === "s1")!.updateOne.update.$set;
    const s2 = stateOps.find((o) => o.updateOne.filter._id === "s2")!.updateOne.update.$set;
    // cold-start seeds at 3×gdp (3000) and advances one tiny turn → stays ≈3000
    expect(Number.isFinite(s1.capitalStock)).toBe(true);
    expect(s1.capitalStock).toBeGreaterThan(2900);
    expect(s1.capitalStock).toBeLessThan(3100);
    // s2 starts below steady state (K/Y=1) → capital grows this turn
    expect(s2.capitalStock).toBeGreaterThan(1000);
    // gdp is still written alongside (not clobbered)
    expect(s1.gdp).toBeGreaterThan(0);
  });

  it("surfaces economic.potentialGrowth + laborForce (civilian L, growing workforce) — P1c-1", async () => {
    setupCollection("states", [
      {
        _id: "s1",
        name: "s1",
        countryId: "US",
        population: 1000,
        gdp: 1000,
        capitalStock: 3000, // steady K/Y → g_K ≈ 0
        workingAgePopulation: 600,
        militaryServicePopulation: 0,
      },
    ]);
    setupCollection("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", []);
    // prior labor force below this turn's (600×0.6=360) → positive g_L
    setupCollection("stateMetrics", [
      { _id: "s1", economic: { laborParticipation: { value: 60 }, laborForce: { value: 358 } } },
    ]);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("centralBanks", []);
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", []);

    db.collection("stateMetrics");
    const metricOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.stateMetrics!.bulkWrite = vi
      .fn()
      .mockImplementation((o: typeof metricOps) => {
        metricOps.push(...o);
        return Promise.resolve({ ok: 1 });
      });
    db.collection("states");
    db.collectionMocks.states!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

    await runMetricEngine(db as unknown as Db, 10);

    const set = metricOps.find((o) => o.updateOne.filter._id === "s1")!.updateOne.update.$set;
    // civilian L = (600 − 0) × 60% = 360
    expect(set["economic.laborForce.value"]).toBeCloseTo(360, 6);
    expect(Number.isFinite(set["economic.potentialGrowth.value"])).toBe(true);
    // growing workforce (358 → 360) + steady capital → potential above the TFP baseline
    const { TFP_BASELINE } = await import("./potentialGrowth");
    expect(set["economic.potentialGrowth.value"]).toBeGreaterThan(TFP_BASELINE);
  });

  it("integrates gdpGrowth via the output gap + persists state.outputGap (P1c-2)", async () => {
    // A large prior positive gap with the sector near potential → gdpGrowth dips
    // below the sector signal (the gap closing drags growth down), and the gap
    // shrinks toward 0. Proves the phase wires sector → gap → gdpGrowth.
    setupCollection("states", [
      {
        _id: "s1",
        name: "s1",
        countryId: "US",
        population: 1000,
        gdp: 1000,
        capitalStock: 3000,
        workingAgePopulation: 600,
        militaryServicePopulation: 0,
        outputGap: 10, // large prior positive gap
      },
    ]);
    setupCollection("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 2, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("stateMetrics", [
      { _id: "s1", economic: { laborParticipation: { value: 60 }, laborForce: { value: 360 } } },
    ]);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("centralBanks", []);
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", []);

    db.collection("stateMetrics");
    const metricOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.stateMetrics!.bulkWrite = vi
      .fn()
      .mockImplementation((o: typeof metricOps) => {
        metricOps.push(...o);
        return Promise.resolve({ ok: 1 });
      });
    db.collection("states");
    const stateOps: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    db.collectionMocks.states!.bulkWrite = vi.fn().mockImplementation((o: typeof stateOps) => {
      stateOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });

    await runMetricEngine(db as unknown as Db, 10);

    const mset = metricOps.find((o) => o.updateOne.filter._id === "s1")!.updateOne.update.$set;
    const sset = stateOps.find((o) => o.updateOne.filter._id === "s1")!.updateOne.update.$set;
    const sector = mset["economic.sectorGrowth.value"];
    const gdp = mset["economic.gdpGrowth.value"];
    expect(Number.isFinite(sector)).toBe(true);
    // gap integration bites: gdpGrowth ≠ raw sector when a prior gap exists
    expect(gdp).toBeLessThan(sector);
    // the gap is persisted and closing (10 → < 10)
    expect(sset.outputGap).toBeGreaterThan(0);
    expect(sset.outputGap).toBeLessThan(10);
  });

  it("skips NATIONAL_SCOPE synthetic docs and writes only real states", async () => {
    setupCollection("states", [
      { _id: "federal", name: "federal", countryId: "US", population: 1, gdp: 1 }, // national-scope synthetic
      { _id: "s1", name: "s1", countryId: "US", population: 100, gdp: 1 },
    ]);
    setupCollection("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setupCollection("unownedSectors", []);
    setupCollection("stateMetrics", []);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", [{ _id: "s1", taxRates: { salesTax: 6 } }]);

    db.collection("stateMetrics");
    const ops: Array<{ updateOne: { filter: { _id: string } } }> = [];
    db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((o: typeof ops) => {
      ops.push(...o);
      return Promise.resolve({ ok: 1 });
    });

    const count = await runMetricEngine(db as unknown as Db, 10);
    expect(count).toBe(1);
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter._id).toBe("s1");
  });

  it("returns 0 and writes nothing when there are no real states", async () => {
    setupCollection("states", [
      { _id: "federal", name: "federal", countryId: "US", population: 1, gdp: 1 },
    ]);
    setupCollection("corporateSectors", []);
    setupCollection("unownedSectors", []);
    setupCollection("stateMetrics", []);
    // SP5: alias macroMetrics to the same mock — the engine reads/writes both stores.
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", []);
    setupCollection("exchangeRates", []);
    setupCollection("federalBudget", []);
    setupCollection("stateBudgets", []);
    const count = await runMetricEngine(db as unknown as Db, 10);
    expect(count).toBe(0);
  });
});

describe("runMetricEngine — v2-2/v2-3a labour wage-index Δ → medianIncome + unemployment (gated on labourSystemMode ≥ 'macro')", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
  });

  function setupCollection<T>(target: MockDb, name: string, data: T[]) {
    target.collection(name);
    target.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  function seed(target: MockDb, stateMetrics: unknown[], labourSystemMode: string) {
    setupCollection(target, "states", [
      {
        _id: "s1",
        name: "s1",
        countryId: "US",
        population: 100,
        gdp: 1000,
        workingAgePopulation: 60,
        militaryServicePopulation: 0,
      },
    ]);
    setupCollection(target, "corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setupCollection(target, "unownedSectors", []);
    setupCollection(target, "stateMetrics", stateMetrics);
    target.collectionMocks.macroMetrics = target.collectionMocks.stateMetrics!;
    setupCollection(target, "corporations", []);
    setupCollection(target, "exchangeRates", []);
    setupCollection(target, "federalBudget", [
      { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection(target, "stateBudgets", [{ _id: "s1", taxRates: { salesTax: 6 } }]);
    target.collection("gameConfig");
    target.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", labourSystemMode });
    target.collection("states");
    target.collectionMocks.states!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
  }

  async function runAndCapture(target: MockDb, field: string): Promise<number | undefined> {
    const ops: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    target.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((o: typeof ops) => {
      ops.push(...o);
      return Promise.resolve({ ok: 1 });
    });
    await runMetricEngine(target as unknown as Db, 10);
    return ops.find((o) => o.updateOne.filter._id === "s1")?.updateOne.update.$set[field];
  }

  const runAndCaptureMedianIncome = (target: MockDb) =>
    runAndCapture(target, "economic.medianIncome.value");
  const runAndCaptureUnemployment = (target: MockDb) =>
    runAndCapture(target, "economic.unemploymentRate.value");

  it("gradually expands participation while employers keep asking for more workers", async () => {
    const shortage = createMockDb();
    seed(
      shortage,
      [
        {
          _id: "s1",
          economic: {
            laborParticipation: { value: 60 },
            laborForce: { value: 36 },
            labourTightness: { value: 4.8 },
            labourParticipationDemandBonus: { value: 0 },
          },
        },
      ],
      "macro"
    );
    const ops: Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }> = [];
    shortage.collectionMocks.stateMetrics!.bulkWrite = vi
      .fn()
      .mockImplementation((writes: typeof ops) => {
        ops.push(...writes);
        return Promise.resolve({ ok: 1 });
      });

    await runMetricEngine(shortage as unknown as Db, 10);

    const set = ops.find((op) => op.updateOne.filter._id === "s1")!.updateOne.update.$set;
    expect(set["economic.labourParticipationDemandBonus.value"]).toBeCloseTo(0.25, 8);
    expect(set["economic.laborForce.value"]).toBeCloseTo(36.15, 6);
  });

  it("at 'macro', a positive wage-index Δ raises medianIncome above the no-Δ baseline", async () => {
    const withDelta = createMockDb();
    seed(
      withDelta,
      [
        {
          _id: "s1",
          economic: {
            medianIncome: { value: 50_000, simBaseline: 50_000 },
            labourWageIndexDelta: { value: 0.1 },
          },
        },
      ],
      "macro"
    );
    const baseline = createMockDb();
    seed(
      baseline,
      [{ _id: "s1", economic: { medianIncome: { value: 50_000, simBaseline: 50_000 } } }],
      "macro"
    );

    const withDeltaIncome = await runAndCaptureMedianIncome(withDelta);
    const baselineIncome = await runAndCaptureMedianIncome(baseline);

    expect(withDeltaIncome).toBeDefined();
    expect(baselineIncome).toBeDefined();
    expect(withDeltaIncome!).toBeGreaterThan(baselineIncome!);
  });

  it("at 'wages' (below 'macro'), the Δ is gated off — parity with the no-Δ baseline", async () => {
    const gatedOff = createMockDb();
    seed(
      gatedOff,
      [
        {
          _id: "s1",
          economic: {
            medianIncome: { value: 50_000, simBaseline: 50_000 },
            labourWageIndexDelta: { value: 0.1 },
          },
        },
      ],
      "wages"
    );
    const baseline = createMockDb();
    seed(
      baseline,
      [{ _id: "s1", economic: { medianIncome: { value: 50_000, simBaseline: 50_000 } } }],
      "wages"
    );

    const gatedOffIncome = await runAndCaptureMedianIncome(gatedOff);
    const baselineIncome = await runAndCaptureMedianIncome(baseline);

    expect(gatedOffIncome).toBe(baselineIncome);
  });

  it("v2-3a: at 'macro', a positive wage-index Δ also raises unemployment above the no-Δ baseline", async () => {
    const withDelta = createMockDb();
    seed(
      withDelta,
      [
        {
          _id: "s1",
          economic: {
            unemploymentRate: { value: 5 },
            labourWageIndexDelta: { value: 0.1 },
          },
        },
      ],
      "macro"
    );
    const baseline = createMockDb();
    seed(baseline, [{ _id: "s1", economic: { unemploymentRate: { value: 5 } } }], "macro");

    const withDeltaUnemployment = await runAndCaptureUnemployment(withDelta);
    const baselineUnemployment = await runAndCaptureUnemployment(baseline);

    expect(withDeltaUnemployment).toBeDefined();
    expect(baselineUnemployment).toBeDefined();
    expect(withDeltaUnemployment!).toBeGreaterThan(baselineUnemployment!);
  });

  it("v2-3a: at 'wages' (below 'macro'), the unemployment Δ is gated off — parity with the no-Δ baseline", async () => {
    const gatedOff = createMockDb();
    seed(
      gatedOff,
      [
        {
          _id: "s1",
          economic: {
            unemploymentRate: { value: 5 },
            labourWageIndexDelta: { value: 0.1 },
          },
        },
      ],
      "wages"
    );
    const baseline = createMockDb();
    seed(baseline, [{ _id: "s1", economic: { unemploymentRate: { value: 5 } } }], "wages");

    const gatedOffUnemployment = await runAndCaptureUnemployment(gatedOff);
    const baselineUnemployment = await runAndCaptureUnemployment(baseline);

    expect(gatedOffUnemployment).toBe(baselineUnemployment);
  });

  it("v2-3b: at 'macro', more automation (a negative index Δ) also raises unemployment above the no-Δ baseline", async () => {
    const withDelta = createMockDb();
    seed(
      withDelta,
      [
        {
          _id: "s1",
          economic: {
            unemploymentRate: { value: 5 },
            automationIndexDelta: { value: -0.1 },
          },
        },
      ],
      "macro"
    );
    const baseline = createMockDb();
    seed(baseline, [{ _id: "s1", economic: { unemploymentRate: { value: 5 } } }], "macro");

    const withDeltaUnemployment = await runAndCaptureUnemployment(withDelta);
    const baselineUnemployment = await runAndCaptureUnemployment(baseline);

    expect(withDeltaUnemployment).toBeDefined();
    expect(baselineUnemployment).toBeDefined();
    expect(withDeltaUnemployment!).toBeGreaterThan(baselineUnemployment!);
  });

  it("v2-3b: at 'wages' (below 'macro'), the automation Δ is gated off — parity with the no-Δ baseline", async () => {
    const gatedOff = createMockDb();
    seed(
      gatedOff,
      [
        {
          _id: "s1",
          economic: {
            unemploymentRate: { value: 5 },
            automationIndexDelta: { value: -0.1 },
          },
        },
      ],
      "wages"
    );
    const baseline = createMockDb();
    seed(baseline, [{ _id: "s1", economic: { unemploymentRate: { value: 5 } } }], "wages");

    const gatedOffUnemployment = await runAndCaptureUnemployment(gatedOff);
    const baselineUnemployment = await runAndCaptureUnemployment(baseline);

    expect(gatedOffUnemployment).toBe(baselineUnemployment);
  });
});

describe("runMetricEngine — P2/D7 plants-mode realized-revenue sector signal", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
  });

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  type Ops = Array<{
    updateOne: {
      filter: { _id: string };
      update: {
        $set: Record<string, number | string | Array<{ turn: number; value: number }>>;
        $unset?: Record<string, "">;
      };
    };
  }>;

  /**
   * Seed a single-region world. `mode` drives the gameConfig read the sector
   * provider does; `prevRealized` seeds the per-region baseline snapshot.
   */
  function seedWorld(opts: {
    mode?: string;
    revenue: number;
    currentGrowthRate: number;
    prevRealized?: number;
    prevRealizedTurn?: number;
    prevRealizedUnit?: "host";
    prevRevenueEma?: number;
    prevRevenueSnapshots?: Array<{ turn: number; value: number }>;
    prevMetrics?: unknown[];
    realizedRevenue?: number;
    countryId?: string;
    corp?: { _id: string; countryId: string };
    fx?: Array<{ currencyCode: string; rate: number }>;
  }) {
    setupCollection("states", [
      {
        _id: "s1",
        name: "s1",
        countryId: opts.countryId ?? "US",
        population: 100,
        gdp: 1000,
        ...(opts.prevRealized !== undefined
          ? {
              sectorRealizedRevenue: opts.prevRealized,
              sectorRealizedRevenueTurn: opts.prevRealizedTurn ?? 9,
              ...(opts.prevRealizedUnit
                ? { sectorRealizedRevenueUnit: opts.prevRealizedUnit }
                : {}),
            }
          : {}),
        ...(opts.prevRevenueEma !== undefined ? { sectorRevenueEma: opts.prevRevenueEma } : {}),
        ...(opts.prevRevenueSnapshots !== undefined
          ? { sectorRevenueSnapshots: opts.prevRevenueSnapshots }
          : {}),
      },
    ]);
    setupCollection("corporateSectors", [
      {
        _id: "secA",
        stateId: "s1",
        countryId: opts.countryId ?? "US",
        revenue: opts.revenue,
        ...(opts.realizedRevenue !== undefined ? { realizedRevenue: opts.realizedRevenue } : {}),
        currentGrowthRate: opts.currentGrowthRate,
        corporationId: opts.corp?._id,
      },
    ]);
    setupCollection("unownedSectors", [{ _id: "uA", stateId: "s1", revenue: 500 }]);
    setupCollection("stateMetrics", opts.prevMetrics ?? []);
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    setupCollection("corporations", opts.corp ? [opts.corp] : []);
    setupCollection("exchangeRates", opts.fx ?? []);
    const countryId = opts.countryId ?? "US";
    setupCollection("federalBudget", [
      countryId === "UK"
        ? { _id: "UK", countryId: "UK", taxRates: { salesTax: 20 } }
        : { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
    ]);
    setupCollection("stateBudgets", [
      { _id: "s1", taxRates: { salesTax: countryId === "UK" ? 0 : 6 } },
    ]);
    if (opts.mode) {
      db.collection("gameConfig");
      db.collectionMocks.gameConfig!.findOne = vi
        .fn()
        .mockResolvedValue({ _id: "default", marketSystemMode: opts.mode });
    }
  }

  function captureOps(): { metricOps: Ops; stateOps: Ops } {
    const metricOps: Ops = [];
    const stateOps: Ops = [];
    db.collection("stateMetrics");
    db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((o: Ops) => {
      metricOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });
    db.collection("states");
    db.collectionMocks.states!.bulkWrite = vi.fn().mockImplementation((o: Ops) => {
      stateOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });
    return { metricOps, stateOps };
  }

  it("snapshots this turn's realized owned revenue on the state doc in EVERY mode", async () => {
    seedWorld({ revenue: 1234, currentGrowthRate: 3 }); // no gameConfig → mode off
    const { stateOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenue).toBe(1234);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenueTurn).toBe(10);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenueUnit).toBeUndefined();
  });

  it("uses the annualized region realized-revenue delta under plants", async () => {
    // 1000 → 1010 over 4 turns = +1% × 12 = 12%/yr; currentGrowthRate 3 ignored.
    seedWorld({
      mode: "plants",
      revenue: 1010,
      currentGrowthRate: 3,
      prevRealized: 1000,
      prevRealizedTurn: 6,
    });
    const { metricOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(metricOps[0].updateOne.update.$set["economic.sectorGrowth.value"]).toBeCloseTo(12, 6);
  });

  it("ignores the realized baseline when plants is off (byte-identical legacy)", async () => {
    // Same world, mode capital: the weighted average of growth 3 (1010) and the
    // 0.5 unowned pin (500) — the realized delta must not leak in.
    seedWorld({
      mode: "capital",
      revenue: 1010,
      currentGrowthRate: 3,
      prevRealized: 1000,
      prevRealizedTurn: 6,
    });
    const { metricOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    const expected = (3 * 1010 + 0.5 * 500) / 1510;
    expect(metricOps[0].updateOne.update.$set["economic.sectorGrowth.value"]).toBeCloseTo(
      expected,
      3
    );
  });

  it("does not spike on the flip turn (no baseline → legacy signal)", async () => {
    seedWorld({ mode: "plants", revenue: 1010, currentGrowthRate: 3 });
    const { metricOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    const expected = (3 * 1010 + 0.5 * 500) / 1510;
    expect(metricOps[0].updateOne.update.$set["economic.sectorGrowth.value"]).toBeCloseTo(
      expected,
      3
    );
  });

  it("keeps a revenue explosion inside the node bounds through the EMA", async () => {
    seedWorld({
      mode: "plants",
      revenue: 100_000,
      currentGrowthRate: 3,
      prevRealized: 1000,
      prevRealizedTurn: 9,
      prevMetrics: [
        {
          _id: "s1",
          economic: {
            sectorGrowth: { value: 2, simBaseline: 2 },
            unemploymentRate: { value: 5 },
          },
        },
      ],
    });
    const { metricOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    const value = metricOps[0].updateOne.update.$set["economic.sectorGrowth.value"];
    expect(value).toBeGreaterThan(2); // the boom is visible…
    expect(value).toBeLessThanOrEqual(15); // …but bounded by the node ceiling
  });

  it("persists the host-currency snapshot + unit tag under plants (ticket #1084)", async () => {
    seedWorld({
      mode: "plants",
      revenue: 1010,
      realizedRevenue: 900,
      currentGrowthRate: 3,
    });
    const { stateOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenue).toBe(900);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenueUnit).toBe("host");
  });

  it("seeds a fresh host trend on the legacy-to-host flip", async () => {
    seedWorld({
      mode: "plants",
      revenue: 1010,
      realizedRevenue: 900,
      currentGrowthRate: 3,
      prevRealized: 1000,
      prevRealizedTurn: 9,
      prevRevenueEma: 50_000,
      prevRevenueSnapshots: [{ turn: 1, value: 40_000 }],
    });
    const { stateOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(stateOps[0].updateOne.update.$set.sectorRevenueEma).toBe(900);
    expect(stateOps[0].updateOne.update.$set.sectorRevenueSnapshots).toEqual([
      { turn: 10, value: 900 },
    ]);
  });

  it("clears host trend state below plants so a later flip cannot reuse it", async () => {
    seedWorld({
      mode: "capital",
      revenue: 1010,
      currentGrowthRate: 3,
      prevRealized: 900,
      prevRealizedUnit: "host",
      prevRevenueEma: 900,
      prevRevenueSnapshots: [{ turn: 8, value: 900 }],
    });
    const { stateOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(stateOps[0].updateOne.update.$unset).toEqual({
      sectorRealizedRevenueUnit: "",
      sectorRevenueEma: "",
      sectorRevenueSnapshots: "",
    });
  });

  it("does not treat an FX-only restatement as GDP growth once the host unit is tagged", async () => {
    // Same £1000 realized both turns. GBP/₳ moved 0.80 → 0.85; the ₳ path
    // would annualize that into a ~28pp contraction. Host/host is 0.
    seedWorld({
      mode: "plants",
      countryId: "UK",
      revenue: 1000,
      realizedRevenue: 1000,
      currentGrowthRate: 3,
      prevRealized: 1000,
      prevRealizedTurn: 9,
      prevRealizedUnit: "host",
      corp: { _id: "corpUK", countryId: "UK" },
      fx: [{ currencyCode: "GBP", rate: 0.85 }],
    });
    const { metricOps, stateOps } = captureOps();
    await runMetricEngine(db as unknown as Db, 10);
    expect(metricOps[0].updateOne.update.$set["economic.sectorGrowth.value"]).toBe(0);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenue).toBe(1000);
    expect(stateOps[0].updateOne.update.$set.sectorRealizedRevenueUnit).toBe("host");
  });
});
