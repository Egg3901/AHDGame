/**
 * Apply a one-shot FX depreciation to a country's exchange rate.
 *
 * AHD stores `exchangeRates.rate` as "local currency per 1 internal unit", so a
 * higher rate means a weaker local currency. A 40% depreciation is a 1.4x
 * multiplier on `rate`.
 *
 * Subsequent FX history snapshots are folded by the existing FX pipeline; we
 * do not write a `rateHistory` entry here.
 *
 * NOTE: this intentionally bypasses hardPeg / interventionPolicy checks. A
 * sovereign default override is more authoritative than an admin peg or chair
 * band. The existing FX pipeline will reconcile on the next turn snapshot.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";

export async function applyExchangeRateDepreciation(
  db: Db,
  countryId: CountryId,
  percent: number
): Promise<{ ok: boolean; previousRate?: number; newRate?: number }> {
  const row = await db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId });
  if (!row) return { ok: false };

  const previousRate = row.rate;
  const newRate = previousRate * (1 + percent);

  await db
    .collection<ExchangeRate>("exchangeRates")
    .updateOne({ _id: countryId }, { $set: { rate: newRate, updatedAt: new Date() } });

  return { ok: true, previousRate, newRate };
}
