import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";

/**
 * Political Metrics — one doc per region, fully separate from `stateMetrics`
 * (the legacy approval path scores every metric present on a stateMetrics doc;
 * a separate collection makes "old system untouched" structural).
 * Values are 0–100 objective performance scores, drifted each turn by the SP2
 * dynamics phase toward their law-implied targets.
 */
export interface PoliticalMetricsDoc {
  /** Region id as seeded in `states` (e.g. US "MA", UK "LON", RU "CEN"). */
  _id: string;
  /**
   * Any country with a board — the four anchor-seeded playables plus the
   * derived non-playables. NOT `PoliticalMetricsCountryId`, which means "has
   * authored baseline anchors" and is still just the four.
   */
  countryId: CountryId;
  values: Record<PoliticalMetricId, number>;
  /**
   * SP2 structural residual (dynamics spec §4): the permanent per-metric gap
   * between this region's character and its law-implied target. Set once at
   * reset (seed − dayOneTarget), moved by nothing in SP2 — the hook where
   * future events attach. Missing (pre-SP2 docs) ⇒ the dynamics phase lazily
   * self-heals it to `value − composedLawTarget` on first touch.
   */
  residuals?: Record<PoliticalMetricId, number>;
  /**
   * Accumulating, decaying offset from standing cabinet effects (the momentum
   * driver channel). Separate from `residuals` (day-one equilibrium) so the
   * baseline is never touched; composeTarget adds this on top of `residuals`.
   * Folded each turn from the per-country cabinet contribution snapshot; decays
   * back to ≈0 when the cabinet stops applying the effect.
   */
  cabinetResiduals?: Record<PoliticalMetricId, number>;
  lastUpdated: Date;
}

/**
 * SP2 trend history (dynamics spec §5): one doc per country; a national
 * aggregate snapshot appended every 24 turns, capped at 365 entries.
 */
export interface PoliticalMetricsHistoryDoc {
  /** Country id ("US" | "UK" | "RU"). */
  _id: string;
  entries: Array<{ turn: number; values: Record<PoliticalMetricId, number> }>;
  updatedAt: Date;
}
