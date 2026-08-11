import { describe, expect, it } from "vitest";
import { getMetricDefinition, metricCategories } from "./metricDefinitions";
import { THRESHOLDS } from "@/lib/utils/metricScoring";

/**
 * S1 bounds audit — the 4 negative-capable metrics that lacked an explicit
 * negative `minValue` were silently floored at 0 by processStateMetrics' default
 * `[0,100]` clamp. That made restrictive-immigration laws no-ops and made
 * deficits / negative sentiment impossible to represent (live player-facing bugs).
 */
const NEGATIVE_BOUND_FIXES: Array<{
  categoryId: Parameters<typeof getMetricDefinition>[0];
  metricId: string;
  min: number;
  max: number;
}> = [
  { categoryId: "population", metricId: "populationGrowth", min: -3, max: 5 },
  { categoryId: "population", metricId: "migrationRate", min: -5, max: 5 },
  { categoryId: "mediaInformation", metricId: "socialMediaSentiment", min: -100, max: 100 },
  { categoryId: "governance", metricId: "budgetBalance", min: -100, max: 100 },
];

describe("S1 negative-floor bounds fixes", () => {
  for (const { categoryId, metricId, min, max } of NEGATIVE_BOUND_FIXES) {
    it(`${metricId} declares explicit [${min}, ${max}] bounds`, () => {
      const def = getMetricDefinition(categoryId, metricId);
      expect(def, `${categoryId}.${metricId} should exist`).toBeDefined();
      expect(def!.minValue).toBe(min);
      expect(def!.maxValue).toBe(max);
    });

    it(`${metricId} admits a negative value (not floored at 0)`, () => {
      const def = getMetricDefinition(categoryId, metricId)!;
      // The processStateMetrics clamp is Math.max(minValue ?? 0, ...); with an
      // explicit negative minValue a value of -2 must survive.
      const clamped = Math.max(def.minValue ?? 0, Math.min(def.maxValue ?? 100, -2));
      expect(clamped).toBe(-2);
    });
  }
});

describe("budget-sync — anachronistic metric removed", () => {
  it("does not define futureIrelandFundBalance (FIF est. 2024, after both start dates)", () => {
    expect(getMetricDefinition("governance", "futureIrelandFundBalance")).toBeUndefined();
    const allIds = metricCategories.flatMap((c) => c.metrics.map((m) => m.id));
    expect(allIds).not.toContain("futureIrelandFundBalance");
  });
});

/**
 * S1 completion — EVERY metric must declare explicit bounds, not rely on the
 * `[0,100]` default in `processStateMetrics`. The default silently clamped
 * above-100 metrics (educationSpending, preventableMortality, violentCrimeRate)
 * to 100 every turn. This guard prevents any future metric from regressing.
 */
describe("S1 metric bounds completeness", () => {
  it("every metric defines explicit minValue and maxValue", () => {
    const missing: string[] = [];
    for (const category of metricCategories) {
      for (const metric of category.metrics) {
        const hasMin = typeof (metric as { minValue?: number }).minValue === "number";
        const hasMax = typeof (metric as { maxValue?: number }).maxValue === "number";
        if (!hasMin || !hasMax) {
          missing.push(
            `${category.id}.${metric.id}${hasMin ? "" : " [no min]"}${hasMax ? "" : " [no max]"}`
          );
        }
      }
    }
    expect(missing, `metrics missing explicit bounds:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every metric has minValue < maxValue", () => {
    const bad: string[] = [];
    for (const category of metricCategories) {
      for (const metric of category.metrics) {
        const m = metric as { minValue?: number; maxValue?: number };
        if (
          typeof m.minValue === "number" &&
          typeof m.maxValue === "number" &&
          m.minValue >= m.maxValue
        ) {
          bad.push(`${category.id}.${metric.id} (${m.minValue} >= ${m.maxValue})`);
        }
      }
    }
    expect(bad, `metrics with non-ascending bounds:\n${bad.join("\n")}`).toEqual([]);
  });
});

/**
 * A metric's bounds must CONTAIN its realistic operating range (THRESHOLDS
 * [worst,best]); otherwise the engine clamps legitimate derived/seeded values
 * (e.g. a 100-centered index like testPerformance/costOfLiving floored at 100).
 * The allow-list below are PRE-EXISTING violations (bounds predate S1).
 * uninsuredRate was fixed with P2b; crimeRate/incarcerationRate with P3a.
 * incomeInequality is fixed by the P3a Gini-100 rescale. No NEW violations
 * allowed; this set should reach empty.
 */
const KNOWN_PREEXISTING_CONTAINMENT_VIOLATIONS = new Set<string>([]);

describe("S1 bounds contain the THRESHOLDS realistic range", () => {
  it("no metric clamps its own THRESHOLDS span (except documented pre-existing)", () => {
    const violations: string[] = [];
    for (const category of metricCategories) {
      for (const metric of category.metrics) {
        const t = THRESHOLDS[metric.id];
        const m = metric as { minValue?: number; maxValue?: number };
        if (!t || typeof m.minValue !== "number" || typeof m.maxValue !== "number") continue;
        const lo = Math.min(t.best, t.worst);
        const hi = Math.max(t.best, t.worst);
        if (
          (lo < m.minValue || hi > m.maxValue) &&
          !KNOWN_PREEXISTING_CONTAINMENT_VIOLATIONS.has(metric.id)
        ) {
          violations.push(
            `${category.id}.${metric.id}: bounds [${m.minValue},${m.maxValue}] vs THRESHOLDS [${lo},${hi}]`
          );
        }
      }
    }
    expect(violations, `bounds clamp their THRESHOLDS span:\n${violations.join("\n")}`).toEqual([]);
  });
});

describe("IS_HIGHER_BETTER derives from the definitions SSOT (P6a)", () => {
  it("covers every defined metric with the defs' direction", async () => {
    const { IS_HIGHER_BETTER } = await import("@/lib/utils/metricScoring");
    for (const category of metricCategories) {
      for (const metric of category.metrics) {
        expect(IS_HIGHER_BETTER[metric.id], metric.id).toBe(metric.isHigherBetter);
      }
    }
    // The 24-metric inversion class is dead: spot the worst offenders.
    expect(IS_HIGHER_BETTER["childPoverty"]).toBe(false);
    expect(IS_HIGHER_BETTER["knifeCrimeRate"]).toBe(false);
    expect(IS_HIGHER_BETTER["housingAffordability"]).toBe(false);
    expect(IS_HIGHER_BETTER["nhsWaitingTime"]).toBe(false);
    expect(IS_HIGHER_BETTER["stateMediaControl"]).toBe(false);
  });
});
