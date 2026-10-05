import type { CountryEraOverride } from "../../contract";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";

/**
 * AT, 1991.
 *
 * ⚠ GENERATED from `__snapshots__/at.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts AT --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * Config override: `usdExchangeRate` only. Its base value is the 1979 reciprocal
 * of the AT rate, and the 1991 GDP seeds are authored in legacy currency at the
 * 1991 average (WDI, see fiscalAnchors1991.ts), so the anchor is the reciprocal
 * of `INITIAL_RATES_1991`, the same table `seedExchangeRates` writes (#3034).
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const AT_1991: CountryEraOverride = {
  preset: "1991-default",
  config: { usdExchangeRate: 1 / INITIAL_RATES_1991.AT! },
};
