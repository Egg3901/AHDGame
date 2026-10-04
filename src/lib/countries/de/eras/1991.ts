import type { CountryEraOverride } from "../../contract";

/**
 * DE, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/de.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts DE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 1991 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency, and its base
 * value is a modern 1.0. `deRegions1991` authors regional GDP in DM millions treated as EUR-equivalent,
 * so the anchor must be the reciprocal of `INITIAL_RATES_1991` (0.85 DEM-as-EUR/USD) — the
 * same table `seedExchangeRates` writes into the `exchangeRates` collection.
 * Left unset, Germany read as a $1.46T economy against a real ~$1.81T.
 *
 * The conversion follows the seed's stored GDP denomination. Native-currency
 * output uses the opening quote; output already in the shared unit stays at 1.
 * Soviet and Nigerian native-currency seeds now use that same rule after their
 * source denomination and national totals were reconciled.
 */
export const DE_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    usdExchangeRate: 1.1764705882352942,
  },
};
