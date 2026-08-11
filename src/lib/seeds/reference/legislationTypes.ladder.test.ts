import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { isMonotoneLadder } from "@/lib/legislature/optionIntensity";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";

/**
 * Ladders whose effectDirection is INTENTIONALLY non-monotone (documented design),
 * so optionIntensity's monotone-ladder assumption does not apply. Keep this list
 * tiny and each entry justified — a new non-monotone ladder is almost always a
 * theme-vs-rate seed bug, not a deliberate horseshoe.
 */
const INTENTIONAL_NON_MONOTONE = new Set<string>([
  // ie_customs_tariff_rate: explicitly a political horseshoe — low/zero = EU free-trade
  // centre, mid = industrial-policy left, very high = sovereignty/anti-EU right (see the
  // type's `explanation`). Its metric-direction modelling is a PRE-EXISTING, separate
  // concern (tariff effect on tradeBalance should track rate, not political framing).
  "ie_customs_tariff_rate",
]);

describe("legislation seed integrity (#0962)", () => {
  it("every policy-option ladder is monotone in effectDirection", () => {
    const bad: string[] = [];
    for (const lt of legislationTypes) {
      if (INTENTIONAL_NON_MONOTONE.has(lt._id)) continue;
      if (lt.policyOptions?.length && !isMonotoneLadder(lt.policyOptions)) bad.push(lt._id);
    }
    expect(bad).toEqual([]);
  });

  it("every effectTargetsWeighted metric resolves in metricDefinitions", () => {
    const bad: string[] = [];
    for (const lt of legislationTypes) {
      for (const t of lt.effectTargetsWeighted ?? []) {
        if (!getMetricDefinition(t.metricCategoryId as MetricCategoryId, t.metricId)) {
          bad.push(`${lt._id}:${t.metricCategoryId}.${t.metricId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("uk_government_ethics targets the governmentTransparency ROOT, not the corruptionIndex readout (#0962 #5)", () => {
    // corruptionIndex is engine-derived from governmentTransparency (§4.7); targeting
    // both double-counts. The anti-corruption law drives corruption DOWN via the
    // transparency root, and the graded-chip fix surfaces that on same-side bills.
    const ethics = legislationTypes.find((l) => l._id === "uk_government_ethics");
    const metrics = ethics?.effectTargetsWeighted?.map((t) => t.metricId) ?? [];
    expect(metrics).toContain("governmentTransparency");
    expect(metrics).not.toContain("corruptionIndex");
  });
});
