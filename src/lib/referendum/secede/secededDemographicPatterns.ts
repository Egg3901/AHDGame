/**
 * Resolve the per-macro-region voter-archetype pattern to use when a nation
 * secedes, keyed by the game's reset preset (see GameState.preset). The patterns
 * differentiate sub-region demographics off the live aggregate at secession —
 * see {@link apportionDemographicShares}.
 *
 * Only 1991 and 2019 patterns exist; older/other presets fall back to the
 * nearest of the two (≤1995 → 1991, else 2019).
 */
import type { SecedingCountryId } from "./subRegions";
import type { DemographicPattern } from "./apportionDemographics";
import { SCO_REGION_DEMOGRAPHIC_PATTERNS } from "@/lib/seeds/sco/scoRegionDemographics";
import { WAL_REGION_DEMOGRAPHIC_PATTERNS } from "@/lib/seeds/wal/walRegionDemographics";

type PatternEra = "1991" | "2019";

/** Map a reset-preset id (e.g. "1991-default", "2019-default") to a pattern era. */
export function presetToPatternEra(preset: string | undefined | null): PatternEra {
  const year = Number.parseInt((preset ?? "").slice(0, 4), 10);
  return Number.isFinite(year) && year <= 1995 ? "1991" : "2019";
}

export function getSecededDemographicPattern(
  countryId: SecedingCountryId,
  preset: string | undefined | null
): DemographicPattern | null {
  const era = presetToPatternEra(preset);
  if (countryId === "SCO") return SCO_REGION_DEMOGRAPHIC_PATTERNS[era];
  if (countryId === "WAL") return WAL_REGION_DEMOGRAPHIC_PATTERNS[era];
  return null;
}
