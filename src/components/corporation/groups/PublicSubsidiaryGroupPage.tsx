"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { PublicSubsidiaryGroup } from "@/lib/corporations/groups/rules/publicListing";
import { useMarketJson } from "@/components/market/useMarketJson";
import { PanelState } from "@/components/market/marketUi";
import { CorporationLogo } from "../CorporationLogo";
import { SubsidiaryGroupPage } from "./SubsidiaryGroupPage";
export function PublicSubsidiaryGroupPage({ corpId }: { corpId: string }) {
  const t = useTranslations("corporations.marketGroups");
  const { formatAmount } = useCurrency();
  const { data, loading, error } = useMarketJson<{
    group: PublicSubsidiaryGroup;
    canViewManagement: boolean;
  }>(`/api/corporations/${corpId}/group/overview`);
  const group = data?.group;
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group?.members ?? []) {
      if (member.formalized && member.parentId)
        counts.set(member.parentId, (counts.get(member.parentId) ?? 0) + 1);
    }
    return counts;
  }, [group]);
  if (data?.canViewManagement) return <SubsidiaryGroupPage corpId={data.group.pathId} />;
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <PanelState loading={loading} error={error}>
        {group && (
          <>
            <Link
              href="/market?tab=sub-groups"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("back")}
            </Link>
            <header className="flex flex-wrap items-center gap-5 rounded-xl border border-card-border bg-card p-6">
              <CorporationLogo logoUrl={group.logoUrl} name={group.name} size="h-16 w-16" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">{t("title")}</p>
                <h1 className="break-words text-3xl font-bold">{group.name}</h1>
                <Link
                  className="block break-words text-sm text-muted"
                  href={`/corporation/${group.pathId}`}
                >
                  {group.parentName}
                </Link>
              </div>
            </header>
            <nav aria-label={t("sections")} className="border-b border-card-border">
              <span className="inline-block border-b-2 border-primary px-4 py-3 text-sm font-semibold">
                {t("overview")}
              </span>
            </nav>
            <p className="text-sm text-muted">{t("publicNote")}</p>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(["equityValueAnchor", "cashAnchor", "revenueAnchor", "sectorCount"] as const).map(
                (key) => (
                  <div
                    key={key}
                    className="min-w-0 rounded-xl border border-card-border bg-card p-5"
                  >
                    <dt className="text-xs text-muted">{t(key)}</dt>
                    <dd className="mt-2 break-words font-mono text-2xl">
                      {key === "sectorCount"
                        ? group[key]
                        : group[key] === null
                          ? t("unavailable")
                          : formatAmount(group[key])}
                    </dd>
                  </div>
                )
              )}
            </dl>
            <p className="text-sm text-muted">
              {t("footprint", { regions: group.regionCount, countries: group.countries.length })}
            </p>
            <p className="text-xs text-muted">{t("basis")}</p>
            {group.parentGroupId && (
              <Link
                className="text-sm text-info"
                href={`/corporation/${group.parentGroupId}/group`}
              >
                {t("parentGroup")}
              </Link>
            )}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">{t("members")}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.members.map((m) => (
                  <article
                    key={m.id}
                    className="rounded-xl border border-card-border bg-card p-4 space-y-3"
                  >
                    <Link
                      href={`/corporation/${m.pathId}`}
                      className="flex items-center gap-3 font-semibold"
                    >
                      <CorporationLogo name={m.name} logoUrl={m.logoUrl} />
                      <span className="min-w-0 break-words">{m.name}</span>
                    </Link>
                    <p className="text-sm text-muted">
                      {t("memberSummary", {
                        revenue:
                          m.revenueAnchor === null
                            ? t("unavailable")
                            : formatAmount(m.revenueAnchor),
                        count: childCounts.get(m.id) ?? 0,
                      })}
                    </p>
                    {m.id !== group.id && (childCounts.get(m.id) ?? 0) > 0 && (
                      <Link className="text-xs text-info" href={`/corporation/${m.pathId}/group`}>
                        {t("viewGroup")}
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </PanelState>
    </main>
  );
}
