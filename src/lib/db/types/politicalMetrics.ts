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
   * Folded each turn from the cabinet contribution snapshot (national standing
   * effects plus this region's sited extras); decays back to ≈0 when the
   * cabinet stops applying the effect.
   */
  cabinetResiduals?: Record<PoliticalMetricId, number>;
  /**
   * The same offset split by the channel that produced it (orders, tier
   * settings, military, estates, energy, infrastructure), ticket #1129. The cap
   * is applied per channel here, and `cabinetResiduals` above is the sum, so a
   * saturated order book can no longer make a newly built estate worth zero.
   *
   * Absent on docs written before the split: the turn phase seeds it from the
   * flat field on first fold, so no migration is needed and no value jumps.
   */
  cabinetResidualsBySource?: Record<string, Record<PoliticalMetricId, number>>;
  /**
   * The labour-relations offset applied to this region's target this turn (the
   * strike/settlement channel, `src/lib/unions/labourRelationsPoliticalProvider.ts`).
   * Persisted for the same reason `cabinetResiduals` is: an offset that moves
   * the board must be inspectable, or a strike wave shifts national politics
   * with no traceable cause. Unlike the cabinet channel this one does NOT
   * accumulate here — the provider already decays it from the dispute or
   * settlement turn — so this field is a per-turn snapshot of what was applied,
   * country-wide and therefore identical across a country's regions. Absent or
   * empty means the channel contributed nothing.
   */
  labourResiduals?: Record<PoliticalMetricId, number>;
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

/**
 * Per-region trend history: one doc per REGION, a snapshot appended on the same
 * HISTORY_CADENCE_TURNS as the national series and capped at
 * REGION_HISTORY_MAX_ENTRIES. Issue #1322.
 *
 * One doc per region rather than per country: a country doc holding all 51 US
 * regions at the cap reaches roughly 9.6MB, uncomfortably close to the 16MB
 * BSON ceiling. Per-region docs have no such cliff.
 *
 * There is NO backfill and there cannot be one — the series has never been
 * recorded, and synthesising it from current values would invent history. The
 * region trend tiles therefore read "series begins this campaign" until a
 * region has two entries, exactly as the national tiles do today.
 */
export interface PoliticalMetricsRegionHistoryDoc {
  /** Region id as seeded in `states` (e.g. US "GA", UK "LON", RU "CEN"). */
  _id: string;
  countryId: CountryId;
  entries: Array<{ turn: number; values: Record<PoliticalMetricId, number> }>;
  updatedAt: Date;
}
