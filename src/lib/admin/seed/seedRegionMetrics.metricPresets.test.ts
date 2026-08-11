import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type MetricSet = Record<string, Record<string, { value: number }>>;

function macroMetricSet(db: MockDb, id: string): MetricSet {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: MetricSet }).$set;
}

describe("seedRegionMetrics — US metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  // SP5: the US is playable — the split write emits ONLY macroMetrics docs
  // (economic/population + hoisted mechanic fields); stateMetrics is never
  // written. Political overlay values (governance axis metrics, environment,
  // publicSafety) vanish with the political remainder.
  it("writes no stateMetrics and no political categories on the macro doc (US-1991)", async () => {
    const { seedRegionMetrics } = await import("@/lib/admin/seed/seedRegionMetrics");
    await seedRegionMetrics(db as unknown as Db, false, () => {}, "1991-default");
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
    const set = macroMetricSet(db, "CA");
    // governance on the macro doc now carries the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — political governance metrics stay off it.
    expect(Object.keys(set.governance ?? {}).sort()).toEqual(["budgetBalance", "debtToGdp"]);
    expect(set.environment).toBeUndefined();
    expect(set.economic).toBeTruthy(); // macro layer lands
  });

  it("keeps US-2019 economic overlays (rdIntensity 4.2) on the macro doc", async () => {
    const { seedRegionMetrics } = await import("@/lib/admin/seed/seedRegionMetrics");
    await seedRegionMetrics(db as unknown as Db, false, () => {}, "2019-default");
    const set = macroMetricSet(db, "CA");
    expect(set.economic.rdIntensity.value).toBe(4.2);
    // governance on the macro doc now carries the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — political governance metrics stay off it.
    expect(Object.keys(set.governance ?? {}).sort()).toEqual(["budgetBalance", "debtToGdp"]);
  });

  it("covers DC (the default-config region): population kept on the macro doc", async () => {
    const { seedRegionMetrics } = await import("@/lib/admin/seed/seedRegionMetrics");
    await seedRegionMetrics(db as unknown as Db, false, () => {}, "1991-default");
    const set = macroMetricSet(db, "DC");
    expect(set.publicSafety).toBeUndefined();
    expect(set.population).toBeTruthy();
  });
});
