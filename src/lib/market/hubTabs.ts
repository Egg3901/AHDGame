export const MARKET_TABS = [
  { key: "overview", label: "Overview" },
  { key: "stocks", label: "Stocks" },
  { key: "bonds", label: "Bonds" },
  { key: "funds", label: "Funds" },
  { key: "sectors", label: "Sectors for sale" },
  { key: "commodities", label: "Commodities" },
  { key: "supply", label: "Supply deals" },
  { key: "currencies", label: "Currencies" },
] as const;

export type MarketTab = (typeof MARKET_TABS)[number]["key"];

/** Unknown or missing values land on the overview. */
export function parseMarketTab(value: string | null | undefined): MarketTab {
  return MARKET_TABS.find((t) => t.key === value)?.key ?? "overview";
}

/** Tabs of the old stock market page that now live in the hub. */
export function legacyStockTabToMarketTab(value: string | null | undefined): MarketTab | null {
  if (!value || value === "listings") return "stocks";
  if (value === "stocks" || value === "bonds" || value === "funds" || value === "commodities") {
    return value;
  }
  return null;
}
