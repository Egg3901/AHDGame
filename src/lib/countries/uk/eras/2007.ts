import type { CountryEraOverride } from "../../contract";

/**
 * UK, 2007.
 *
 * ⚠ GENERATED from `__snapshots__/uk.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts UK --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses UK's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const UK_2007: CountryEraOverride = {
  preset: "2007-default",
};
