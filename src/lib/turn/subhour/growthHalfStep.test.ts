import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { advanceOutputGap } from "@/lib/metricEngine/outputGap";
import { compoundGdpLevel } from "@/lib/metricEngine/gdpLevel";
import { runMetricEngine } from "@/lib/metricEngine/phase";
import { growthHalfStepForRegion, runGrowthHalfStep } from "./growthHalfStep";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TURN = 10;

type Doc = Record<string, unknown> & { _id: string };

const STATES: Doc[] = [
  { _id: "federal", name: "federal", countryId: "US", population: 1, gdp: 1 },
  {
    _id: "s1",
    name: "s1",
    countryId: "US",
    population: 1000,
    gdp: 1000,
    capitalStock: 3000,
    workingAgePopulation: 600,
    militaryServicePopulation: 0,
    outputGap: 4,
  },
  {
    _id: "s2",
    name: "s2",
    countryId: "US",
    population: 500,
    gdp: 3000,
    capitalStock: 9000,
    workingAgePopulation: 300,
    militaryServicePopulation: 0,
    outputGap: -2,
  },
];

const METRICS: Doc[] = [
  { _id: "federal", countryId: "US", economic: { gdpGrowth: { value: 2.9 } } },
  {
    _id: "s1",
    economic: {
      laborParticipation: { value: 60 },
      laborForce: { value: 360 },
      sectorGrowth: { value: 5 },
      potentialGrowth: { value: 2.5 },
      gdpGrowth: { value: 3.1 },
    },
  },
  {
    _id: "s2",
    economic: {
      laborParticipation: { value: 60 },
      laborForce: { value: 180 },
      sectorGrowth: { value: 1 },
      potentialGrowth: { value: 2 },
      gdpGrowth: { value: 1.4 },
    },
  },
];

const clone = <T>(value: T): T => structuredClone(value);

function seedTick() {
  const memory = createInMemoryDb();
  memory.seed("states", clone(STATES));
  memory.seed("macroMetrics", clone(METRICS));
  memory.seed("federalBudget", [
    { _id: "federal", countryId: "US", economicFactors: { gdpGrowth: 2.9, inflationRate: 3 } },
  ]);
  return memory;
}

interface CapturedOp {
  updateOne: {
    filter: { _id: string };
    update: { $set: Record<string, unknown>; $unset?: Record<string, ""> };
  };
}

/** Run the metric engine over these docs and capture what it writes. */
async function runEngine(states: Doc[], metrics: Doc[]) {
  const db = createMockDb();
  const setup = (name: string, data: unknown[]) => {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  };
  setup("states", states);
  setup("corporateSectors", [
    { _id: "a", stateId: "s1", revenue: 1000, currentGrowthRate: 4, corporationId: undefined },
    { _id: "b", stateId: "s2", revenue: 800, currentGrowthRate: 1, corporationId: undefined },
  ]);
  setup("unownedSectors", []);
  setup("stateMetrics", metrics);
  db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
  setup("corporations", []);
  setup("exchangeRates", []);
  setup("centralBanks", []);
  setup("federalBudget", [{ _id: "federal", countryId: "US", taxRates: { salesTax: 0 } }]);
  setup("stateBudgets", []);
  const stateOps: CapturedOp[] = [];
  const metricOps: CapturedOp[] = [];
  db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((ops: CapturedOp[]) => {
    metricOps.push(...ops);
    return Promise.resolve({ ok: 1 });
  });
  db.collection("states");
  db.collectionMocks.states!.bulkWrite = vi.fn().mockImplementation((ops: CapturedOp[]) => {
    stateOps.push(...ops);
    return Promise.resolve({ ok: 1 });
  });
  await runMetricEngine(db as unknown as Db, TURN);
  return { stateOps, metricOps };
}

/** The ops with their `lastUpdated` clock and the spent-stamp cleanup removed. */
function comparable(ops: CapturedOp[]) {
  return ops.map((op) => {
    const { lastUpdated: _clock, ...set } = op.updateOne.update.$set;
    const unset = { ...op.updateOne.update.$unset };
    delete unset["subhourBase.growth"];
    return {
      _id: op.updateOne.filter._id,
      set,
      unset: Object.keys(unset).length > 0 ? unset : undefined,
    };
  });
}

describe("growth split math", () => {
  it("moves the gap half the hour's move, keeps the hour's rate, and compounds half the hour's GDP factor", () => {
    const input = { gdp: 1000, outputGap: 4, sectorGrowth: 5, potentialGrowth: 2.5 };
    const full = advanceOutputGap(4, 5, 2.5, TURNS_PER_YEAR);
    const half = growthHalfStepForRegion(input, 0.5);
    expect(half.outputGap - 4).toBeCloseTo((full.gap - 4) / 2, 12);
    expect(half.gdpGrowth).toBeCloseTo(full.gdpGrowth, 9);
    // Two half factors at the hour's rate make exactly one full factor.
    const fullGdp = compoundGdpLevel(1000, full.gdpGrowth, TURNS_PER_YEAR);
    expect((half.gdp * half.gdp) / 1000).toBeCloseTo(fullGdp, 9);
    // Here the gap is closing, so growth is negative and the level falls.
    expect(full.gdpGrowth).toBeLessThan(0);
    expect(half.gdp).toBeLessThan(1000);
    expect(half.gdp).toBeGreaterThan(fullGdp);
  });
});

describe("growth half step and the turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
  });

  it("writes the regions, the national rollup and the budget figure, stamped", async () => {
    const memory = seedTick();
    const stats = await runGrowthHalfStep(memory as unknown as Db, TURN, new Date());
    expect(stats).toMatchObject({ regions: 2, nationals: 1, budgets: 1, alreadyStepped: 0 });

    const s1 = await memory.collection("states").findOne({ _id: "s1" });
    const s1Expected = growthHalfStepForRegion({
      gdp: 1000,
      outputGap: 4,
      sectorGrowth: 5,
      potentialGrowth: 2.5,
    });
    expect(s1?.gdp).toBe(s1Expected.gdp);
    expect(s1?.outputGap).toBe(s1Expected.outputGap);
    expect(s1?.subhourStep).toEqual({ turn: TURN, fraction: 0.5 });
    // The national-scope pseudo-state is never stepped.
    expect((await memory.collection("states").findOne({ _id: "federal" }))?.gdp).toBe(1);

    type Rate = { economic: { gdpGrowth: { value: number } } };
    const rate = async (id: string) =>
      ((await memory.collection("macroMetrics").findOne({ _id: id })) as unknown as Rate).economic
        .gdpGrowth.value;
    const s2 = await memory.collection("states").findOne({ _id: "s2" });
    const g1 = await rate("s1");
    const g2 = await rate("s2");
    expect(g1).toBe(s1Expected.gdpGrowth);
    const weighted =
      (g1 * (s1?.gdp as number) + g2 * (s2?.gdp as number)) /
      ((s1?.gdp as number) + (s2?.gdp as number));
    const national = await rate("federal");
    expect(national).toBe(Math.round(weighted * 1000) / 1000);
    const budget = (await memory
      .collection("federalBudget")
      .findOne({ _id: "federal" })) as unknown as {
      economicFactors: { gdpGrowth: number };
    };
    expect(budget.economicFactors.gdpGrowth).toBe(national);
  });

  it("never applies a half twice when the tick is retried", async () => {
    const memory = seedTick();
    await runGrowthHalfStep(memory as unknown as Db, TURN, new Date());
    const once = await memory.collection("states").find({}).toArray();
    const retry = await runGrowthHalfStep(memory as unknown as Db, TURN, new Date());
    expect(retry.alreadyStepped).toBe(2);
    expect(retry.regions).toBe(0);
    expect(await memory.collection("states").find({}).toArray()).toEqual(once);
  });

  it("lands the turn's metric engine exactly where it lands without the tick", async () => {
    const control = await runEngine(clone(STATES), clone(METRICS));

    const memory = seedTick();
    await runGrowthHalfStep(memory as unknown as Db, TURN, new Date());
    const tickedStates = (await memory.collection("states").find({}).toArray()) as Doc[];
    const tickedMetrics = (await memory.collection("macroMetrics").find({}).toArray()) as Doc[];
    // The tick really moved what the engine reads.
    expect(tickedStates.find((s) => s._id === "s1")?.gdp).not.toBe(1000);
    const ticked = await runEngine(clone(tickedStates), clone(tickedMetrics));

    expect(control.stateOps.length).toBe(2);
    expect(comparable(ticked.stateOps)).toEqual(comparable(control.stateOps));
    expect(comparable(ticked.metricOps)).toEqual(comparable(control.metricOps));
    // The spent start values are cleared only on the stamped documents.
    for (const op of ticked.stateOps) {
      expect(op.updateOne.update.$unset?.["subhourBase.growth"]).toBe("");
    }
    for (const op of [...control.stateOps, ...control.metricOps]) {
      expect(op.updateOne.update.$unset?.["subhourBase.growth"]).toBeUndefined();
    }
  });

  it("ignores a stamp left by an earlier hour", async () => {
    const control = await runEngine(clone(STATES), clone(METRICS));
    const stale = clone(STATES).map((s) =>
      s._id === "s1"
        ? {
            ...s,
            subhourStep: { turn: TURN - 1, fraction: 0.5 },
            subhourBase: {
              growth: {
                turn: TURN - 1,
                gdp: { base: 500, written: 1000 },
                outputGap: { base: 9, written: 4 },
              },
            },
          }
        : s
    );
    const result = await runEngine(stale, clone(METRICS));
    expect(comparable(result.stateOps)).toEqual(comparable(control.stateOps));
    expect(comparable(result.metricOps)).toEqual(comparable(control.metricOps));
  });
});
