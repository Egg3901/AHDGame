/**
 * ONE resolver for "how many ₳ is one unit of a country's stored GDP worth".
 *
 * WHAT THE FIELD MEANS. `CountryConfig.usdExchangeRate` is NOT a foreign-exchange
 * quote. It is the denomination normalizer for `State.gdp` and the national
 * budget seed: those are stored in whatever unit the era's regional seed file
 * authored them in, and this field converts that unit into ₳ (which tracks the
 * US dollar OF THE ERA). It coincides with the FX rate only when the seed
 * happens to be authored in true local currency:
 *
 *   - JP 2019: `usdExchangeRate` 0.00943 = 1/106, and `INITIAL_RATES.JP` is
 *     106 JPY/₳. They agree — jpRegions gdp really is in yen.
 *   - UK 2019: `usdExchangeRate` is 1.0 but `INITIAL_RATES.UK` is 0.75 GBP/₳.
 *     They disagree by 33% because ukRegions/UK's £2.9T budget seed is authored
 *     in DOLLARS (real 2019 UK GDP was ~£2.2T = ~$2.9T). 1.0 is correct here and
 *     0.75 would inflate the UK by a third.
 *   - IT/JP/CN/NG 1953: authored in USD millions (refs #3498), so their 1953
 *     rate is 1.0 even though `INITIAL_RATES_1953` has 625 / 360 / 2.46 / 0.357.
 *
 * So the `exchangeRates` collection is NOT a drop-in replacement for this field
 * (refs #3778 §2) — reading market FX here would silently rescale every modern
 * world's GDP and sector markets. What WAS genuinely duplicated is the ERA
 * DIMENSION: eight runtime call sites resolved the rate off the BASE config with
 * no preset, so a 1953 world was normalized with 1979/2019 numbers. That is the
 * bug this module closes; it is the single place the rule is written down.
 *
 * ERA AWARENESS. `getCountryConfig(id, preset)` layers
 * `ERA_COUNTRY_CONFIG_OVERRIDES[preset]` over the base config. Only the
 * `1953-default` table carries `usdExchangeRate` entries (pinned by
 * `era1953ExchangeRates.test.ts`), so passing a preset is a strict no-op for
 * every modern preset, for 1979/1991, for preset aliases, and for callers that
 * pass nothing. Passing the WRONG preset is therefore never worse than passing
 * none — but passing the right one is what makes a 1953 world read as a 1953
 * world.
 *
 * @see src/lib/constants/countries.ts — the 1953 override table and its sources
 * @see src/lib/constants/sectorSeedEra.ts — the seed-time sibling of this module
 */

import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import type { GameState } from "@/lib/db/types";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";

/**
 * ₳ per one unit of `countryId`'s stored GDP under `preset`.
 *
 * Returns 1 (anchor passthrough) for an unrecognized country or a non-positive
 * configured rate, so a stale/legacy `countryId` on one state document degrades
 * to "treat this GDP as already ₳-denominated" instead of producing 0 or NaN and
 * zeroing out a market. Callers that want to log the unrecognized id should
 * check `isKnownGdpAnchorCountry` first — this function stays silent because it
 * runs inside per-corp/per-sector turn loops.
 */
export function getGdpAnchorRate(countryId: CountryId, preset?: string): number {
  const rate = getCountryConfig(countryId, preset)?.usdExchangeRate;
  return typeof rate === "number" && rate > 0 ? rate : 1;
}

/** True when `countryId` has a `COUNTRY_CONFIGS` entry at all. */
export function isKnownGdpAnchorCountry(countryId: CountryId): boolean {
  return getCountryConfig(countryId) != null;
}

/**
 * A country's stored GDP (local-currency millions) expressed in ₳ millions.
 * The whole reason `loadUsdGdpByCountry` and friends exist.
 */
export function gdpToAnchor(localMillions: number, countryId: CountryId, preset?: string): number {
  return localMillions * getGdpAnchorRate(countryId, preset);
}

/**
 * The active world's reset preset, read from the `gameState` singleton.
 *
 * One projected read of one document. Deliberately NOT cached at module scope:
 * every caller already issues several queries in the same request/turn, and a
 * stale process-level preset would survive a world reset into the next era —
 * exactly the class of bug this module exists to remove.
 *
 * Falls back to `2019-default` when the document or the field is missing, which
 * is the same fallback every seeder uses.
 */
export async function loadWorldPreset(db: Db): Promise<string> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  return resolvePresetIdFromGameState(gameState);
}

/**
 * The active world's era unit-basis scale (`getEraUnitScale(preset)`): the one
 * DB-side resolver command/route callers use when no turn `lookups` object is
 * in scope. Same no-cache reasoning as {@link loadWorldPreset}.
 */
export async function loadWorldEraUnitScale(db: Db): Promise<number> {
  return getEraUnitScale(await loadWorldPreset(db));
}

/** Bound resolver for a world: `loadWorldPreset` once, then reuse per country. */
export interface WorldGdpAnchorRates {
  preset: string;
  rateFor(countryId: CountryId): number;
  toAnchor(localMillions: number, countryId: CountryId): number;
}

/** `loadWorldPreset` + {@link getGdpAnchorRate} bound to it. */
export async function loadWorldGdpAnchorRates(db: Db): Promise<WorldGdpAnchorRates> {
  const preset = await loadWorldPreset(db);
  return {
    preset,
    rateFor: (countryId) => getGdpAnchorRate(countryId, preset),
    toAnchor: (localMillions, countryId) => gdpToAnchor(localMillions, countryId, preset),
  };
}
