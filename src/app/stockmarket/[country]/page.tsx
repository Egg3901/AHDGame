import { redirect } from "next/navigation";
import StockMarketPage from "@/app/country/[code]/stockmarket/page";

/**
 * Redirect shell: country-specific stockmarket URLs redirect to /country/[code]/stockmarket.
 * The "global" view remains at /stockmarket/global since it's cross-country.
 */
export default async function StockmarketRedirect({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;

  if (country.toLowerCase() === "global") {
    // Global view stays at /stockmarket/global — render inline via the shared component.
    // Pass params through with "code" key expected by the new page component.
    const codeParams = Promise.resolve({ code: country });
    return <StockMarketPage params={codeParams} />;
  }

  redirect(`/country/${country.toLowerCase()}/stockmarket`);
}
