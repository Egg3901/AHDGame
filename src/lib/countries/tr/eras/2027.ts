import type { CountryEraOverride } from "../../contract";

/**
 * TR, 2027.
 *
 * ⚠ GENERATED from `__snapshots__/tr.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts TR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses TR's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const TR_2027: CountryEraOverride = {
  preset: "2027-default",
};
