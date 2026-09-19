/**
 * 1991-era demographic adjustments derived from the 2019 per-country
 * demographics datasets. Applied at seed time by each country's
 * `seedXDemographics` function (and `runCoreSeed` for US) when the active
 * preset is `1991-default`.
 *
 * Mirrors the approach in `stateMetrics1991.ts` — a deep-clone + per-group
 * `population` multiplier rather than a separately-curated 1991 dataset.
 * Lets each country opt into the era shift without forking the existing
 * per-region files.
 *
 * Per-country multipliers reflect demographic-cohort shares that shifted
 * meaningfully between 1991 and 2020:
 *
 *   US — 1990 Census Hispanic share 9% (vs ~18% in 2020), Asian 3% (vs 6%),
 *     bachelor's-degree rate 21% (vs ~38%), union density 16% (vs 10%).
 *
 *   UK — Pre-mass-immigration (~5% non-white in 1991 vs ~14% in 2020),
 *     pre-NewLabour identity politics, Right-to-Buy era home-ownership
 *     surge, manufacturing still ~22% of GDP (vs ~10% in 2020).
 *
 *   JP — Pre-Womenomics (much smaller working-mothers cohort), pre-aging
 *     wave (post-1995 cohort shift), bubble-era salaryman culture peak,
 *     reform-populist parties (Ishin) didn't exist.
 *
 *   DE — Post-reunification: East-German industrial workers and
 *     protest-voter cohorts visible at peak; union density ~32% (vs ~17%
 *     in 2020); Greens still consolidating after 1990 B90/Die Grünen
 *     merger; migrant cohort smaller pre-1992 asylum surge.
 *
 *   CN — 1991 urbanization ~28% (vs ~64% in 2020), peak SOE industrial
 *     workforce, private sector tiny pre-1992 Southern Tour, hukou-
 *     controlled migrant flows.
 *
 *   IE — Pre-Celtic-Tiger: net emigration of young people, MNC tech
 *     cohort essentially nonexistent, Troubles peak (border-community
 *     intensity), rural-urban shift not yet underway.
 *
 *   BR — Pentecostal share ~13% (vs ~30% in 2020), PT was young and
 *     growing in 1991, pre-Plano-Real hyperinflation crushed the urban
 *     middle class, pre-agro-modernization frontier in the Norte.
 *
 * After multipliers are applied, the `groups` are re-normalised so the
 * cohort populations sum back to ~100. Lean / turnout fields are NOT
 * adjusted — the era shift is purely in the cohort composition.
 */

import type { StateDemographics } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { POPULATION_MULTIPLIERS } from "./era1991PopulationMultipliers";

// `structuredClone` (not `JSON.parse(JSON.stringify())`) so `Date` fields
// such as `lastUpdated` survive the clone as real Dates. The JSON round-trip
// silently turns them into ISO strings, which the region page then crashes on
// when it calls `.toISOString()`.
function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Apply 1991-era cohort-share adjustments to a single `StateDemographics`
 * document. Pure function — no DB, no Date. Mutates a clone, not the
 * input. Idempotent: re-applying does not compound (re-normalisation
 * pulls populations back to summing 100 each call).
 *
 * Countries without an entry in `POPULATION_MULTIPLIERS` (or groups
 * missing from the country override) pass through unchanged.
 */
export function applyEra1991DemographicAdjustments(
  demographics: StateDemographics,
  countryId: CountryId
): StateDemographics {
  const overrides = POPULATION_MULTIPLIERS[countryId];
  if (!overrides) return demographics;
  const out = deepClone(demographics);
  const groups = out.groups;
  if (!groups || typeof groups !== "object") return out;

  for (const [groupId, group] of Object.entries(groups)) {
    const mult = overrides[groupId];
    if (mult == null || !group) continue;
    group.population = Math.max(0, Math.round((group.population ?? 0) * mult));
  }

  // Re-normalise so populations sum back to ~100. Skip if the shifted
  // total is already zero (defensive — shouldn't happen with the curated
  // multipliers, but guards against future overrides that zero-out every
  // group in a region).
  const total = Object.values(groups).reduce((s, g) => s + (g?.population ?? 0), 0);
  if (total > 0 && Math.abs(total - 100) > 0.5) {
    const factor = 100 / total;
    for (const group of Object.values(groups)) {
      if (!group) continue;
      group.population = Math.round((group.population ?? 0) * factor);
    }
  }

  return out;
}
