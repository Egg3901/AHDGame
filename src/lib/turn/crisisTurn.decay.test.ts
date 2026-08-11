/**
 * Tests that `decay` effects are skipped in the destructive profit-margin path.
 *
 * Note: MockDb.updateMany is a vi.fn() stub — it does not execute aggregation-pipeline
 * updates in memory. Assertions therefore rely on call-count spies rather than
 * inspecting stored document values.
 */

import { describe, it, expect } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { applyProfitMarginEffectsForTest } from "./crisisTurn";
import type { CrisisEffect } from "@/lib/db/types/crisis";

const baseEffect: Omit<CrisisEffect, "effectType" | "value"> = {
  targetType: "profitMargin",
  metricCategory: null,
  metricField: null,
  sectorType: null,
  strategyId: null,
  label: "x",
};

describe("applyProfitMarginEffects decay skip", () => {
  it("does not call updateMany for decay effects (stored margin is never mutated)", async () => {
    const db = createMockDb();
    const effect: CrisisEffect = { ...baseEffect, effectType: "decay", value: -10 };

    await applyProfitMarginEffectsForTest(db as any, ["S1"], [effect]);

    const updateMany = db.collectionMocks["corporateSectors"]?.updateMany;
    expect(updateMany).toBeUndefined(); // collection was never accessed
    // OR if the collection was lazily created, it was not called
    // Either way: no write happened
  });

  it("does call updateMany for flat effects", async () => {
    const db = createMockDb();
    const effect: CrisisEffect = { ...baseEffect, effectType: "flat", value: -10 };

    await applyProfitMarginEffectsForTest(db as any, ["S1"], [effect]);

    const updateMany = db.collectionMocks["corporateSectors"]?.updateMany;
    expect(updateMany).toBeDefined();
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("does call updateMany for tick effects", async () => {
    const db = createMockDb();
    const effect: CrisisEffect = { ...baseEffect, effectType: "tick", value: -5 };

    await applyProfitMarginEffectsForTest(db as any, ["S1"], [effect]);

    const updateMany = db.collectionMocks["corporateSectors"]?.updateMany;
    expect(updateMany).toBeDefined();
    expect(updateMany).toHaveBeenCalledOnce();
  });
});
