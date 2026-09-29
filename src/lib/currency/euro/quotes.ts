/**
 * Euro conversion quotes use the common anchor and spread policy for external
 * trades. resolveEuroConversionQuotes preserves fixed internal settlement and
 * leaves national financial account identities unchanged.
 */
import type { Db } from "mongodb";
import type { ExchangeRate } from "@/lib/db/types";
import { euroCurrencyRate, euroLedgerCrossRate, type EuroMonetaryUnion } from "./rules";

export async function resolveEuroConversionQuotes(
  db: Db,
  from: ExchangeRate | null,
  to: ExchangeRate | null,
  union: EuroMonetaryUnion | undefined
): Promise<[ExchangeRate | null, ExchangeRate | null]> {
  if (
    !from ||
    !to ||
    !union ||
    euroLedgerCrossRate(union, from.currencyCode, to.currencyCode) != null
  )
    return [from, to];
  const isMember = (quote: ExchangeRate) =>
    Object.values(union.members).some((member) => member?.ledgerCurrency === quote.currencyCode);
  if (!isMember(from) && !isMember(to)) return [from, to];
  const anchor =
    [from, to].find((quote) => quote.currencyCode === union.anchorCurrency) ??
    (await db
      .collection<ExchangeRate>("exchangeRates")
      .findOne(
        { _id: union.anchorCountryId },
        {
          projection: {
            currencyCode: 1,
            rate: 1,
            forexSpreadStrength: 1,
            forexSpreadStrengthLastChangedTurn: 1,
          },
        }
      ));
  const resolve = (quote: ExchangeRate): ExchangeRate | null => {
    if (!isMember(quote)) return quote;
    const rate = euroCurrencyRate(union, quote.currencyCode, {
      [union.anchorCurrency]: anchor?.rate,
    });
    if (rate == null) return null;
    return {
      ...quote,
      rate,
      forexSpreadStrength: anchor?.forexSpreadStrength,
      forexSpreadStrengthLastChangedTurn: anchor?.forexSpreadStrengthLastChangedTurn,
    };
  };
  return [resolve(from), resolve(to)];
}
