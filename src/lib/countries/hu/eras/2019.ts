import type { CountryEraOverride } from "../../contract";

/**
 * HU, 2019.
 *
 * ⚠ GENERATED from `__snapshots__/hu.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts HU --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses HU's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const HU_2019: CountryEraOverride = {
  preset: "2019-default",
};
