/**
 * Euro conversion quotes use the common anchor and spread policy for external
 * trades. resolveEuroConversionQuotes preserves fixed internal settlement and
 * leaves national financial account identities unchanged.
 */
import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ExchangeRate } from "@/lib/db/types";
import { euroCurrencyRate, euroLedgerCrossRate, type EuroMonetaryUnion } from "./rules";

export type ConversionQuote = Pick<
  ExchangeRate,
  "currencyCode" | "rate" | "forexSpreadStrength" | "forexSpreadStrengthLastChangedTurn"
>;
export interface ConversionQuoteContext {
  quotes: ReadonlyMap<CurrencyCode, ConversionQuote>;
  union?: EuroMonetaryUnion;
}

/** Turn callers load one projected quote snapshot for all payout conversions. */
export async function loadConversionQuoteContext(
  db: Db,
  union?: EuroMonetaryUnion
): Promise<ConversionQuoteContext> {
  const quotes = await db
    .collection<ConversionQuote>("exchangeRates")
    .find(
      {},
      {
        projection: {
          currencyCode: 1,
          rate: 1,
          forexSpreadStrength: 1,
          forexSpreadStrengthLastChangedTurn: 1,
        },
      }
    )
    .toArray();
  return { quotes: new Map(quotes.map((quote) => [quote.currencyCode, quote])), union };
}

export async function resolveEuroConversionQuotes(
  db: Db,
  from: ConversionQuote | null,
  to: ConversionQuote | null,
  union: EuroMonetaryUnion | undefined,
  preloaded?: ReadonlyMap<CurrencyCode, ConversionQuote>
): Promise<[ConversionQuote | null, ConversionQuote | null]> {
  if (
    !from ||
    !to ||
    !union ||
    euroLedgerCrossRate(union, from.currencyCode, to.currencyCode) != null
  )
    return [from, to];
  const isMember = (quote: ConversionQuote) =>
    Object.values(union.members).some((member) => member?.ledgerCurrency === quote.currencyCode);
  if (!isMember(from) && !isMember(to)) return [from, to];
  const existingAnchor = [from, to].find((quote) => quote.currencyCode === union.anchorCurrency);
  const anchor =
    existingAnchor ??
    (preloaded
      ? preloaded.get(union.anchorCurrency)
      : await db.collection<ExchangeRate>("exchangeRates").findOne(
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
  const resolve = (quote: ConversionQuote): ConversionQuote | null => {
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

/** Purchase estimates resolve the source authority from these projected settings. */
export async function loadForexSpreadStrengths(db: Db) {
  const rows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find(
      {},
      {
        projection: { currencyCode: 1, forexSpreadStrength: 1 },
      }
    )
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.currencyCode, row.forexSpreadStrength]));
}
