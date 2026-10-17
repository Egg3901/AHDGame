"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** A quiet entry point for CEOs, without another corporation tab or a background poll. */
export function ContractOpportunityBanner({
  countryId,
  type,
}: {
  countryId: string;
  type: "defence" | "extraction" | "all";
}) {
  const t = useTranslations("corporations.governmentContracts");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-card/50 px-3 py-2 text-sm">
      <span className="text-muted">{t("corporationOpportunities")}</span>
      <Link
        className="font-semibold text-primary"
        href={`/country/${countryId.toLowerCase()}/government-contracts?tab=active&type=${type}`}
      >
        {t("viewOpenBids")} &rarr;
      </Link>
    </div>
  );
}
