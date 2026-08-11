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

/** Minimal shape for mark-to-market. */
export function convertLocalPriceToAnchor(
  localPrice: number,
  localCurrency: CurrencyCode | undefined,
  anchorCurrency: CurrencyCode,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): number | null {
  if (!localCurrency || !Number.isFinite(localPrice) || localPrice <= 0) return null;
  if (localCurrency === anchorCurrency) return localPrice;

  const localRate = exchangeRates[localCurrency];
  const anchorRate = exchangeRates[anchorCurrency];
  if (!localRate || localRate <= 0 || !anchorRate || anchorRate <= 0) return null;

  return localPrice * (anchorRate / localRate);
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
      fund.anchorCurrencyCode,
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
