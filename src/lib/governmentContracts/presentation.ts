/** Public presentation context only. No writes and no changes to contract economics. */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  eraRateForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { ExchangeRate } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { GovernmentTender } from "./types";
import { extractionCapacityQuote, type ContractCurrencyQuote } from "./rules/presentation";

export async function contractCurrencyQuotes(db: Db, countryId: CountryId, preset?: string) {
  const [rates, budget] = await Promise.all([
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
    db
      .collection<{ countryId: string; currencyCode?: CurrencyCode }>("federalBudget")
      .findOne({ countryId }, { projection: { currencyCode: 1 } }),
  ]);
  const byCode = new Map(rates.map((r) => [r.currencyCode, r.rate]));
  const quote = (code: CurrencyCode | undefined): ContractCurrencyQuote | null => {
    if (!code) return null;
    const rate = byCode.get(code) ?? eraRateForCurrency(code, preset);
    return rate != null && Number.isFinite(rate) && rate > 0 ? { code, rate } : null;
  };
  return { quote, government: quote(budget?.currencyCode ?? COUNTRY_CURRENCY_MAP[countryId]) };
}
export async function contractCapacityQuotes(
  db: Db,
  countryId: string,
  rows: Pick<GovernmentTender, "_id" | "terms">[]
) {
  const stateIds = [
    ...new Set(rows.flatMap((r) => (r.terms.type === "extraction" ? [r.terms.stateId] : []))),
  ];
  const docs = stateIds.length
    ? await db
        .collection<StateResourceCapacity>("stateResourceCapacity")
        .find(
          { countryId: countryId as CountryId, stateId: { $in: stateIds } },
          { projection: { stateId: 1, resources: 1 } }
        )
        .toArray()
    : [];
  const byState = new Map(docs.map((d) => [d.stateId, d]));
  return new Map(
    rows.map((r) => [
      r._id,
      r.terms.type === "extraction"
        ? extractionCapacityQuote(
            byState.get(r.terms.stateId)?.resources[r.terms.resource],
            r.terms.share
          )
        : null,
    ])
  );
}
