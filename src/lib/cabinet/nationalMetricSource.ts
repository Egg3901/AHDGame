import type { MetricConfig } from "@/lib/constants/cabinetMechanicsTypes";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";

/**
 * Resolves the national-scope value for a single cabinet stat-strip metric.
 *
 * Most metrics come from the `stateMetrics` collection (national-scope doc, else
 * the population-blind regional average). A handful of macro indicators are
 * maintained canonically elsewhere — declared via `metric.source` — and must be
 * read from their own home so the cabinet strip matches the dedicated pages:
 *   - `budget`      → `federalBudget.economicFactors.*`  (inflationRate)
 *   - `centralBank` → the `centralBanks` document         (interestRate → primeRate)
 *
 * `stateMetrics.economic.inflationRate` exists in some legacy docs but is stale
 * and never updated by the turn engine; `interestRate` was never stored there at
 * all. Sourcing from `stateMetrics` for these two yields 0.0% on the page.
 *
 * Always returns a number (0 when nothing is available), matching the prior
 * behaviour of the briefing route.
 */

/** metricId → reader for `budget`-sourced metrics. */
const BUDGET_METRIC_READERS: Record<string, (budget: FederalBudget) => number | undefined> = {
  inflationRate: (budget) => budget.economicFactors?.inflationRate,
};

/** metricId → reader for `centralBank`-sourced metrics. */
const CENTRAL_BANK_METRIC_READERS: Record<string, (bank: CentralBank) => number | undefined> = {
  interestRate: (bank) => bank.primeRate,
};

function readStateMetric(
  doc: StateMetrics | null | undefined,
  category: string,
  metricId: string
): number | undefined {
  const cat = doc?.[category as keyof StateMetrics] as
    Record<string, { value?: number }> | undefined;
  return cat?.[metricId]?.value;
}

export function resolveNationalMetricValue(params: {
  metric: MetricConfig;
  nationalMetricsDoc: StateMetrics | null;
  stateMetrics: StateMetrics[];
  budget: FederalBudget | null;
  bank: CentralBank | null;
}): number {
  const { metric, nationalMetricsDoc, stateMetrics, budget, bank } = params;
  const source = metric.source ?? "stateMetrics";

  if (source === "budget") {
    const value = budget ? BUDGET_METRIC_READERS[metric.metricId]?.(budget) : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  if (source === "centralBank") {
    const value = bank ? CENTRAL_BANK_METRIC_READERS[metric.metricId]?.(bank) : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  // Default: stateMetrics. Prefer the precomputed national doc, else regional average.
  const nationalValue = readStateMetric(nationalMetricsDoc, metric.category, metric.metricId);
  if (typeof nationalValue === "number") {
    return nationalValue;
  }

  const values = stateMetrics
    .map((sm) => readStateMetric(sm, metric.category, metric.metricId))
    .filter((v): v is number => v !== undefined);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
