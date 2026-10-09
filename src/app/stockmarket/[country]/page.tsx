import { redirect } from "next/navigation";
import { legacyStockMarketRedirectUrl } from "@/lib/market/legacyStockMarketRedirect";

export default async function StockmarketRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ country: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ country }, query] = await Promise.all([params, searchParams]);
  redirect(legacyStockMarketRedirectUrl(country, query));
}
