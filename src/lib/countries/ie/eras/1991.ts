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
 * value is a modern 1.0. `ieRegions1991` authors regional GDP as EUR-equivalent,
 * so the anchor must be the reciprocal of `INITIAL_RATES_1991` (0.85 IEP-as-EUR/USD) — the
 * same table `seedExchangeRates` writes into the `exchangeRates` collection.
 * Left unset, Ireland read as a $42B economy against a real ~$47B.
 *
 * The conversion follows the seed's stored GDP denomination. Native-currency
 * output uses the opening quote; output already in the shared unit stays at 1.
 * Soviet and Nigerian native-currency seeds now use that same rule after their
 * source denomination and national totals were reconciled.
 */
export const IE_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 1.1764705882352942,
  },
};
