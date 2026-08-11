// ─── Metric definitions ───────────────────────────────────────────────────────
// Thin adapter over `src/lib/constants/metricDefinitions.ts` — the single
// source of truth. Keeps the historical `MetricDef` shape and `ALL_METRIC_DEFS`
// name expected by the detail page + layout.

import {
  METRIC_DEFS_BY_CATEGORY,
  CATEGORY_LABELS as SHARED_CATEGORY_LABELS,
  type MetricDefinition,
} from "@/lib/constants/metricDefinitions";

export interface MetricDef {
  name: string;
  description: string;
  formatPrefix?: string;
  formatSuffix?: string;
  decimals?: number;
  isHigherBetter: boolean;
  /** Per-region display-name overrides — kept so the detail page header can
   *  show "Reunification Desire" in NIR while the base name stays generic. */
  regionDisplayNames?: Record<string, string>;
}

function toMetricDef(def: MetricDefinition): MetricDef {
  return {
    name: def.name,
    description: def.description,
    formatPrefix: def.formatPrefix,
    formatSuffix: def.formatSuffix,
    decimals: def.decimals,
    isHigherBetter: def.isHigherBetter,
    regionDisplayNames: def.regionDisplayNames,
  };
}

export const ALL_METRIC_DEFS: Record<string, Record<string, MetricDef>> = Object.fromEntries(
  Object.entries(METRIC_DEFS_BY_CATEGORY).map(([categoryId, metrics]) => [
    categoryId,
    Object.fromEntries(Object.entries(metrics).map(([id, def]) => [id, toMetricDef(def)])),
  ])
);

export const CATEGORY_LABELS: Record<string, string> = SHARED_CATEGORY_LABELS;

// ─── API data types ────────────────────────────────────────────────────────────

export interface AffectingPolicy {
  name: string;
  policyOptionName?: string;
  pushesMetricUp: boolean;
  weight: number;
  scope: "state" | "national";
}

export interface MetricDetailData {
  stateId: string;
  stateName: string;
  category: string;
  metricId: string;
  value: number;
  trend?: number;
  nationalAverage?: number;
  globalAverage?: number;
  tickRate?: number;
  history: Array<{ turn: number; value: number }>;
  affectingPolicies?: AffectingPolicy[];
}
