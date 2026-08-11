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

describe("seedBRStateMetrics — metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays BR-1991 authored values onto Sudeste (productivityGrowth -1, debtToGdp 50)", async () => {
    const { seedBRStateMetrics } = await import("@/lib/admin/seed/seedBR");
    await seedBRStateMetrics(db as unknown as Db, true, () => {}, "1991-default");
    expect(regionMacroSet(db, "SUDESTE").economic.productivityGrowth.value).toBe(-1.0);
  });

  it("overlays BR-2019 authored values onto Sudeste (rdIntensity 1.8, debtToGdp 74)", async () => {
    const { seedBRStateMetrics } = await import("@/lib/admin/seed/seedBR");
    await seedBRStateMetrics(db as unknown as Db, true, () => {}, "2019-default");
    expect(regionMacroSet(db, "SUDESTE").economic.rdIntensity.value).toBe(1.8);
  });
});

describe("seedBRBaselines — metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1991 Sudeste decay targets with the authored metric values", async () => {
    const { seedBRBaselines } = await import("@/lib/admin/seed/seedBR");
    await seedBRBaselines(db as unknown as Db, true, () => {}, "1991-default");
    const { baselines } = regionBaselineSet(db, "SUDESTE");
    expect(baselines.economic.productivityGrowth).toBe(-1.0);
    expect(baselines.governance.debtToGdp).toBe(50);
  });

  it("aligns 2019 Sudeste decay targets with the authored 2019 values", async () => {
    const { seedBRBaselines } = await import("@/lib/admin/seed/seedBR");
    await seedBRBaselines(db as unknown as Db, true, () => {}, "2019-default");
    const { baselines } = regionBaselineSet(db, "SUDESTE");
    expect(baselines.economic.rdIntensity).toBe(1.8);
  });
});

describe("BR metric presets reach the political board", () => {
  it("carries the authored era values into era-distinct board values", async () => {
    // The political half of each era's overlay is baked into the emitted board
    // at codegen time rather than written to stateMetrics at seed time. If the
    // overlay stopped being applied, every era's board would collapse to the
    // same numbers — which is exactly the regression this guards.
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const boardFor = (preset: string) =>
      NON_PLAYABLE_BOARDS[preset]?.BR?.["SUDESTE"] as Record<string, number> | undefined;
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
