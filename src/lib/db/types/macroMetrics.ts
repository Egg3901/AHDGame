/**
 * SP5 macro re-homing — the macro layer's own store (spec §2).
 *
 * `macroMetrics` holds the economy engine's working state for EVERY country
 * (global re-home, spec ruling 1): the `economic.*` and `population.*`
 * categories, the UK devolution mechanic `independenceDesire`, and the
 * `economicModel` classification. Per-metric records keep the exact
 * StateMetricValue shape and the exact path strings — reader ports are a
 * collection-and-type swap, never a data-model rewrite.
 *
 * `stateMetrics` continues to exist for NON-playable countries' political
 * categories only (NPC scaffolding, SP4 ruling); playable countries have no
 * stateMetrics docs at all.
 */
import type { EconomicModelState } from "@/lib/constants/economicModels";
import type { StateMetrics, StateMetricValue } from "./stateMetrics";

export interface MacroMetricsDoc {
  /** stateId, or a national-scope rollup id ("federal", "uk_national", …). */
  _id: string;
  countryId?: string;
  economic: StateMetrics["economic"];
  population: StateMetrics["population"];
  /**
   * UK devolution mechanic state (drift-owned; SCO/WAL/NIR). Formerly
   * stateMetrics governance.independenceDesire — hoisted to a top-level field
   * so playable stateMetrics genuinely reaches zero.
   */
  independenceDesire?: StateMetricValue;
  /**
   * Objective fiscal state synced from the federal budget each turn. Lives here
   * rather than on the political side because it is measured, not judged — and
   * because the political store stopped being written once every country had a
   * board. See MACRO_GOVERNANCE_PATHS.
   */
  governance?: { budgetBalance?: StateMetricValue; debtToGdp?: StateMetricValue };
  /** Economic-model classification (economicModelTurn's field, P7). */
  economicModel?: EconomicModelState;
  lastUpdated: Date;
}

/**
 * Per-region macro history series (the economic/population slice formerly in
 * stateMetricHistory): `{ _id, "economic": { gdpGrowth: [{turn,value},…] } }`.
 * Kept loose like MetricHistoryDoc — paths mirror the doc paths.
 */
export interface MacroMetricsHistoryDoc {
  _id: string;
  [key: string]: unknown;
}
