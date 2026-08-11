"use client";

import { useCallback } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { formatFundAmount } from "./fundCurrency";

/**
 * Formats a fund-currency amount in whatever currency the viewer asked for.
 *
 * Used for INFORMATIONAL money — what a nation costs, what a play landed, what a
 * bloc collects in a year. Not for balances or for anything a player types: an
 * account and an input have to stay in the units they are actually denominated
 * in, which is the same reasoning `CurrencyContext.formatPriceIn` records for
 * shares that trade on a specific exchange.
 *
 * `formatAmount` works in anchor units, so a fund-currency figure is multiplied
 * by the anchor-per-fund-unit rate first. That rate MUST come from the server,
 * which resolves it for the active era: deriving it here from `COUNTRY_CONFIGS`
 * would price a 1953 world at 1979 rates (refs #3778). Without it the fund's own
 * currency stands in, rather than a guess.
 */
export function useFundFormatter(fund: {
  usdToFundRate?: number;
  currencyCountryId?: CountryId;
  currencyCode?: string;
}): (localAmount: number) => string {
  const { formatAmount } = useCurrency();
  const code =
    fund.currencyCode ??
    (fund.currencyCountryId
      ? (COUNTRY_CONFIGS[fund.currencyCountryId]?.currencyCode ?? "USD")
      : "USD");
  const rate = fund.usdToFundRate;
  return useCallback(
    (localAmount: number) =>
      rate
        ? formatAmount(localAmount * rate, code as CurrencyCode)
        : formatFundAmount(localAmount, code),
    [formatAmount, rate, code]
  );
}
