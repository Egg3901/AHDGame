import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type MetricSet = Record<string, Record<string, { value: number }>>;
type BaselineSet = { baselines: Record<string, Record<string, number>> };

function regionBaselineSet(db: MockDb, id: string): BaselineSet {
  const calls = db.collectionMocks.stateBaselines!.updateOne.mock.calls;
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: BaselineSet }).$set;
}

function regionMacroSet(db: MockDb, id: string): MetricSet {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: MetricSet }).$set;
}

describe("seedCNStateMetrics — metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays CN-1991 authored values onto Huadong (property 45, debtToGdp 25)", async () => {
    const { seedCNStateMetrics } = await import("@/lib/admin/seed/seedCN");
    await seedCNStateMetrics(db as unknown as Db, true, () => {}, "1991-default");
    expect(regionMacroSet(db, "HD").economic.propertyValueIndex.value).toBe(45);
  });

  it("overlays CN-2019 authored values onto Huadong (property 200, debtToGdp 83)", async () => {
    const { seedCNStateMetrics } = await import("@/lib/admin/seed/seedCN");
    await seedCNStateMetrics(db as unknown as Db, true, () => {}, "2019-default");
    expect(regionMacroSet(db, "HD").economic.propertyValueIndex.value).toBe(200);
  });
});

describe("seedCNBaselines — metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1991 Huadong decay targets with the authored metric values", async () => {
    const { seedCNBaselines } = await import("@/lib/admin/seed/seedCN");
    await seedCNBaselines(db as unknown as Db, true, () => {}, "1991-default");
    const { baselines } = regionBaselineSet(db, "HD");
    expect(baselines.economic.propertyValueIndex).toBe(45);
    expect(baselines.governance.debtToGdp).toBe(25);
  });

  it("aligns 2019 Huadong decay targets with the authored 2019 values", async () => {
    const { seedCNBaselines } = await import("@/lib/admin/seed/seedCN");
    await seedCNBaselines(db as unknown as Db, true, () => {}, "2019-default");
    const { baselines } = regionBaselineSet(db, "HD");
    expect(baselines.economic.propertyValueIndex).toBe(200);
  });
});

describe("CN metric presets reach the political board", () => {
  it("carries the authored era values into era-distinct board values", async () => {
    // The political half of each era's overlay is baked into the emitted board
    // at codegen time rather than written to stateMetrics at seed time. If the
    // overlay stopped being applied, every era's board would collapse to the
    // same numbers — which is exactly the regression this guards.
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const boardFor = (preset: string) =>
      NON_PLAYABLE_BOARDS[preset]?.CN?.["HD"] as Record<string, number> | undefined;
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
