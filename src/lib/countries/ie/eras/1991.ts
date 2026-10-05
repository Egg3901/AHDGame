import type { CountryEraOverride } from "../../contract";

/**
 * IE, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/ie.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts IE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 1991 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency, and its base
 * value is a modern 1.0. The reconciled 1991 regional GDP is in Irish pounds,
 * so use the reciprocal of the sourced annual quote, 0.6212975 IEP/USD.
 * gdpAnchorRate1991.test.ts pins this to the seeded currency quote.
 *
 * The conversion follows the seed's stored GDP denomination. Native-currency
 * output uses the opening quote; output already in the shared unit stays at 1.
 * Soviet and Nigerian native-currency seeds now use that same rule after their
 * source denomination and national totals were reconciled.
 */
export const IE_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 1 / 0.6212975,
  },
};
