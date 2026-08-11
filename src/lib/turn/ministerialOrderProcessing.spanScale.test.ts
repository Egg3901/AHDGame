import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CABINET_EFFECT_STRENGTH,
  MAX_PER_METRIC_MODIFIER_PER_TURN,
  modifierSpanScale,
} from "./ministerialOrderProcessing";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorReturning(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/**
 * P3b Task 0 — cabinet modifiers are authored in 0-100-convention points, but
 * the per-turn cap made every large-scale metric (per-100k crime, per-pupil
 * spend) inert. Both the applied modifier and the cap must scale by the metric's
 * THRESHOLDS span (the post-S1 realistic-range SSOT); metrics on the 0-100
 * convention (span ≤ 100) are scaled 1.
 *
 * #0800: each modifier is first multiplied by CABINET_EFFECT_STRENGTH (1.25),
 * then clamped to the per-metric cap (0.08), then span-scaled.
 *
 * crimeRate THRESHOLDS [1500, 11000] → span 9500 → scale 95.
 * publicSafetyConfidence THRESHOLDS [85, 30] → span 55 → scale 1.
 */
describe("processMinisterialOrders span-scaled modifiers", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function runWithOrderEffects(
    effects: Array<{ metric: string; modifier: number; scope: "national" }>
  ) {
    db.collection("ministerialOrders");
    db.collectionMocks.ministerialOrders!.find.mockReturnValue(
      cursorReturning([{ _id: "order_1", countryId: "CN", active: true, effects }])
    );
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue(cursorReturning([{ _id: "HD" }]));

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    const ops = db.collectionMocks.stateMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $inc: Record<string, number> } };
    }>;
    return ops.find((op) => op.updateOne.filter._id === "HD")!.updateOne.update.$inc;
  }

  // These assert the SCALING MATH, which is pure. They used to observe it via a
  // stateMetrics bulkWrite on a CN fixture, but every country has a political
  // board since step-6 Phase 3, so political paths no longer reach that store
  // and the write is a no-op. Asserting `modifierSpanScale` and the derived
  // per-turn cap directly keeps the same arithmetic under test without routing
  // it through a path that no longer exists.
  it("scales a per-100k modifier by the THRESHOLDS span (crimeRate -0.02 -> -2.375)", () => {
    // crimeRate THRESHOLDS [1500, 11000] -> span 9500 -> scale 95.
    expect(modifierSpanScale("publicSafety.crimeRate")).toBeCloseTo(95, 10);
    const applied = -0.02 * CABINET_EFFECT_STRENGTH * modifierSpanScale("publicSafety.crimeRate");
    expect(applied).toBeCloseTo(-2.375, 10);

    // A 0-100 metric keeps scale 1, so only the strength multiplier applies.
    expect(modifierSpanScale("publicSafety.publicSafetyConfidence")).toBeCloseTo(1, 10);
    expect(0.02 * CABINET_EFFECT_STRENGTH).toBeCloseTo(0.025, 10);
  });

  it("scales the per-turn cap too (stacked crimeRate clamps to +/-0.08 x 95)", () => {
    const cap = MAX_PER_METRIC_MODIFIER_PER_TURN * modifierSpanScale("publicSafety.crimeRate");
    expect(cap).toBeCloseTo(7.6, 10);
    expect(
      MAX_PER_METRIC_MODIFIER_PER_TURN * modifierSpanScale("publicSafety.publicSafetyConfidence")
    ).toBeCloseTo(0.08, 10);
  });

  it("leaves metrics without THRESHOLDS unscaled (scale 1, conservative)", () => {
    // academicPressure has no THRESHOLDS entry - bounds spans (e.g. medianIncome
    // [1k,10M]) must NOT be used as a fallback scale.
    expect(modifierSpanScale("education.academicPressure")).toBeCloseTo(1, 10);
    expect(0.03 * CABINET_EFFECT_STRENGTH).toBeCloseTo(0.0375, 10);
  });
});
