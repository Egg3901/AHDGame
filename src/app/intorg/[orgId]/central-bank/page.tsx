import { notFound, redirect } from "next/navigation";
import { getRepresentativeCentralBankCountry } from "@/lib/centralBank/helpers";
import { centralBankUrl } from "@/lib/urls";
import { appendSearchParams } from "@/lib/centralBank/currencyRouting";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Legacy intorg central-bank URL — banks now live at /centralbank/[currency]. */
export default async function IntorgCentralBankRedirect({ params, searchParams }: PageProps) {
  const { orgId } = await params;
  const countryId = getRepresentativeCentralBankCountry(orgId.toUpperCase());
  if (!countryId) notFound();
  redirect(appendSearchParams(centralBankUrl(countryId), await searchParams));
}
