import type { CountryEraOverride } from "../../contract";

/**
 * FI, 1979.
 *
 * ⚠ GENERATED from `__snapshots__/fi.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts FI --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses FI's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const FI_1979: CountryEraOverride = {
  preset: "1979-default",
};
