import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";

/**
 * Economic sign invariants for tax legislation, validated against the runtime
 * sign math in policyEffects.ts. A weighted target moves a metric's displayed
 * VALUE up exactly when
 *   effectDirection × weight × (isHigherBetter ? 1 : -1) > 0.
 *
 * These guard against the recurring "inverted weight on a lower-is-better
 * metric" bug — where a positive weight on cost of living / poverty /
 * inequality / unemployment silently encodes an economically-backwards effect,
 * compounded by the fact that consumption taxes (salesTax, tariffs) use an
 * INVERTED rate↔stance axis (high rate = right) versus income/corporate/payroll
 * taxes (high rate = left). The weightedTargets helper hard-codes the primary
 * target to +1.0, which is wrong whenever the intended primary is a
 * lower-is-better metric on a consumption tax.
 */

type Dir = "up" | "down";

/** What the metric's VALUE should do at the bill's HIGHEST-rate option. */
const INVARIANTS: { taxTypes: string[]; metric: string; atHighRate: Dir; why: string }[] = [
  // Consumption taxes are levied on purchases → raise retail prices and hit the
  // poor hardest. Higher rate ⇒ cost of living UP, poverty UP.
  {
    taxTypes: ["salesTax", "tariffs"],
    metric: "costOfLiving",
    atHighRate: "up",
    why: "consumption tax raises consumer prices",
  },
  {
    taxTypes: ["salesTax"],
    metric: "povertyRate",
    atHighRate: "up",
    why: "regressive consumption tax worsens poverty",
  },
  // Consumption tax raises food costs → worse food outcomes at higher rates.
  {
    taxTypes: ["salesTax"],
    metric: "foodInsecurity",
    atHighRate: "up",
    why: "consumption tax raises food costs, worsening food insecurity",
  },
  {
    taxTypes: ["salesTax"],
    metric: "foodSecurity",
    atHighRate: "down",
    why: "consumption tax raises food costs, reducing food security",
  },
  // Progressive direct taxes compress inequality at higher rates.
  {
    taxTypes: ["incomeTax"],
    metric: "incomeInequality",
    atHighRate: "down",
    why: "progressive income tax reduces inequality",
  },
  {
    taxTypes: ["domesticCorporateTax"],
    metric: "incomeInequality",
    atHighRate: "down",
    why: "corporate tax falls on capital owners, reducing inequality",
  },
  // Taxes on labour/capital raise unemployment at higher rates.
  {
    taxTypes: ["domesticCorporateTax", "payrollTax"],
    metric: "unemploymentRate",
    atHighRate: "up",
    why: "higher tax on hiring/capital raises unemployment",
  },
  // Transaction taxes suppress business formation at higher rates.
  {
    taxTypes: ["stampDuty"],
    metric: "smallBusinessFormation",
    atHighRate: "down",
    why: "transaction tax suppresses business formation",
  },
];

function valueDirectionAtHighestRate(
  lt: any,
  target: { metricCategoryId: string; metricId: string; weight: number }
): Dir | "flat" {
  const opts = (lt.policyOptions ?? []).filter((o: any) => typeof o.rate === "number");
  const hi = opts.reduce((a: any, b: any) => (b.rate > a.rate ? b : a));
  const isHigherBetter =
    getMetricDefinition(target.metricCategoryId as MetricCategoryId, target.metricId)
      ?.isHigherBetter ?? true;
  const effectSign = isHigherBetter ? 1 : -1;
  const contribution = (hi.effectDirection ?? 0) * target.weight * effectSign;
  return contribution > 0 ? "up" : contribution < 0 ? "down" : "flat";
}

describe("tax legislation: economic sign invariants", () => {
  for (const inv of INVARIANTS) {
    const bills = (legislationTypes as any[]).filter(
      (lt) =>
        inv.taxTypes.includes(lt.taxRateChange?.taxType) &&
        (lt.effectTargetsWeighted ?? []).some((t: any) => t.metricId === inv.metric)
    );

    describe(`${inv.taxTypes.join("/")} · ${inv.metric} (${inv.why})`, () => {
      for (const lt of bills) {
        const target = (lt.effectTargetsWeighted as any[]).find((t) => t.metricId === inv.metric);
        it(`${lt._id}: highest rate pushes ${inv.metric} ${inv.atHighRate}`, () => {
          expect(valueDirectionAtHighestRate(lt, target)).toBe(inv.atHighRate);
        });
      }
    });
  }
});
