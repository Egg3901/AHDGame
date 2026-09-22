import type { CountryEraOverride } from "../../contract";

/**
 * RO, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/ro.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts RO --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const RO_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.07407407407407407,
    majorPartyIds: ["pmr"],
  },
};
