import { redirect, notFound } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { centralBankUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function CentralBankSavingsRedirect({ params }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    notFound();
  }
  redirect(`${centralBankUrl(countryId)}?tab=savings`);
}
