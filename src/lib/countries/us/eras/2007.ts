import type { CountryEraOverride } from "../../contract";

/**
 * US, 2007.
 *
 * ⚠ GENERATED from `__snapshots__/us.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts US --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses US's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const US_2007: CountryEraOverride = {
  preset: "2007-default",
};
