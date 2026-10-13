import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { GDP_GROWTH_SCENARIOS, captureGoldenOutput } from "./__fixtures__/gdpGrowthGolden";
import { runMetricEngine } from "./phase";

const TURN = 10;
const happyPath = GDP_GROWTH_SCENARIOS.find((s) => s.name.startsWith("happy-path"))!;

/** Re-stub the states read with extra persisted fields on top of the scenario's region. */
function withStateFields(db: MockDb, extra: Record<string, number>) {
  const s1 = {
    _id: "s1",
    name: "s1",
    countryId: "US",
    population: 100_000,
    gdp: 1_000_000,
    ...extra,
  };
  db.collectionMocks.states!.find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([s1]) }),
    toArray: vi.fn().mockResolvedValue([s1]),
  });
}

function capturedStateSet(db: MockDb): Record<string, unknown> {
  const calls = db.collectionMocks.states!.bulkWrite.mock.calls;
  const ops = calls.flatMap((c: unknown[]) => c[0] as Array<{ updateOne?: unknown }>);
  const op = ops.find(
    (o) => (o as { updateOne?: { filter: { _id: string } } }).updateOne?.filter._id === "s1"
  ) as { updateOne: { update: { $set: Record<string, unknown> } } };
  return op.updateOne.update.$set;
}

describe("runMetricEngine: measured-growth cutover", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    happyPath.seed(db);
    db.collection("states");
    db.collectionMocks.states!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
  });

  it("a fresh region reports the sector signal and seeds the trend with no gap", async () => {
    const [out] = await captureGoldenOutput(db, runMetricEngine, TURN);
    expect(out.integratedGdp).toBe(out.gdpGrowth);
    const set = capturedStateSet(db);
    expect(set.realOutputStartTurn).toBe(TURN - 24);
    expect(set.outputTrendGrowth).toBeTypeOf("number");
    expect(Math.abs(set.outputGap as number)).toBeLessThan(0.1);
    expect(set.legacyOutputGap).toBeUndefined();
  });

  it("a live region with a legacy gap starts the blend on the legacy headline", async () => {
    withStateFields(db, { outputGap: 8 });
    const [out] = await captureGoldenOutput(db, runMetricEngine, TURN);
    // Weight 0 on the first turn: the legacy gap still drags the headline.
    expect(out.integratedGdp).toBeLessThan(out.gdpGrowth);
    const set = capturedStateSet(db);
    expect(set.realOutputStartTurn).toBe(TURN);
    expect(set.legacyOutputGap).toBeTypeOf("number");
    // The measured gap starts fresh rather than inheriting the legacy 8.
    expect(Math.abs(set.outputGap as number)).toBeLessThan(0.1);
  });

  it("a region past the blend window is fully measured", async () => {
    withStateFields(db, {
      outputGap: 1,
      legacyOutputGap: 8,
      outputTrendGrowth: 2,
      realOutputStartTurn: TURN - 30,
    });
    const [out] = await captureGoldenOutput(db, runMetricEngine, TURN);
    expect(out.integratedGdp).toBe(out.gdpGrowth);
    expect(capturedStateSet(db).legacyOutputGap).toBeUndefined();
  });
});
