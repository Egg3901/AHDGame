/**
 * The FX scale a country merge converts the absorbed side's money at.
 *
 * Same rate source as `convertTransferredResidentsCurrency` (the per-region
 * resident/corp converter), so every pot of money that crosses in one merge
 * crosses at one price. ONE deliberate divergence: where the resident converter
 * REFUSES on a missing rate (its region already moved; balances can be
 * re-converted later), a national merge must not — the absorbed country stops
 * existing, so money left unconverted is money parked on a dead ledger with no
 * later pass to fix it. A missing rate converts at 1 with a loud error instead.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";

export async function resolveMergeFxScale(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<number> {
  if (!(await isForexEnabled())) return 1;

  const oldCurrency = COUNTRY_CURRENCY_MAP[fromCountryId];
  const newCurrency = COUNTRY_CURRENCY_MAP[toCountryId];
  if (!oldCurrency || !newCurrency || oldCurrency === newCurrency) return 1;

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const fromRate = fxByCurrency.get(oldCurrency);
  const toRate = fxByCurrency.get(newCurrency);
  if (fromRate === undefined || toRate === undefined || fromRate <= 0 || toRate <= 0) {
    console.error(
      `[mergeFxScale] no usable rate for ${oldCurrency}->${newCurrency}; converting at 1. ` +
        `National balances may be misdenominated and need a heal.`
    );
    return 1;
  }
  return toRate / fromRate;
}
