import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { legacyStockTabToMarketTab } from "./hubTabs";

/** Translate an old country stock-market URL into its current market-hub URL. */
export function legacyStockMarketRedirectUrl(
  countryCode: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const params = new URLSearchParams();
  const rawTab = searchParams.tab;
  const tab = legacyStockTabToMarketTab(Array.isArray(rawTab) ? rawTab[0] : rawTab);
  if (tab) params.set("tab", tab);

  const code = countryCode.toUpperCase();
  if (getExchangeApiKey(code)) params.set("exchange", code);

  const query = params.toString();
  return query ? `/market?${query}` : "/market";
}
