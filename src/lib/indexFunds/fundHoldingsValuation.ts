import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFund, IndexFundHolding } from "@/lib/db/types";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import type { MarketPricedCorporation } from "@/lib/corporations/marketExecution";

type CorpQuoteRow = {
  _id: { toString(): string };
  sharePrice: number;
  fundamentalSharePrice?: number;
  liquidCurrencyCode?: CurrencyCode;
  totalShares?: number;
  publicFloat?: number;
};

/**
 * Convert a share price from its corporation's home currency into ₳.
 *
 * Every `*Anchor` quantity a fund holds — `cashAnchor`, `quotedNav`, bond
 * principal, subscribe and redeem amounts — is denominated in ₳, and the FX
 * table is quoted as local units per ₳. This helper used to convert into the
 * FUND's `anchorCurrencyCode` instead (`price * anchorRate / localRate`), which
 * only coincides with ₳ when that currency happens to sit at parity. For a JPY
 * or GBP fund the equity leg of NAV was denominated differently from the cash
 * leg it was added to, so every non-USD fund mispriced itself.
 */
export function convertLocalPriceToAnchor(
  localPrice: number,
  localCurrency: CurrencyCode | undefined,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): number | null {
  if (!Number.isFinite(localPrice) || localPrice <= 0) return null;
  // A corp with no home currency predates forex and already holds ₳ directly.
  if (!localCurrency) return localPrice;

  // No usable rate means no forex table for this currency, which is the
  // pre-forex world where prices are already ₳. Same fail-soft as
  // `corpCapitalToAnchor`, so a forex-off world keeps valuing its holdings.
  const localRate = exchangeRates[localCurrency];
  if (!Number.isFinite(localRate) || !localRate || localRate <= 0) return localPrice;

  return localPrice / localRate;
}

/**
 * Mark fund holdings to current public quotes (anchor currency).
 * Returns a new holdings array; unchanged when no quote is available.
 */
export function refreshFundHoldingsMarkToMarket(
  fund: Pick<IndexFund, "holdings" | "anchorCurrencyCode">,
  corpById: Map<string, CorpQuoteRow>,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): IndexFundHolding[] {
  if (fund.holdings.length === 0) return fund.holdings;

  return fund.holdings.map((holding) => {
    const corp = corpById.get(holding.corporationId.toString());
    if (!corp) return holding;

    const executionPrice = resolveShareExecutionPrice(corp as MarketPricedCorporation);
    const priceAnchor = convertLocalPriceToAnchor(
      executionPrice,
      corp.liquidCurrencyCode,
      exchangeRates
    );
    if (priceAnchor === null || priceAnchor <= 0) return holding;

    const lastValueAnchor = holding.shares * priceAnchor;
    if (
      holding.lastValueAnchor !== undefined &&
      Math.abs(holding.lastValueAnchor - lastValueAnchor) < 1e-9
    ) {
      return holding;
    }

    return { ...holding, lastValueAnchor };
  });
}

/** True when MTM refresh would change any holding value. */
export function holdingsNeedMarkToMarketRefresh(
  fund: Pick<IndexFund, "holdings" | "anchorCurrencyCode">,
  corpById: Map<string, CorpQuoteRow>,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): boolean {
  const refreshed = refreshFundHoldingsMarkToMarket(fund, corpById, exchangeRates);
  return refreshed.some((h, i) => h.lastValueAnchor !== fund.holdings[i]?.lastValueAnchor);
}
