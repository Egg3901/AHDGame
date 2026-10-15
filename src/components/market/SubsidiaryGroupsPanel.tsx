"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { CountryId } from "@/lib/constants/countries";
import type { PublicSubsidiaryGroup } from "@/lib/corporations/groups/rules/publicListing";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { PanelState } from "./marketUi";
import { useMarketJson } from "./useMarketJson";
const PAGE_SIZE = 10;
type Sort = "name" | "equityValueAnchor" | "revenueAnchor" | "cashAnchor" | "sectorCount";
export function SubsidiaryGroupsPanel({ country = "global" }: { country?: string }) {
  const t = useTranslations("corporations.marketGroups");
  const { formatAmount } = useCurrency();
  const countryName = useCountryDisplayName();
  const { data, loading, error } = useMarketJson<{ groups: PublicSubsidiaryGroup[] }>(
    "/api/market/subsidiary-groups"
  );
  const [search, setSearch] = useState("");
  const [showNpp, setShowNpp] = useState(false);
  const [industry, setIndustry] = useState("");
  const [sort, setSort] = useState<Sort>("equityValueAnchor");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const all = useMemo(() => data?.groups ?? [], [data]);
  const industries = [...new Set(all.flatMap((g) => g.industries))].sort();
  const filtered = useMemo(
    () =>
      all
        .filter(
          (g) =>
            (showNpp || !g.isNpp) &&
            (country === "global" || g.countries.includes(country)) &&
            (!industry || g.industries.includes(industry)) &&
            [g.name, g.parentName, ...g.members.map((m) => m.name)].some((name) =>
              name.toLowerCase().includes(search.trim().toLowerCase())
            )
        )
        .sort((a, b) => {
          if (sort !== "name" && (a[sort] === null || b[sort] === null))
            return a[sort] === b[sort]
              ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
              : a[sort] === null
                ? 1
                : -1;
          const comparison =
            sort === "name" ? a.name.localeCompare(b.name) : Number(a[sort]) - Number(b[sort]);
          return (
            (ascending ? comparison : -comparison) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id)
          );
        }),
    [all, country, industry, search, sort, ascending, showNpp]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const inputClass = "rounded-lg border border-card-border bg-card px-3 py-2 text-sm";
  return (
    <PanelState loading={loading} error={error}>
      <div className="space-y-4">
        <p className="text-xs text-muted">{t("basis")}</p>
        {all.some((g) => g.isNpp) && (
          <label className="flex items-center justify-end gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="accent-primary"
              checked={showNpp}
              onChange={(e) => {
                setShowNpp(e.target.checked);
                setPage(1);
              }}
            />
            {t("showNpp", { count: all.filter((g) => g.isNpp).length })}
          </label>
        )}
        <div className="flex flex-wrap gap-3">
          <input
            aria-label={t("search")}
            placeholder={t("search")}
            className={`${inputClass} w-full min-w-0 sm:min-w-60 sm:flex-1`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t("industry")}
            className={inputClass}
            value={industry}
            onChange={(e) => {
              setIndustry(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("allIndustries")}</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            aria-label={t("sort")}
            className={inputClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setPage(1);
            }}
          >
            {(
              ["equityValueAnchor", "revenueAnchor", "cashAnchor", "sectorCount", "name"] as const
            ).map((s) => (
              <option value={s} key={s}>
                {t(s)}
              </option>
            ))}
          </select>
          <button
            className={inputClass}
            onClick={() => {
              setAscending(!ascending);
              setPage(1);
            }}
          >
            {t(ascending ? "ascending" : "descending")}
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-card-elevated text-xs text-muted">
              <tr>
                {[
                  "name",
                  "country",
                  "members",
                  "equityValueAnchor",
                  "cashAnchor",
                  "revenueAnchor",
                  "sectorCount",
                ].map((key) => (
                  <th key={key} className="whitespace-nowrap px-4 py-3 text-left">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((g) => (
                <tr key={g.id} className="border-t border-card-border hover:bg-card-elevated">
                  <td className="px-4 py-3">
                    <Link
                      href={`/corporation/${g.pathId}/group`}
                      className="flex items-center gap-3 font-semibold text-foreground hover:text-primary"
                    >
                      <CorporationLogo name={g.name} logoUrl={g.logoUrl} />
                      <span>
                        {g.name}
                        <span className="block text-xs font-normal text-muted">{g.parentName}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{countryName(g.countryId as CountryId)}</td>
                  <td className="px-4 py-3 tabular-nums">{g.members.length}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    {g.equityValueAnchor === null
                      ? t("unavailable")
                      : formatAmount(g.equityValueAnchor)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    {g.cashAnchor === null ? t("unavailable") : formatAmount(g.cashAnchor)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    {g.revenueAnchor === null ? t("unavailable") : formatAmount(g.revenueAnchor)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{g.sectorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-sm text-muted">{t("empty")}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>{t("pagination", { page: current, pages, count: filtered.length })}</span>
          <div className="flex gap-2">
            <button
              className={inputClass}
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              {t("previous")}
            </button>
            <button
              className={inputClass}
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>
    </PanelState>
  );
}
