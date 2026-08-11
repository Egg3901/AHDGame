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

/**
 * Per-country, per-group multiplicative adjustments to `population`.
 * Keys are the voter-group IDs used in each country's per-region
 * demographics file. Groups missing from the override map pass through
 * unchanged (×1.0).
 */
const POPULATION_MULTIPLIERS: Partial<Record<CountryId, Record<string, number>>> = {
  US: {
    new_immigrants: 0.4, // 1990 Census: Hispanic 9% / Asian 3%
    secular_professionals: 0.6, // Smaller college-educated cohort
    college_liberals: 0.6, // Bachelor's rate 21% vs 38% in 2020
    evangelicals: 1.2, // Peak religiosity in early 1990s
    rural_traditionalists: 1.15, // Higher rural share pre-suburbanization
    union_trades: 1.6, // Union density 16% in 1991 vs 10% in 2020
    young_renters: 0.85, // Less urban concentration
    retirees: 0.85, // 65+ cohort smaller in 1991
    small_business: 1.1, // Pre-corporate-consolidation
  },
  UK: {
    new_britons: 0.3, // Pre-2004 EU expansion immigration wave
    urban_progressives: 0.7, // Pre-NewLabour identity politics
    young_renters: 0.85, // Right-to-Buy era boosted home ownership
    post_industrial_workers: 1.4, // Manufacturing peak pre-deindustrialization
    rural_traditionalists: 1.15,
    retirees: 0.9, // Smaller 65+ cohort in 1991
    populist_right: 0.3, // No UKIP / Reform yet; BNP fringe
    green_activists: 0.4, // Green Party tiny in 1991
    suburban_homeowners: 1.15, // Right-to-Buy expansion
    moderate_centrists: 0.9, // Lib Dems just merged 1988
    public_sector: 1.15, // Pre-Thatcher-cuts hangover
  },
  JP: {
    salaryman_conservative: 1.15, // Peak bubble salaryman culture
    urban_progressive: 0.85, // Pre-globalisation
    rural_traditionalist: 1.1, // Less rural-to-urban migration
    young_urban: 1.15, // Larger young cohort, less aging
    retiree: 0.7, // Aging wave hits hardest after 1995
    komeito_faithful: 1.2, // Peak Komeito support
    reform_populist: 0.0, // Ishin / reform parties post-2010 phenomenon
    working_mothers: 0.5, // Pre-Womenomics; women in workforce much lower
  },
  DE: {
    katholische_konservative: 1.1, // Pre-secularisation
    gewerkschafter: 1.4, // 1991 union density ~32% vs ~17% in 2020
    urbane_progressive: 0.7,
    wirtschaftsliberale: 0.85, // Smaller FDP base
    ost_post_industriell: 3.0, // Post-reunification visible; cohort emigrated/retired by 2020
    gruene_mittelschicht: 0.5, // B90/Die Grünen merger just completed 1990
    rentner_west: 0.85, // Smaller retiree cohort in 1991 West
    migranten_communities: 0.5, // Pre-1992 asylum surge
    landwirte_dorf: 1.2, // More agricultural employment
    junge_grossstadt: 0.9,
    protest_waehler_ost: 2.5, // Post-reunification PDS/protest peak
  },
  CN: {
    party_cadre: 1.15, // Peak SOE party-state era
    urban_professional: 0.5, // Pre-private-sector boom
    rural_peasant: 1.6, // 1991 urbanization ~28% vs ~64% in 2020
    industrial_worker: 1.2, // Peak SOE industrial workforce
    migrant_worker: 0.4, // Hukou tightly controlled
    entrepreneur: 0.2, // Private sector tiny pre-1992
    youth: 1.1, // Post-Cultural-Revolution baby-boom echo
  },
  IE: {
    urban_professional: 0.4, // Pre-MNC FDI tech boom
    rural_traditional: 1.4, // Pre-Celtic-Tiger urban migration
    working_class: 1.2, // Industrial decline not yet hit
    new_irish: 0.1, // 1991 immigration negligible — Ireland still emigrating
    small_business: 0.9,
    retirees: 0.85,
    young_urban: 0.7, // Emigration of young people peaked 1989-93
    border_communities: 1.1, // Troubles peak
  },
  BR: {
    evangelical_conservative: 0.5, // 1991 Pentecostal share ~13% vs ~30% in 2020
    working_class_pt: 1.15, // PT young + growing in 1991
    rural_agribusiness: 1.2, // Pre-agro-modernization frontier
    urban_middle_class: 0.8, // Hyperinflation-crushed
    urban_poor: 1.15, // Plano-Collor-II era peak
    afro_brazilian: 1.0,
    business_financial: 0.7, // Pre-Plano-Real
    young_progressive: 0.85,
  },
};

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
