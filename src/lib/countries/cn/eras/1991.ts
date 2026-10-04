import type { CountryEraOverride } from "../../contract";

/**
 * CN, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/cn.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts CN --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 1991 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency, and its base
 * value is 0.138, a rate belonging to no modelled era. `cnRegions1991` authors regional GDP in CNY millions,
 * so the anchor must be the reciprocal of `INITIAL_RATES_1991` (5.32 CNY/USD) — the
 * same table `seedExchangeRates` writes into the `exchangeRates` collection.
 * Left unset, China read as a $298B economy against a real ~$383B.
 *
 * The conversion follows the seed's stored GDP denomination. Native-currency
 * output uses the opening quote; output already in the shared unit stays at 1.
 * Soviet and Nigerian native-currency seeds now use that same rule after their
 * source denomination and national totals were reconciled.
 */
export const CN_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 0.18796992481203006,
  },
};
