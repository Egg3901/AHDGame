import { redirect } from "next/navigation";
import { legacyStockMarketRedirectUrl } from "@/lib/market/legacyStockMarketRedirect";

export default async function LegacyStockMarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  redirect(legacyStockMarketRedirectUrl(code, query));
}
