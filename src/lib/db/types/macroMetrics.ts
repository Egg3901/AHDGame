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
import type { CrisisEconomicExposure } from "@/lib/livingConflict/rules/economicExposure";

/**
 * Reset persistence contract:
 * - `_id` is the authored region identity and is preserved for current regions;
 *   the finalize pass separately removes obsolete region rows.
 * - `countryId`, `economic`, `population`, and `lastUpdated` are baseline seed
 *   fields rewritten by `writeSplitMetrics` after reset.
 * - Optional runtime fields are cleared by `resetMacroMetricsRuntimeState`
 *   before bootstrap. Optional seed fields are restored only when the incoming
 *   preset authors them, preventing `$set` omissions from retaining old state.
 */
export interface MacroMetricsDoc {
  /** Bounded crisis pressure feeding actual civilian labour and GDP potential. */
  livingConflictExposure?: CrisisEconomicExposure;
  /** stateId, or a national-scope rollup id ("federal", "uk_national", …). */
  _id: string;
  countryId?: string;
  /** V2-only raw cohort owner reading; never reused as a legacy approval metric. */
  resetCohortReading?: {
    asOfTurn: number;
    populationGrowthAnnualized: number;
    realizedTfr: number | null;
    dependencyBurden15To64: number | null;
    periodLifeExpectancy?: number | null;
  };
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
