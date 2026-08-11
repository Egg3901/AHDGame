import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";

/**
 * Weight-sign convention invariant.
 *
 * In effectTargetsWeighted entries, weight sign is polarity-relative:
 * positive = beneficial for the metric given its isHigherBetter flag in the
 * metric definitions. A negative weight therefore intentionally harms the metric.
 *
 * Most metrics have mixed signs (deliberate trade-offs), but heavily lopsided
 * outliers are likely sign errors. This test triages a known outlier set and
 * asserts their minority-sign counts do not grow. It also prints a report of
 * all mixed-sign metrics for manual review.
 *
 * Snapshot generated from the seed aggregate on 2026-07-16.
 */

interface WeightedTarget {
  metricCategoryId: string;
  metricId: string;
  weight: number;
  lawId: string;
  countryScope: string;
}

interface MetricSignDistribution {
  metricCategoryId: string;
  metricId: string;
  positive: number;
  negative: number;
}

interface OutlierSnapshot {
  metricCategoryId: string;
  metricId: string;
  minoritySign: "positive" | "negative";
  minorityCount: number;
}

/**
 * Known lopsided outliers. Minority-sign counts are literal snapshots; the test
 * fails if any outlier's minority count increases. Decreases are allowed (fixes
 * landing) but should be followed by updating the snapshot.
 */
const OUTLIER_SNAPSHOTS: OutlierSnapshot[] = [
  {
    metricCategoryId: "governance",
    metricId: "budgetBalance",
    minoritySign: "positive",
    minorityCount: 29, // +2: fi_state_enterprises / fi_welfare_state mirror the TR/GR/AT pattern
  },
  {
    metricCategoryId: "economic",
    metricId: "economicFreedom",
    minoritySign: "positive",
    minorityCount: 19, // +2: br_corporate_tax / br_iap_contribution mirror the FR/TR pattern
  },
  {
    metricCategoryId: "economic",
    metricId: "medianIncome",
    minoritySign: "negative",
    minorityCount: 1,
  },
  {
    metricCategoryId: "social",
    metricId: "socialMobility",
    minoritySign: "negative",
    minorityCount: 2,
  },
  {
    metricCategoryId: "governance",
    metricId: "publicTrust",
    minoritySign: "negative",
    minorityCount: 1,
  },
  {
    metricCategoryId: "economic",
    metricId: "unemploymentRate",
    minoritySign: "negative",
    minorityCount: 6,
  },
];

function collectWeightedTargets(): WeightedTarget[] {
  const targets: WeightedTarget[] = [];

  for (const lt of legislationTypes as any[]) {
    const countryScope = lt.countryScope ?? "unknown";
    const lawId = lt._id;

    for (const t of lt.effectTargetsWeighted ?? []) {
      targets.push({
        metricCategoryId: t.metricCategoryId,
        metricId: t.metricId,
        weight: t.weight,
        lawId,
        countryScope,
      });
    }
  }

  return targets;
}

function computeDistributions(targets: WeightedTarget[]): MetricSignDistribution[] {
  const map = new Map<string, MetricSignDistribution>();

  for (const t of targets) {
    const key = `${t.metricCategoryId}.${t.metricId}`;
    let dist = map.get(key);
    if (!dist) {
      dist = {
        metricCategoryId: t.metricCategoryId,
        metricId: t.metricId,
        positive: 0,
        negative: 0,
      };
      map.set(key, dist);
    }
    if (t.weight > 0) dist.positive++;
    else if (t.weight < 0) dist.negative++;
  }

  return Array.from(map.values()).sort((a, b) => {
    const aMinority = Math.min(a.positive, a.negative);
    const bMinority = Math.min(b.positive, b.negative);
    return aMinority - bMinority;
  });
}

function isHigherBetter(metricCategoryId: string, metricId: string): boolean {
  return (
    getMetricDefinition(metricCategoryId as MetricCategoryId, metricId)?.isHigherBetter ?? true
  );
}

describe("seed invariant: weight-sign outliers", () => {
  const targets = collectWeightedTargets();
  const distributions = computeDistributions(targets);
  const mixedSignDistributions = distributions.filter((d) => d.positive > 0 && d.negative > 0);

  it("prints a report of all mixed-sign metrics", () => {
    const report = mixedSignDistributions.map((d) => {
      const minority = Math.min(d.positive, d.negative);
      const majority = Math.max(d.positive, d.negative);
      const minoritySign = d.positive < d.negative ? "positive" : "negative";
      return {
        metric: `${d.metricCategoryId}.${d.metricId}`,
        isHigherBetter: isHigherBetter(d.metricCategoryId, d.metricId),
        positive: d.positive,
        negative: d.negative,
        minoritySign,
        minorityCount: minority,
        majorityCount: majority,
      };
    });

    console.log(
      `\nMixed-sign metrics in effectTargetsWeighted (${report.length} metrics, ${targets.length} targets):`
    );

    console.table(report);
  });

  for (const snapshot of OUTLIER_SNAPSHOTS) {
    const dist = distributions.find(
      (d) => d.metricCategoryId === snapshot.metricCategoryId && d.metricId === snapshot.metricId
    );

    it(`${snapshot.metricCategoryId}.${snapshot.metricId}: minority-sign (${snapshot.minoritySign}) count must not exceed ${snapshot.minorityCount}`, () => {
      expect(
        dist,
        `metric ${snapshot.metricCategoryId}.${snapshot.metricId} not found in distributions`
      ).toBeTruthy();
      const actualMinority = snapshot.minoritySign === "positive" ? dist!.positive : dist!.negative;
      expect(actualMinority).toBeLessThanOrEqual(snapshot.minorityCount);
    });
  }
});
