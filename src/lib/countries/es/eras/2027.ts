import type { CountryEraOverride } from "../../contract";

/**
 * ES, 2027.
 *
 * ⚠ GENERATED from `__snapshots__/es.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts ES --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 *
 * ⚠️ `usdExchangeRate` IS SET HERE BECAUSE NO 2027 ERA SET IT. The field is the
 * anchor value of ONE unit of this country's stored seed currency. The base
 * value (0.0149) is per-peseta; 2027 seeds ES budgets in EUR, so the anchor
 * must be scaled by the authored cross rate: 0.0149 x 67 (ESP/anchor) / 0.92
 * (EUR/anchor) — the same table `seedExchangeRates` uses. Left unset, the
 * anchor normalization and the seeded EUR budget would disagree ~73x.
 */
export const ES_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    usdExchangeRate: 1.0851086956521736,
  },
};
