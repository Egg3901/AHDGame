import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type MetricSet = Record<string, Record<string, { value: number }>>;
type BaselineSet = { baselines: Record<string, Record<string, number>> };

function regionMacroSet(db: MockDb, id: string): MetricSet {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: MetricSet }).$set;
}

function regionBaselineSet(db: MockDb, id: string): BaselineSet {
  const calls = db.collectionMocks.stateBaselines!.updateOne.mock.calls;
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: BaselineSet }).$set;
}

describe("seedUKStateMetrics — metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  // SP5: the UK is playable — the split write emits ONLY macroMetrics docs;
  // political categories vanish and independenceDesire hoists top-level.
  it("overlays UK-1991 economic values onto London's macro doc; no stateMetrics writes", async () => {
    const { seedUKStateMetrics } = await import("@/lib/admin/seed/seedUK");
    await seedUKStateMetrics(db as unknown as Db, true, () => {}, "1991-default");
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
    const set = regionMacroSet(db, "LON");
    expect(set.economic.rdIntensity.value).toBe(2.6);
    // governance on the macro doc now carries the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — political governance metrics stay off it.
    expect(Object.keys(set.governance ?? {}).sort()).toEqual(["budgetBalance", "debtToGdp"]);
  });

  it("overlays UK-2019 economic values; SCO's independenceDesire hoists to the top level", async () => {
    const { seedUKStateMetrics } = await import("@/lib/admin/seed/seedUK");
    await seedUKStateMetrics(db as unknown as Db, true, () => {}, "2019-default");
    const set = regionMacroSet(db, "LON");
    expect(set.economic.rdIntensity.value).toBe(2.2); // authored-fresh
    expect(set.education).toBeUndefined();
    // governance on the macro doc now carries the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — political governance metrics stay off it.
    expect(Object.keys(set.governance ?? {}).sort()).toEqual(["budgetBalance", "debtToGdp"]);
    const sco = regionMacroSet(db, "SCO") as MetricSet & {
      independenceDesire?: { value: number };
    };
    // governance on the macro doc now carries the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — political governance metrics stay off it.
    expect(Object.keys(sco.governance ?? {}).sort()).toEqual(["budgetBalance", "debtToGdp"]);
    if (sco.independenceDesire) {
      expect(typeof sco.independenceDesire.value).toBe("number");
    }
  });
});

describe("seedUKBaselines — metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1991 London decay targets with the authored metric values", async () => {
    const { seedUKBaselines } = await import("@/lib/admin/seed/seedUK");
    await seedUKBaselines(db as unknown as Db, true, () => {}, "1991-default");
    const { baselines } = regionBaselineSet(db, "LON");
    expect(baselines.economic.rdIntensity).toBe(2.6);
    expect(baselines.governance.debtToGdp).toBe(30);
  });

  it("aligns 2019 London decay targets with the authored 2019 values", async () => {
    const { seedUKBaselines } = await import("@/lib/admin/seed/seedUK");
    await seedUKBaselines(db as unknown as Db, true, () => {}, "2019-default");
    const { baselines } = regionBaselineSet(db, "LON");
    expect(baselines.economic.rdIntensity).toBe(2.2);
  });
});
