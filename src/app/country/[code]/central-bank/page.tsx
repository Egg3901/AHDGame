import { notFound, redirect } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { centralBankUrl } from "@/lib/urls";
import { appendSearchParams } from "@/lib/centralBank/currencyRouting";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Legacy country-scoped central-bank URL — banks now live at /centralbank/[currency]. */
export default async function CentralBankCountryRedirect({ params, searchParams }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  redirect(appendSearchParams(centralBankUrl(countryId), await searchParams));
}
