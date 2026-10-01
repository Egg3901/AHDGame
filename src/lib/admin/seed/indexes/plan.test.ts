import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { collectSeedIndexPlan, findMissingSeedIndexes, isTextIndex, isTtlIndex } from "./plan";

describe("collectSeedIndexPlan (#2699)", () => {
  it("captures the seed indexes without a database", async () => {
    const plan = await collectSeedIndexPlan();
    expect(plan.length).toBeGreaterThan(300);
    const names = new Set(plan.map((entry) => entry.options.name));
    expect(names.has("macroTelemetry_world_country_region_metric_turn_unique")).toBe(true);
    expect(names.has("financialTxLog_counterpartyId_id")).toBe(true);
    expect(plan.some(isTextIndex)).toBe(true);
    expect(plan.some(isTtlIndex)).toBe(true);
  });

  it("reports only indexes whose key is absent on the live collection", async () => {
    const plan = [
      { collection: "a", key: { x: 1 }, options: { name: "a_x" } },
      { collection: "a", key: { y: 1 }, options: { name: "a_y" } },
      { collection: "b", key: { z: 1 }, options: { name: "b_z" } },
    ];
    const db = {
      collection: (name: string) => ({
        indexes: async () =>
          name === "a" ? [{ key: { _id: 1 } }, { key: { x: 1 }, name: "renamed" }] : [],
      }),
    } as unknown as Db;
    const missing = await findMissingSeedIndexes(db, plan);
    expect(missing.map((entry) => entry.options.name)).toEqual(["a_y", "b_z"]);
  });
});
