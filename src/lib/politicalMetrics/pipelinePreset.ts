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
import {
  REDISTRICT_AUTHORITY_LAW,
  REDISTRICT_COMPACTNESS_LAW,
  REDISTRICT_FAIRNESS_LAW,
} from "@/lib/redistricting/caps";
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

/**
 * Old-catalog `_id`s that survive the exclusion sweep above.
 *
 * The three US state redistricting levers are mechanical who-may-draw switches,
 * not metric-moving programs: `src/lib/redistricting/caps.ts` reads them BY ID
 * out of `statePolicies` and turns the enacted option INDEX into the caps the
 * map editor enforces. The new-generation law book has no equivalent — a
 * `PoliticalLaw` is a five-level program with a political-metric target, which
 * a three-option authority switch is not — so excluding them by `countryScope`
 * took the whole system's only lever off the board (ticket #1189): every state
 * sat on the index-1 default (bipartisan commission, `canDraw: false`) with no
 * proposable bill able to move it.
 *
 * Sourced from caps.ts rather than written out so the retained set and the
 * consumer can never drift apart.
 */
export const POLITICAL_LEGISLATION_RETAINED_OLD_IDS: ReadonlySet<string> = new Set([
  REDISTRICT_AUTHORITY_LAW,
  REDISTRICT_COMPACTNESS_LAW,
  REDISTRICT_FAIRNESS_LAW,
]);

/**
 * Whether an old-generation legislation type must not seed.
 *
 * The ONE place the exclusion is decided. The three seeders that apply it
 * (`runCoreSeed`, `seedLegislationTypes`, `seedStatePolicies`) previously each
 * tested `EXCLUDED_SCOPES.has(countryScope ?? "us")` inline — the same
 * copy-and-drift shape this module already exists to prevent — so a carve-out
 * added to one would silently miss the others.
 */
export function isOldLegislationTypeExcluded(lt: { _id: string; countryScope?: string }): boolean {
  if (POLITICAL_LEGISLATION_RETAINED_OLD_IDS.has(lt._id)) return false;
  return POLITICAL_LEGISLATION_EXCLUDED_SCOPES.has(lt.countryScope ?? "us");
}
