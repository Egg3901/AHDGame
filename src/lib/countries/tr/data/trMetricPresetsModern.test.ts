import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { seedTRBaselines, seedTRStateMetrics } from "@/lib/admin/seed/seedTR";
import { splitMetricsDoc } from "@/lib/macroMetrics/split";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { trStateMetrics } from "./trStateMetrics";
import {
  TR_MODERN_MODELED_MEDIAN_INCOME,
  TR_MODERN_OBSERVED_METRICS,
  trMetricPresetsModern,
} from "./trMetricPresetsModern";

function flatten(metrics: StateMetrics): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [category, entries] of Object.entries(metrics)) {
    if (!entries || typeof entries !== "object" || entries instanceof Date) continue;
    for (const [key, metric] of Object.entries(entries)) {
      if (
        typeof metric === "object" &&
        metric !== null &&
        "value" in metric &&
        typeof metric.value === "number"
      ) {
        values[`${category}.${key}`] = metric.value;
      }
    }
  }
  return values;
}

describe("Turkey modern metric and decay targets", () => {
  it("replaces every historical metric path, including uniform roots, in every region", () => {
    expect(Object.keys(trMetricPresetsModern)).toEqual(trStateMetrics.map((row) => row._id));
    for (const historical of trStateMetrics) {
      const overlay = trMetricPresetsModern[String(historical._id)];
      for (const path of Object.keys(flatten(historical))) {
        expect(Number.isFinite(overlay[path]), `${historical._id}/${path}`).toBe(true);
      }
      expect(Object.values(overlay).every(Number.isFinite)).toBe(true);
      for (const [path, value] of Object.entries(TR_MODERN_OBSERVED_METRICS)) {
        expect(overlay[path], path).toBe(value);
      }
      expect(overlay["economic.medianIncome"]).toBe(TR_MODERN_MODELED_MEDIAN_INCOME);
      expect(overlay["infrastructure.broadbandAccess"]).toBe(85);
    }
  });

  it.each(["1979-default", "1991-default", "1999-default", "2007-default"])(
    "preserves the historical no-overlay selection for %s",
    (preset) => {
      for (const row of trStateMetrics) {
        expect(getRegionMetricPresets("TR", String(row._id), preset)).toBeNull();
      }
    }
  );

  it.each(["2019-default", "2023-default", "2027-default"])(
    "keeps the loader, actual macro writer and all decay targets aligned for %s",
    async (preset) => {
      const memory = createInMemoryDb();
      const db = memory as unknown as Db;
      await seedTRStateMetrics(db, false, () => {}, preset);
      await seedTRBaselines(db, false, () => {}, preset);
      const loaded = loadSeededStateMetrics("TR", preset);
      expect(memory.collection("macroMetrics").docs).toHaveLength(8);
      expect(memory.collection("stateBaselines").docs).toHaveLength(8);
      for (const metrics of loaded) {
        const written = await memory.collection("macroMetrics").findOne({ _id: metrics._id });
        expect(written).toEqual(splitMetricsDoc(metrics).macro);
        const baseline = await memory.collection("stateBaselines").findOne({ _id: metrics._id });
        expect(baseline).not.toBeNull();
        const baselineValues = baseline!.baselines as Record<string, Record<string, number>>;
        for (const [path, value] of Object.entries(flatten(metrics))) {
          const [category, key] = path.split(".");
          expect(baselineValues[category][key], `${preset}/${metrics._id}/${path}`).toBe(value);
        }
        expect(flatten(metrics)).toMatchObject(TR_MODERN_OBSERVED_METRICS);
      }
    }
  );
});
