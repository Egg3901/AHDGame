import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type MetricSet = Record<string, Record<string, { value: number }>>;
type BaselineSet = { baselines: Record<string, Record<string, number>> };

function landBaselineSet(db: MockDb, id: string): BaselineSet {
  const calls = db.collectionMocks.stateBaselines!.updateOne.mock.calls;
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: BaselineSet }).$set;
}

function regionMacroSet(db: MockDb, id: string): MetricSet {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: MetricSet }).$set;
}

describe("seedDEStateMetrics — metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays DE-1991 authored values onto BW (rdIntensity 3.0, debtToGdp 40)", async () => {
    const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
    await seedDEStateMetrics(db as unknown as Db, true, () => {}, "1991-default");
    expect(regionMacroSet(db, "BW").economic.rdIntensity.value).toBe(3.0);
  });

  it("overlays DE-2019 authored values onto BW (rdIntensity 3.8, debtToGdp 66)", async () => {
    const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
    await seedDEStateMetrics(db as unknown as Db, true, () => {}, "2019-default");
    expect(regionMacroSet(db, "BW").economic.rdIntensity.value).toBe(3.8);
  });
});

describe("seedDEBaselines — metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1991 BW decay targets with the authored metric values", async () => {
    const { seedDEBaselines } = await import("@/lib/admin/seed/seedDE");
    await seedDEBaselines(db as unknown as Db, true, () => {}, "1991-default");
    const { baselines } = landBaselineSet(db, "BW");
    expect(baselines.economic.rdIntensity).toBe(3.0);
    expect(baselines.environment.energyTransitionProgress).toBe(9);
  });

  it("aligns 2019 BW decay targets with the authored 2019 values", async () => {
    const { seedDEBaselines } = await import("@/lib/admin/seed/seedDE");
    await seedDEBaselines(db as unknown as Db, true, () => {}, "2019-default");
    const { baselines } = landBaselineSet(db, "BW");
    expect(baselines.economic.rdIntensity).toBe(3.8);
    expect(baselines.governance.coDeterminationQuality).toBe(80);
  });
});

describe("DE metric presets reach the political board", () => {
  it("carries the authored era values into era-distinct board values", async () => {
    // The political half of each era's overlay is baked into the emitted board
    // at codegen time rather than written to stateMetrics at seed time. If the
    // overlay stopped being applied, every era's board would collapse to the
    // same numbers — which is exactly the regression this guards.
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const boardFor = (preset: string) =>
      NON_PLAYABLE_BOARDS[preset]?.DE?.["BW"] as Record<string, number> | undefined;
    const eras = ["1953-default", "1979-default", "1991-default", "2019-default"].filter((p) =>
      boardFor(p)
    );
    expect(eras.length).toBeGreaterThan(1);
    const distinct = new Set(
      eras.map((p) =>
        ["economy.fiscal", "health.outcomes", "education.attainment"]
          .map((f) => boardFor(p)![f])
          .join("|")
      )
    );
    expect(distinct.size, "every era produced an identical board").toBe(eras.length);
  });
});
