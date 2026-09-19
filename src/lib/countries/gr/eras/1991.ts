import type { CountryEraOverride } from "../../contract";

/**
 * GR, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/gr.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts GR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses GR's base configuration. The field
 * is ABSENT rather than an empty object, because `getCountryConfig` merges
 * shallowly and `config: {}` reads as an override that supplies nothing.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const GR_1991: CountryEraOverride = {
  preset: "1991-default",
};
