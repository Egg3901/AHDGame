import { redirect } from "next/navigation";
import { legacyStockTabToMarketTab } from "@/lib/market/hubTabs";
import StockMarketPage from "@/app/country/[code]/stockmarket/page";

/**
 * Redirect shell: country-specific stockmarket URLs redirect to /country/[code]/stockmarket.
 * The "global" view remains at /stockmarket/global since it's cross-country.
 */
export default async function StockmarketRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ country: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { country } = await params;

  if (country.toLowerCase() === "global") {
    // Stocks, bonds, funds and commodities moved into The Market. The wealth,
    // stats and auctions tabs still render here.
    const rawTab = (await searchParams)?.tab;
    const hubTab = legacyStockTabToMarketTab(Array.isArray(rawTab) ? rawTab[0] : rawTab);
    if (hubTab) redirect(`/market?tab=${hubTab}`);
    // Global view stays at /stockmarket/global — render inline via the shared component.
    // Pass params through with "code" key expected by the new page component.
    const codeParams = Promise.resolve({ code: country });
    return <StockMarketPage params={codeParams} />;
  }

  redirect(`/country/${country.toLowerCase()}/stockmarket`);
}
