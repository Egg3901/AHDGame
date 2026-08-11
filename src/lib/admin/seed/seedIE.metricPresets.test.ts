import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type SetDoc = Record<string, Record<string, { value: number }>>;

function dubMacroSet(db: MockDb): SetDoc {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const dub = calls.find((c) => (c[0] as { _id: string })._id === "DUB");
  return (dub![1] as { $set: SetDoc }).$set;
}

function dubBaselineSet(db: MockDb): { baselines: Record<string, Record<string, number>> } {
  const calls = db.collectionMocks.stateBaselines!.updateOne.mock.calls;
  const dub = calls.find((c) => (c[0] as { _id: string })._id === "DUB");
  return (dub![1] as { $set: { baselines: Record<string, Record<string, number>> } }).$set;
}

describe("seedIEStateMetrics — metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays IE-1991 authored values onto Dublin (debtToGdp 95, rdIntensity 1.2)", async () => {
    const { seedIEStateMetrics } = await import("@/lib/admin/seed/seedIE");
    await seedIEStateMetrics(db as unknown as Db, true, () => {}, "1991-default");
    expect(dubMacroSet(db).economic.rdIntensity.value).toBe(1.2);
    // Author overlay wins over the blanket applyEra1991Adjustments transform.
    expect(dubMacroSet(db).economic.economicFreedom.value).toBe(55);
  });

  it("overlays IE-2019 authored values onto Dublin (rdIntensity 2.6, housing pressure 88)", async () => {
    const { seedIEStateMetrics } = await import("@/lib/admin/seed/seedIE");
    await seedIEStateMetrics(db as unknown as Db, true, () => {}, "2019-default");
    // 2019 is authored now (not derived) — the overlay applies real per-region values.
    expect(dubMacroSet(db).economic.rdIntensity.value).toBe(2.6);
  });
});

describe("seedIEBaselines — metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1991 Dublin decay targets with the authored metric values", async () => {
    const { seedIEBaselines } = await import("@/lib/admin/seed/seedIE");
    await seedIEBaselines(db as unknown as Db, true, () => {}, "1991-default");
    const { baselines } = dubBaselineSet(db);
    expect(baselines.governance.debtToGdp).toBe(95);
    expect(baselines.economic.rdIntensity).toBe(1.2);
    expect(baselines.environment.energyTransitionProgress).toBe(8);
  });

  it("aligns 2019 Dublin decay targets with the authored 2019 values", async () => {
    const { seedIEBaselines } = await import("@/lib/admin/seed/seedIE");
    await seedIEBaselines(db as unknown as Db, true, () => {}, "2019-default");
    const { baselines } = dubBaselineSet(db);
    expect(baselines.economic.rdIntensity).toBe(2.6);
    expect(baselines.social.housingAffordability).toBe(88);
  });
});

describe("IE metric presets reach the political board", () => {
  it("carries the authored era values into era-distinct board values", async () => {
    // The political half of each era's overlay is baked into the emitted board
    // at codegen time rather than written to stateMetrics at seed time. If the
    // overlay stopped being applied, every era's board would collapse to the
    // same numbers — which is exactly the regression this guards.
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const boardFor = (preset: string) =>
      NON_PLAYABLE_BOARDS[preset]?.IE?.["DUB"] as Record<string, number> | undefined;
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
