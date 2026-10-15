"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
export function ContractBoardLink(props: {
  countryId?: string | null;
  type: "defence" | "extraction";
}) {
  return props.countryId ? (
    <LocalizedContractBoardLink countryId={props.countryId} type={props.type} />
  ) : null;
}
function LocalizedContractBoardLink({
  countryId,
  type,
}: {
  countryId: string;
  type: "defence" | "extraction";
}) {
  const t = useTranslations("corporations.governmentContracts");
  return (
    <Link
      className="inline-flex rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-semibold text-primary"
      href={`/country/${countryId.toLowerCase()}/government-contracts?type=${type}`}
    >
      {t("openBoard")}
    </Link>
  );
}
