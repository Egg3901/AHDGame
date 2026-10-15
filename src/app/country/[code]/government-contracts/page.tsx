import { notFound } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { normalizePage } from "@/lib/governmentContracts/rules";
import type { TenderTab, ContractType } from "@/lib/governmentContracts/types";
import { GovernmentContractsBoard } from "@/components/governmentContracts/GovernmentContractsBoard";
export default async function GovernmentContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const countryId = code.toUpperCase() as CountryId;
  const country = COUNTRY_CONFIGS[countryId];
  if (!country) notFound();
  const tab =
    typeof query.tab === "string" && ["active", "closed", "awarded", "canceled"].includes(query.tab)
      ? (query.tab as TenderTab)
      : "active";
  const type =
    typeof query.type === "string" && ["defence", "extraction"].includes(query.type)
      ? (query.type as ContractType)
      : "all";
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <GovernmentContractsBoard
        key={[countryId, tab, type, query.page].join(":")}
        countryId={countryId}
        countryName={country.name}
        tab={tab}
        type={type}
        page={normalizePage(typeof query.page === "string" ? query.page : null)}
      />
    </main>
  );
}
