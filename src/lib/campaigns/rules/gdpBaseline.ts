/**
 * Country-and-era GDP-per-capita baselines for campaign income and action costs.
 *
 * PORTABLE RULES (see `rules/currency.ts`): plain data in, plain data out. No
 * database, clock, randomness, env, network, or async — the caller supplies the
 * world preset and this module resolves the number.
 *
 * WHY THIS EXISTS (issue #798): campaign income (`getIncomeGdpScalar`) and
 * action costs (`getFundMultiplier`) scale regional GDP per capita against a
 * national baseline. The old table hardcoded five modern-era local-currency
 * values and fell back to the US 65,000 default for everyone else, so any
 * country whose `State.gdp` is stored in a different denomination pinned every
 * scalar to its clamp (JP yen per-capita ~4.2M vs 65,000; IE ~91k euro-proxy
 * vs 65,000). Worse, a single fixed per-country number cannot work across
 * eras: JP's modern seed is JPY millions while its 1953 seed is USD-anchored
 * millions (see `seeds/reference/gdpDenomination.ts`), so the baseline must be
 * keyed by (country, era), not by country alone.
 *
 * WHAT THE NUMBERS ARE: for each playable country and era bundle, the
 * population-weighted mean regional GDP per capita
 * (SUM gdp x 1e6 / SUM population) over exactly the region bundle that
 * country's seeder writes for that preset, multiplied by the seed-time
 * reconcile scalar where the pre-1999 era gate applies
 * (`admin/seed/reconcileStateGdp.ts`: post-seed regional GDP matches the
 * authored national GDP, so the baseline matches what `State.gdp` actually
 * holds at runtime). Units therefore match `State.gdp` by construction, and
 * the average region resolves a ~1.0 (neutral) scalar.
 *
 * Derivation is pinned by `gdpBaseline.table.test.ts`, which recomputes every
 * cell from the seed modules and fails if a seed edit leaves the table stale.
 * To recalibrate: edit seeds, run the table test, copy the recomputed values
 * it reports, and have the result reviewed (balance-sensitive: worldsim).
 *
 * ACTIVATING A NEW COUNTRY: add its per-era row here. Until then the resolver
 * throws for it — deliberately, so a new playable country can never silently
 * inherit a mismatched US denomination.
 */

import type { EraId } from "@/lib/seeds/presetSelector";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { GDP_DENOMINATION_1953 } from "@/lib/seeds/reference/gdpDenomination";

export type GdpBaselineUnit = "local" | "usd";

/**
 * Playable countries with an explicit baseline. Matches the `status: "active"`
 * country configs (US/UK/DE/JP/IE/CN), plus coming-soon NG so its calibration
 * lands before activation. Other coming-soon countries (BR, …) are
 * intentionally absent: resolving one throws (see below) instead of silently
 * pricing in USD.
 */
export type GdpBaselineCountry = "US" | "UK" | "DE" | "JP" | "IE" | "NG" | "CN";

export interface GdpBaselineResolution {
  /** National GDP per capita in the same unit as the era's `State.gdp`. */
  baseline: number;
  /** Era family the preset resolved to (e.g. "1953-default" -> "1953"). */
  era: EraId;
  /** Preset id of the region bundle the value was derived from. */
  bundlePreset: string;
  /** Denomination of `baseline`: "usd" only for USD-anchored 1953 seeds. */
  unit: GdpBaselineUnit;
}

/**
 * Authoritative baseline table: national GDP per capita per playable country
 * and era, derived from the era's `State.gdp` seed bundle (see module doc).
 * IE/NG have no 2027 region bundle, so their seeders fall back to the 2019
 * bundle — the 2027 cells repeat the 2019 value explicitly rather than via a
 * runtime fallback, so every (country, era) resolves to a literal.
 */
const GDP_BASELINE_TABLE: Record<GdpBaselineCountry, Record<EraId, number>> = {
  US: {
    "1953": 2_557,
    "1979": 11_618,
    "1991": 24_929,
    "1999": 34_605,
    "2007": 45_683,
    "2019": 69_618,
    "2023": 80_058,
    "2027": 89_514,
  },
  UK: {
    "1953": 274,
    "1979": 4_379,
    "1991": 10_432,
    "1999": 15_734,
    "2007": 23_547,
    "2019": 29_734,
    "2023": 31_329,
    "2027": 35_057,
  },
  DE: {
    "1953": 2_715,
    "1979": 20_380,
    "1991": 20_038,
    "1999": 25_609,
    "2007": 30_760,
    "2019": 45_479,
    "2023": 45_479,
    "2027": 50_668,
  },
  JP: {
    // Modern cells are yen (local); 1953 is USD-anchored (unit "usd").
    "1953": 277,
    "1979": 1_964_804,
    "1991": 3_789_956,
    "1999": 3_966_701,
    "2007": 4_051_515,
    "2019": 4_172_222,
    "2023": 4_172_222,
    "2027": 4_486_839,
  },
  IE: {
    // No 2027 region bundle: seeder falls back to 2019, mirrored here.
    "1953": 115,
    "1979": 2_810,
    "1991": 6_809,
    "1999": 25_401,
    "2007": 43_379,
    "2019": 90_928,
    "2023": 90_928,
    "2027": 90_928,
  },
  NG: {
    // Modern cells are naira (local); 1953 is USD-anchored (unit "usd").
    // 1979/1991 inherit the seed-time reconcile crush of oversized regional
    // authoring (see module doc) — calibration review required on any reseed.
    // No 2027 region bundle: seeder falls back to 2019, mirrored here.
    "1953": 113,
    "1979": 324,
    "1991": 20_226,
    "1999": 3_206_751,
    "2007": 3_724_138,
    "2019": 3_669_401,
    "2023": 3_677_130,
    "2027": 3_669_401,
  },
  CN: {
    // Modern cells are yuan (local); 1953 is USD-anchored (unit "usd").
    // 1979 inherits the seed-time reconcile uplift (scalar ~1.38) of
    // undersized regional authoring against the authored national GDP —
    // calibration review required on any reseed. Unlike IE/NG, CN seeds an
    // explicit 2027 bundle, so every cell below is bundle-native.
    "1953": 57,
    "1979": 568,
    "1991": 1_931,
    "1999": 7_341,
    "2007": 21_028,
    "2019": 98_268,
    "2023": 98_268,
    "2027": 110_339,
  },
};

/** Preset id of the region bundle behind each (country, era) cell. */
function bundlePresetFor(country: GdpBaselineCountry, era: EraId): string {
  if ((country === "IE" || country === "NG") && era === "2027") return "2019-default";
  return `${era}-default`;
}

/**
 * Resolve the campaign GDP-per-capita baseline for a country in a world's era.
 *
 * @param countryId playable country id (US/UK/DE/JP/IE/NG/CN).
 * @param preset world reset preset (e.g. "1953-default"); defaults to
 *   `DEFAULT_SEED_PRESET` ("2019-default"). Callers without a world to ask
 *   (client previews, unit tests) get modern-era behavior — the same scale
 *   the old hardcoded table used. Runtime money paths MUST pass the world's
 *   `gameState.preset` so historical worlds price in their own denomination.
 * @throws when the country has no explicit baseline (unknown or not yet
 *   playable). Loud by design: falling back to a US value would silently
 *   misprice every income/cost scalar for that country.
 */
export function resolveCampaignGdpBaseline(
  countryId: string,
  // Optional (never defaulted): callers with no world pass nothing and get the
  // modern era; runtime money paths pass the world's gameState.preset.
  preset?: string
): GdpBaselineResolution {
  const eraPreset = preset ?? DEFAULT_SEED_PRESET;
  const row = (GDP_BASELINE_TABLE as Record<string, Record<EraId, number> | undefined>)[countryId];
  if (!row) {
    throw new Error(
      `resolveCampaignGdpBaseline: no GDP baseline for country "${countryId}" ` +
        `(preset "${eraPreset}"). Add an explicit per-era row before activating this country; ` +
        `falling back to a US-denominated value would misprice campaign income and costs.`
    );
  }
  const era = eraForPreset(eraPreset);
  return {
    baseline: row[era],
    era,
    bundlePreset: bundlePresetFor(countryId as GdpBaselineCountry, era),
    unit: era === "1953" ? (GDP_DENOMINATION_1953[countryId] ?? "local") : "local",
  };
}

/** Baseline value only — compat entry point for income/cost math. */
export function gdpBaselinePerCapita(countryId: string, preset?: string): number {
  return resolveCampaignGdpBaseline(countryId, preset ?? DEFAULT_SEED_PRESET).baseline;
}

/** True when the country has an explicit baseline row (i.e. playable). */
export function hasGdpBaseline(countryId: string): boolean {
  return countryId in GDP_BASELINE_TABLE;
}

/** Read-only view of the table for tests and diagnostics. */
export function getGdpBaselineTable(): Record<GdpBaselineCountry, Record<EraId, number>> {
  return GDP_BASELINE_TABLE;
}
