/**
 * The ONE gate for the political-metrics / political-legislation pipeline.
 *
 * Now always true: baselines and law levels resolve by in-game YEAR, so the
 * pipeline is no longer tied to the 1953 seed preset. Playable countries
 * (US/UK/RU/DD) run Political Metrics and the new-generation law book at any
 * preset, and their OLD catalogs are excluded everywhere.
 *
 * Before this, four call sites tested `preset === "1953-default"` independently
 * and drifted — seedPoliticalMetrics was never gated at all, so a non-1953
 * world got political metrics seeded from 1953 baselines alongside the OLD
 * legislation catalog. That split state was the main reason the old and new
 * metric systems kept getting confused for each other.
 *
 * Kept as a function rather than inlined: the four seed gates read it, and the
 * non-playable conversion will need a scope check here rather than a new,
 * drift-prone gate of its own.
 */
import { POLITICAL_METRIC_COUNTRY_IDS } from "./types";

export function isPoliticalPipelinePreset(_preset: string | undefined): boolean {
  return true;
}

/**
 * The `countryScope` values whose OLD legislation catalogs are superseded by
 * the new-generation political law book, and so must never seed.
 *
 * Derived from POLITICAL_METRIC_COUNTRY_IDS rather than written out, because
 * this list was previously duplicated across three seeders — the same
 * copy-and-drift shape that let the preset gates diverge in the first place.
 * `countryScope` is the lowercase form of the country id.
 */
export const POLITICAL_LEGISLATION_EXCLUDED_SCOPES: ReadonlySet<string> = new Set(
  POLITICAL_METRIC_COUNTRY_IDS.map((id) => id.toLowerCase())
);
