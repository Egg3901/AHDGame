import type { CountryEraOverride } from "../../contract";

/**
 * FI, 2027.
 *
 * ⚠ GENERATED from `__snapshots__/fi.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts FI --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 2027 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency. The base
 * value (0.256) is per-markka; 2027 seeds FI budgets in EUR, so the anchor
 * must be scaled by the authored cross rate: 0.256 x 3.9 (FIM/anchor) / 0.92
 * (EUR/anchor) — the same table `seedExchangeRates` uses. Left unset, the
 * anchor normalization and the seeded EUR budget would disagree ~4.2x.
 */
export const FI_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    usdExchangeRate: 1.085217391304348,
  },
};
