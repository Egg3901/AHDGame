import { describe, expect, it } from "vitest";
import { resolveNationalMetricValue } from "./nationalMetricSource";
import type { MetricConfig } from "@/lib/constants/cabinetMechanicsTypes";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";

function metric(overrides: Partial<MetricConfig>): MetricConfig {
  return {
    category: "economic",
    metricId: "gdpGrowth",
    label: "GDP Growth",
    format: "percent",
    higherIsBetter: true,
    ...overrides,
  };
}

const budget = {
  economicFactors: { inflationRate: 2.82 },
} as unknown as FederalBudget;

const bank = { primeRate: 2 } as unknown as CentralBank;

describe("resolveNationalMetricValue", () => {
  it("reads inflation from the federal budget when source is 'budget'", () => {
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "inflationRate", source: "budget" }),
      nationalMetricsDoc: null,
      stateMetrics: [],
      budget,
      bank,
    });
    expect(value).toBe(2.82);
  });

  it("reads the prime rate from the central bank when source is 'centralBank'", () => {
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "interestRate", source: "centralBank" }),
      nationalMetricsDoc: null,
      stateMetrics: [],
      budget,
      bank,
    });
    expect(value).toBe(2);
  });

  it("does NOT use the stale stateMetrics value for a 'budget'-sourced metric", () => {
    // Live data carries a stale economic.inflationRate (0.043); it must be ignored.
    const nationalMetricsDoc = {
      _id: "cn_national",
      economic: { inflationRate: { value: 0.043 } },
    } as unknown as StateMetrics;
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "inflationRate", source: "budget" }),
      nationalMetricsDoc,
      stateMetrics: [],
      budget,
      bank,
    });
    expect(value).toBe(2.82);
  });

  it("prefers the national stateMetrics doc for the default source", () => {
    const nationalMetricsDoc = {
      _id: "cn_national",
      economic: { gdpGrowth: { value: 1.948 } },
    } as unknown as StateMetrics;
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "gdpGrowth" }),
      nationalMetricsDoc,
      stateMetrics: [],
      budget,
      bank,
    });
    expect(value).toBe(1.948);
  });

  it("falls back to the regional average when no national doc value exists", () => {
    const stateMetrics = [
      { _id: "A", economic: { gdpGrowth: { value: 2 } } },
      { _id: "B", economic: { gdpGrowth: { value: 4 } } },
    ] as unknown as StateMetrics[];
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "gdpGrowth" }),
      nationalMetricsDoc: null,
      stateMetrics,
      budget,
      bank,
    });
    expect(value).toBe(3);
  });

  it("returns 0 when nothing is available", () => {
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "gdpGrowth" }),
      nationalMetricsDoc: null,
      stateMetrics: [],
      budget,
      bank,
    });
    expect(value).toBe(0);
  });

  it("returns 0 for a budget-sourced metric when the budget is missing", () => {
    const value = resolveNationalMetricValue({
      metric: metric({ metricId: "inflationRate", source: "budget" }),
      nationalMetricsDoc: null,
      stateMetrics: [],
      budget: null,
      bank,
    });
    expect(value).toBe(0);
  });
});
