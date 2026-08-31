/**
 * Re-denominate a transferred region's money into its new country's currency.
 * When NI joins Ireland its residents' pounds become euro (an involuntary
 * currency-union change — unlike a voluntary HQ relocation, which leaves personal
 * forex holdings alone):
 *
 *   - Corporations that followed the region in re-denominate via the shared
 *     `convertCorpCurrency` (liquid capital, sector revenues, share price, …).
 *   - Resident players' home-currency wallet balances (campaign + the old-currency
 *     personal/savings buckets) convert at the live FX scale; foreign-currency
 *     holdings they already kept are left as forex positions.
 *
 * No-op when forex is disabled, the two countries share a currency, or a rate is
 * missing (refuse rather than persist order-of-magnitude-wrong balances).
 */
import type { Db, Filter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, Character } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { convertCorpCurrency } from "@/lib/corporations/convertCorpCurrency";

export async function convertTransferredResidentsCurrency(
  db: Db,
  regionId: string,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<void> {
  const forexEnabled = await isForexEnabled();
  if (!forexEnabled) return;

  const oldCurrency = COUNTRY_CURRENCY_MAP[fromCountryId];
  const newCurrency = COUNTRY_CURRENCY_MAP[toCountryId];
  if (!oldCurrency || !newCurrency || oldCurrency === newCurrency) return;

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const fromRate = fxByCurrency.get(oldCurrency);
  const toRate = fxByCurrency.get(newCurrency);
  if (fromRate === undefined || toRate === undefined) return;
  const scale = toRate / fromRate;
  const now = new Date();

  // Corps that followed the region into the new country re-denominate to its
  // currency (NPP-relocated corps that stayed in the source country are excluded
  // — their HQ is no longer in this region).
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ headquartersState: regionId, countryId: toCountryId })
    .toArray();
  for (const corp of corps) {
    await convertCorpCurrency(db, corp, newCurrency, fxByCurrency, now, forexEnabled);
  }

  // Region party organisations that CARRIED with a dissolving source (the
  // evacuate path deletes them, so this matches nothing on a referendum
  // transfer) hold their treasuries in the old currency. One multiplicative
  // pass per region: the region moves exactly once, so this cannot re-run.
  await db
    .collection("statePartyOrg")
    .updateMany({ stateId: regionId }, { $mul: { treasury: scale }, $set: { updatedAt: now } });

  // Resident players' home-currency wallet converts; other currencies stay as forex.
  const players = await db
    .collection<Character>("characters")
    .find({ homeState: regionId, userId: { $ne: null } } as unknown as Filter<Character>)
    .toArray();
  for (const p of players) {
    const cb = p.currencyBalances;
    if (!cb) continue;
    const set: Record<string, unknown> = {
      "currencyBalances.campaign": (cb.campaign ?? 0) * scale,
      updatedAt: now,
    };
    for (const bucket of ["personal", "savings"] as const) {
      const wallet: Partial<Record<CurrencyCode, number>> = { ...(cb[bucket] ?? {}) };
      const old = wallet[oldCurrency] ?? 0;
      if (old) {
        wallet[newCurrency] = (wallet[newCurrency] ?? 0) + old * scale;
        delete wallet[oldCurrency];
      }
      set[`currencyBalances.${bucket}`] = wallet;
    }
    await db.collection<Character>("characters").updateOne({ _id: p._id }, { $set: set });
  }
}
