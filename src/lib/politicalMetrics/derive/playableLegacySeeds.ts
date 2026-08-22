/**
 * The legacy StateMetrics each playable country ACTUALLY SEEDS under
 * `1953-default`, flattened for the board derivation.
 *
 * Not "the 1953 file": three of the four countries reach their 1953 values by a
 * different route, and the UK reaches them only via applyEra1953Adjustments --
 * ukStateMetrics.ts itself is authored at MODERN levels (London medianIncome
 * 42,000, broadbandAccess 97). Deriving from the raw file would score 1953
 * London against modern broadband.
 *
 * Mirrors: seedRegionMetrics.ts (US), seedUK.ts (UK), seedRU.ts (RU),
 * seedDD.ts (DD). If any of those changes its source, this must follow.
 *
 * OFFLINE USE ONLY -- feeds a codegen script whose output is committed.
 */
import type { StateMetrics } from "@/lib/db/types";
import { stateMetrics1953 } from "@/lib/seeds/reference/stateMetrics1953";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import { ruStateMetrics } from "@/lib/seeds/ru/ruStateMetrics";
import { ddStateMetrics1953 } from "@/lib/seeds/dd/ddStateMetrics1953";
import { applyEra1953Adjustments } from "@/lib/seeds/reference/stateMetricsEra1953";

export type PlayableCountryId = "US" | "UK" | "RU" | "DD";

export interface RegionLegacySeed {
  regionId: string;
  /** Political-half paths, "category.metricId" -> value. */
  legacy: Record<string, number>;
  /** Macro-owned paths (economic, population). */
  macro: Record<string, number>;
}

/** Categories macroMetrics owns; the board never derives them from `legacy`. */
const MACRO_CATEGORIES = new Set(["economic", "population"]);
const NON_CATEGORY_KEYS = new Set(["_id", "countryId", "lastUpdated"]);

function flatten(doc: StateMetrics): RegionLegacySeed {
  const legacy: Record<string, number> = {};
  const macro: Record<string, number> = {};
  for (const [category, block] of Object.entries(doc as unknown as Record<string, unknown>)) {
    if (NON_CATEGORY_KEYS.has(category)) continue;
    if (!block || typeof block !== "object") continue;
    const target = MACRO_CATEGORIES.has(category) ? macro : legacy;
    for (const [metricId, cell] of Object.entries(block as Record<string, { value?: number }>)) {
      const value = cell?.value;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      target[`${category}.${metricId}`] = value;
    }
  }
  return { regionId: String(doc._id), legacy, macro };
}

function sourceFor(countryId: PlayableCountryId): StateMetrics[] {
  switch (countryId) {
    case "US":
      return stateMetrics1953.filter((d) => d.countryId === "US");
    case "UK":
      // seedUK.ts applies the era adjuster; the raw file is modern.
      return ukStateMetrics.map(applyEra1953Adjustments);
    case "RU":
      // seedRU.ts applies NO era adjuster - ruStateMetrics is authored at 1953.
      return ruStateMetrics;
    case "DD":
      return ddStateMetrics1953;
  }
}

export function playableRegionSeeds1953(countryId: PlayableCountryId): RegionLegacySeed[] {
  return sourceFor(countryId).map(flatten);
}
