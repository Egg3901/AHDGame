import type { CountryEraOverride } from "../../contract";

/**
 * IE, 1999.
 *
 * ⚠ GENERATED from `__snapshots__/ie.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts IE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses IE's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const IE_1999: CountryEraOverride = {
  preset: "1999-default",
};
