import type { CountryEraOverride } from "../../contract";

/**
 * BAL, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/bal.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts BAL --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const BAL_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.1111111111111111,
  },
};
