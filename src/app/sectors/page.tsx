"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { Skeleton } from "@/components/ui";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { regionUrl } from "@/lib/urls";

const DEFAULT_CORP_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
];

function getTypeColor(type: CorporationType): string {
  const colors: Partial<Record<CorporationType, string>> = {
    financial: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    media: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    manufacturing: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    chemical_industries: "bg-green-500/15 text-green-400 border-green-500/30",
    healthcare: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    retail: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    automobiles: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    technology: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    energy: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    agriculture: "bg-lime-500/15 text-lime-400 border-lime-500/30",
    real_estate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    construction: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    defense: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    telecommunications: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    entertainment: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    logistics: "bg-stone-500/15 text-stone-400 border-stone-500/30",
    extraction: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  };
  return colors[type] ?? "bg-primary/10 text-primary border-primary/30";
}

type SectorView = "unowned" | "owned" | "forSale";
type SectorSort = "revenue" | "type" | "state" | "country" | "margin" | "growth";

type SectorRow = {
  id: string;
  sectorType: CorporationType;
  sectorTypeLabel: string;
  stateId: string;
  stateName: string;
  countryId: CountryId;
  countryName: string;
  countryFlag: string;
  owned: boolean;
  corporationId: string | null;
  corporationName: string | null;
  corporationSequentialId: number | null;
  corporationLogoUrl: string | null;
  revenue: number;
  revenueAnchor: number;
  margin: number | null;
  growthRate: number | null;
  workers: number | null;
  forSale: boolean;
  forSalePrice: number | null;
};

type SectorsResponse = {
  view: SectorView;
  sort: SectorSort;
  dir: "asc" | "desc";
  page: number;
  totalPages: number;
  totalItems: number;
  sectors: SectorRow[];
  counts: { unowned: number; owned: number; forSale: number };
  filters: {
    sectorTypes: { value: CorporationType; label: string }[];
    countries: { value: CountryId; label: string; flag: string }[];
  };
};

const VIEW_TABS: { key: SectorView; label: string }[] = [
  { key: "unowned", label: "Unowned" },
  { key: "owned", label: "Owned" },
  { key: "forSale", label: "For Sale" },
];

const SORT_OPTIONS: { value: SectorSort; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "type", label: "Sector Type" },
  { value: "state", label: "State" },
  { value: "country", label: "Country" },
  { value: "margin", label: "Margin" },
  { value: "growth", label: "Growth" },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export default function SectorsPage() {
  const { navData } = useAuthMe();
  const [data, setData] = useState<SectorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [view, setView] = useState<SectorView>("unowned");
  const [sort, setSort] = useState<SectorSort>("revenue");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  // Default filters from user's corporation / character once on initial load
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  useEffect(() => {
    if (defaultsApplied || !navData) return;
    const corpType = navData.myCorporationType;
    const corpCountry = navData.myCorporationCountryId;
    const charCountry = navData.characterCountryId;
    if (corpType && CORPORATION_TYPES.includes(corpType as CorporationType)) {
      setTypeFilter(corpType);
    }
    const country = corpCountry || charCountry;
    if (country && country in COUNTRY_CONFIGS) {
      setCountryFilter(country);
    }
    setDefaultsApplied(true);
  }, [navData, defaultsApplied]);

  // A country that has been absorbed no longer appears in the filter list, but a
  // player whose character or corporation still points at it would have had it
  // preselected above: the select renders with no matching option and the list
  // comes back empty with nothing to explain why. Clear it so they land on the
  // unfiltered view instead (ticket #1271).
  const availableCountries = data?.filters.countries;
  useEffect(() => {
    if (!availableCountries || !countryFilter) return;
    if (!availableCountries.some((c) => c.value === countryFilter)) {
      setCountryFilter("");
    }
  }, [availableCountries, countryFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("view", view);
      params.set("sort", sort);
      params.set("dir", dir);
      params.set("page", String(page));
      if (typeFilter) params.set("type", typeFilter);
      if (countryFilter) params.set("country", countryFilter);

      const res = await fetch(`/api/sectors?${params.toString()}`);
      if (!res.ok) {
        setError("Failed to load sectors");
        return;
      }
      const json = (await res.json()) as SectorsResponse;
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [view, sort, dir, page, typeFilter, countryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [view, sort, dir, typeFilter, countryFilter]);

  const handleViewChange = (v: SectorView) => {
    setView(v);
    setSort("revenue");
    setDir("desc");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Sectors</h1>
        <p className="mt-1 text-sm text-muted">Browse all economic sectors across every nation.</p>
      </div>

      {/* View tabs + counts */}
      <div className="mb-6 flex flex-wrap gap-2">
        {VIEW_TABS.map((tab) => {
          const isActive = view === tab.key;
          const count = data?.counts[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleViewChange(tab.key)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted hover:bg-card/80 hover:text-foreground"
              }`}
            >
              {tab.label}
              {count !== undefined && (
                <span className="rounded-full bg-card-border/50 px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                  {count.toLocaleString("en-US")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">All sector types</option>
          {data?.filters.sectorTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">All countries</option>
          {data?.filters.countries.map((c) => (
            <option key={c.value} value={c.value}>
              {c.flag} {c.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SectorSort)}
            className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDir(dir === "asc" ? "desc" : "asc")}
            className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
            title={dir === "asc" ? "Ascending" : "Descending"}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {/* Content */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      )}

      {data && data.sectors.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
          No sectors found with the current filters.
        </div>
      )}

      {data && data.sectors.length > 0 && (
        <>
          {/* Sector cards grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.sectors.map((s) => (
              <SectorCard key={s.id} sector={s} view={view} />
            ))}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-muted">
                Showing {(data.page - 1) * 50 + 1}–{Math.min(data.page * 50, data.totalItems)} of{" "}
                {data.totalItems.toLocaleString("en-US")} sectors
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="flex items-center px-2 text-xs text-muted">
                  {data.page} / {data.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={data.page >= data.totalPages}
                  className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectorCard({ sector, view }: { sector: SectorRow; view: SectorView }) {
  const color =
    view === "unowned"
      ? "rgba(128,128,128,0.25)"
      : DEFAULT_CORP_COLORS[sector.sectorType.charCodeAt(0) % DEFAULT_CORP_COLORS.length];

  const sectorHref =
    view !== "unowned" && sector.corporationId
      ? `/corporation/${sector.corporationSequentialId ?? sector.corporationId}/sector/${sector.id}`
      : regionUrl(sector.countryId, sector.stateId);

  return (
    <div
      className="rounded-xl border border-card-border bg-card overflow-hidden transition-colors hover:bg-card/80"
      style={{ borderLeftWidth: "4px", borderLeftColor: color }}
    >
      {/* Header — links to sector detail */}
      <Link href={sectorHref} className="block px-4 pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground text-sm leading-tight">
                {sector.sectorTypeLabel}
              </span>
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${getTypeColor(sector.sectorType)}`}
              >
                {sector.sectorTypeLabel}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
              <span>{sector.stateName}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                {sector.countryFlag} {sector.countryName}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0 ml-3">
            <div className="text-lg font-bold tabular-nums leading-none text-foreground">
              ₳{formatNumber(sector.revenueAnchor)}
            </div>
            <div className="text-[10px] text-muted uppercase tracking-wide mt-0.5">/day</div>
          </div>
        </div>
      </Link>

      {/* Stats row */}
      <div className="flex border-t border-card-border/40 divide-x divide-card-border/40">
        {view !== "unowned" && sector.corporationId && (
          <div className="flex flex-col px-4 py-2.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-muted mb-1">Corporation</span>
            <div className="flex items-center gap-2.5">
              <CorporationLogo
                logoUrl={sector.corporationLogoUrl}
                name={sector.corporationName ?? ""}
                size="h-8 w-8"
                className="rounded-md border border-card-border bg-card-elevated"
              />
              <Link
                href={`/corporation/${sector.corporationSequentialId ?? sector.corporationId}`}
                className="text-xs text-primary hover:underline leading-tight truncate"
              >
                {sector.corporationName}
              </Link>
            </div>
          </div>
        )}
        {view === "unowned" && (
          <div className="flex flex-col px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted mb-1">Status</span>
            <span className="text-xs text-muted leading-tight">Available</span>
          </div>
        )}
        {sector.margin != null && (
          <div className="flex flex-col px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted mb-1">Margin</span>
            <span className="text-xs font-semibold text-success tabular-nums leading-tight">
              {sector.margin.toFixed(1)}%
            </span>
          </div>
        )}
        {sector.growthRate != null && (
          <div className="flex flex-col px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted mb-1">Growth</span>
            <span className="text-xs font-medium leading-tight">
              <span className={sector.growthRate >= 0 ? "text-success" : "text-error"}>
                {sector.growthRate >= 0 ? "+" : ""}
                {sector.growthRate.toFixed(1)}%
              </span>
              <span className="text-muted"> /yr</span>
            </span>
          </div>
        )}
        {view === "forSale" && sector.forSalePrice != null && (
          <div className="flex flex-col px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted mb-1">Price</span>
            <span className="text-xs font-semibold text-success tabular-nums leading-tight">
              ₳{formatNumber(sector.forSalePrice)}
            </span>
          </div>
        )}
      </div>

      {/* Footer link */}
      {view !== "unowned" && sector.corporationId && (
        <div className="border-t border-card-border/50 px-4 py-2">
          <Link
            href={`/corporation/${sector.corporationSequentialId ?? sector.corporationId}/sector/${sector.id}`}
            className="text-[11px] text-muted hover:text-primary transition-colors"
          >
            View sector →
          </Link>
        </div>
      )}
    </div>
  );
}
