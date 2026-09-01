/**
 * Political Legislation v1 — typed law catalog for the political-metrics system.
 * SSOT pattern mirrors src/lib/politicalMetrics. Spec:
 * docs/superpowers/specs/2026-07-17-political-legislation-design.md (§3).
 */

import type { PoliticalMetricCategoryId, PoliticalMetricId } from "../politicalMetrics/types";

export type LawCountryId = "US" | "UK" | "RU" | "DD" | "DE";
export const LAW_COUNTRY_IDS: readonly LawCountryId[] = ["US", "UK", "RU", "DD"] as const;

export interface LawLevel {
  name: string;
  description: string;
  /** × GDP(scope) */
  gdpCostFraction?: number;
  /** × COST_INCOME_ANCHORS[country] × incomeBandIndex × population(scope) */
  incomeCostFraction?: number;
  /** × GDP(scope) */
  gdpRevenueFraction?: number;
}

/**
 * Tax laws are continuous-rate sliders (ruling #16) in the machinery's EFFECTIVE
 * calibration-rate space — the numbers federalBudget.taxRates stores — never
 * statutory schedules. baselineRate must equal SEED_TAX_RATES_1953[country][taxType].
 */
export interface TaxPolicy {
  scope: "federal" | "state";
  /** FederalTaxRates key; validated against SEED_TAX_RATES_1953's key set. */
  taxType: string;
  minRate: number;
  maxRate: number;
  /** Slider granularity AND the minimum proposable change. */
  step: number;
  baselineRate: number;
  /** Flavor tick labels (LARP texture; no statutory claims). */
  waypoints: Array<{ rate: number; label: string }>;
}

export interface PoliticalLaw {
  /**
   * Stable forever. primaries: "{cc}.{metricId}.primary"; secondaries:
   * "{cc}.sec.{slug}"; tax: "{cc}.tax.{slug}". Country prefix lowercase,
   * metricId/slug camelCase; the countryId FIELD stays uppercase.
   */
  id: string;
  countryId: LawCountryId;
  kind: "primary" | "secondary" | "tax";
  /**
   * primary: exactly one entry, weight 1, metricId matching the id.
   * secondary: 2–5 entries, weights 0.25–0.6. tax: empty in v1.
   * Consumed by the dynamics engine (out of scope here).
   */
  targets: Array<{ metricId: PoliticalMetricId; weight: number }>;
  taxPolicy?: TaxPolicy;
  /** English, LARP-safe: no calendar years, no "current rate" phrasing, no ₳. */
  title: string;
  description: string;
  /** Budget + UI grouping; a primary's category = its metric's category. */
  category: PoliticalMetricCategoryId;
  allowedScope: "national" | "regional" | "both";
  /** §7 authored 1953 enacted level. Program laws only; tax laws omit. */
  baselineLevel?: 0 | 1 | 2 | 3 | 4;
  /**
   * Era existence window, inclusive at both ends. Absent = always active.
   * Political laws carry their OWN windows rather than joining LEGISLATION_ERA,
   * so the era-gate invariant (new-generation ids never appear in the legacy era
   * catalogs, where a tagging sweep could silently zero their budget lines)
   * stays intact — see eraGate.test.ts.
   */
  window?: { from: number; to: number | null };
  /**
   * Year-anchored day-one enacted level, ascending by year. Absent = the scalar
   * baselineLevel applies at every year. Interpolated then rounded to a whole
   * level, clamped at both ends.
   */
  baselineLevelAnchors?: Array<{ year: number; level: 0 | 1 | 2 | 3 | 4 }>;
  /** Program laws: exactly 5, index = enacted level; level 0 = fully repealed. */
  levels?: [LawLevel, LawLevel, LawLevel, LawLevel, LawLevel];
  /**
   * §5.2 † mechanism: overrides BUDGET_KEY_BY_CATEGORY for this law
   * (e.g. UK/RU pension-flavored laws → "statePensions").
   */
  budgetKeyOverride?: string;
  /** RU: post-reform display title, applied only by future gameplay events. */
  reformTitle?: string;
}
