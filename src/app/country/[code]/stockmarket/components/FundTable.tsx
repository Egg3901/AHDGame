"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui";
import { FundSparkline } from "@/components/indexFunds/FundSparkline";
import { NavChangeBadge } from "@/components/indexFunds/NavChangeBadge";
import type { FundListItem } from "@/components/indexFunds/types";
import type { PriceChangeTimeframe } from "./StockList";
import type { ExchangeFilter } from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";

type FundSortField = "aum" | "nav" | "change" | "name" | "ticker";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;

function navChangeForTimeframe(fund: FundListItem, timeframe: PriceChangeTimeframe): number | null {
  switch (timeframe) {
    case "1h":
      return fund.navChange1;
    case "24h":
      return fund.navChange24;
    case "48h":
      return fund.navChange48;
  }
}

export function FundTable({
  countryCode,
  exchangeFilter,
  timeframe = "24h",
  onCountChange,
  externalFunds,
  externalLoading,
  externalError,
  corpNames,
}: {
  countryCode: string;
  exchangeFilter: ExchangeFilter;
  timeframe?: PriceChangeTimeframe;
  onCountChange?: (count: number) => void;
  /**
   * Page-shared funds response (also feeds the ticker). When provided, the
   * table renders it instead of fetching, so the tab and the ticker share one
   * request. Absent, the table fetches on its own as before.
   */
  externalFunds?: FundListItem[];
  externalLoading?: boolean;
  externalError?: string;
  /** Corporation display names by id for the holdings preview rows. */
  corpNames?: Map<string, string>;
}) {
  const [ownFunds, setOwnFunds] = useState<FundListItem[]>([]);
  const [ownLoading, setOwnLoading] = useState(true);
  const [ownError, setOwnError] = useState("");
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState<FundSortField>("aum");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [expandedFundId, setExpandedFundId] = useState<string | null>(null);
  const { formatAmount, formatPrice } = useCurrency();

  const usingExternal = externalFunds !== undefined;
  const funds = externalFunds ?? ownFunds;
  const loading = usingExternal ? (externalLoading ?? false) : ownLoading;
  const error = usingExternal ? (externalError ?? "") : ownError;

  const exchangeApi = exchangeFilter === "global" ? "global" : exchangeFilter;

  const fetchFunds = useCallback(async () => {
    setOwnLoading(true);
    setOwnError("");
    try {
      const res = await fetch(`/api/investment-funds?exchange=${exchangeApi}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setOwnFunds([]);
        onCountChange?.(0);
        setOwnLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to load funds");
      const data = (await res.json()) as { funds?: FundListItem[] };
      const list = data.funds ?? [];
      setOwnFunds(list);
      onCountChange?.(list.length);
      setOwnLoading(false);
    } catch (err) {
      setOwnError(err instanceof Error ? err.message : "Failed to load funds");
      setOwnLoading(false);
    }
  }, [exchangeApi, onCountChange]);

  useEffect(() => {
    // With external data the page owns the fetch and the tab count; this
    // effect only runs the table's own fetch in standalone use.
    if (usingExternal) return;
    void fetchFunds();
  }, [fetchFunds, usingExternal]);

  const sortedFunds = useMemo(() => {
    let list = [...funds];
    if (filter) {
      const lower = filter.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(lower) ||
          f.tickerSymbol.toLowerCase().includes(lower) ||
          (f.sectorType?.toLowerCase().includes(lower) ?? false) ||
          (f.countryId?.toLowerCase().includes(lower) ?? false)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "aum":
          cmp = a.aumAnchor - b.aumAnchor;
          break;
        case "nav":
          cmp = a.quotedNav - b.quotedNav;
          break;
        case "change":
          cmp =
            (navChangeForTimeframe(a, timeframe) ?? 0) - (navChangeForTimeframe(b, timeframe) ?? 0);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "ticker":
          cmp = a.tickerSymbol.localeCompare(b.tickerSymbol);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [funds, filter, sortField, sortDir, timeframe]);

  const totalCount = sortedFunds.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sortedFunds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const fundBasePath =
    exchangeFilter === "global"
      ? "/stockmarket/global/fund"
      : `/country/${countryCode.toLowerCase()}/stockmarket/fund`;

  const handleSort = (field: FundSortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-3 border-b border-card-border bg-card-elevated">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={`h-3 ${i === 1 ? "flex-1" : "w-20 shrink-0"}`} />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b border-card-border last:border-0"
          >
            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
            <Skeleton className="h-4 w-32 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-error/20 bg-error/5 p-6 text-center text-error">
        {error}
      </div>
    );
  }

  if (funds.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-muted text-sm">Index funds are not available for this exchange yet.</p>
      </div>
    );
  }

  const sortOptions: { field: FundSortField; label: string }[] = [
    { field: "aum", label: "AUM" },
    { field: "nav", label: "NAV" },
    { field: "change", label: "Change %" },
    { field: "ticker", label: "Ticker" },
    { field: "name", label: "Name" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search funds..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm pl-9 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider shrink-0">
            Sort by:
          </span>
          {sortOptions.map((opt) => (
            <button
              key={opt.field}
              type="button"
              onClick={() => handleSort(opt.field)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                sortField === opt.field
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-card border border-card-border text-muted hover:text-foreground hover:bg-card-elevated"
              }`}
            >
              {opt.label} {sortField === opt.field && (sortDir === "desc" ? "↓" : "↑")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border">
              <tr>
                <th className="px-2 py-2.5 sm:px-4 sm:py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[70px] sm:w-[80px]">
                  Ticker
                </th>
                <th className="px-2 py-2.5 sm:px-4 sm:py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[36%]">
                  Fund
                </th>
                <th className="px-2 py-2.5 sm:px-4 sm:py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  NAV
                </th>
                <th className="px-2 py-2.5 sm:px-4 sm:py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  {timeframe} Change
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Trend
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                  AUM
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden lg:table-cell">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No funds match your search.
                  </td>
                </tr>
              ) : (
                paginated.map((fund) => {
                  const href = `${fundBasePath}/${fund.slug}`;
                  const ccy = fund.anchorCurrencyCode as CurrencyCode;
                  const scopeLabel =
                    fund.kind === "bond"
                      ? fund.scope === "country"
                        ? `${fund.countryId ?? "Country"} Bonds`
                        : "Global Bonds"
                      : fund.scope === "country"
                        ? (fund.countryId ?? "Country")
                        : fund.kind === "sector"
                          ? "Global Sector"
                          : "Global";
                  const isExpanded = expandedFundId === fund.id;
                  return (
                    <Fragment key={fund.id}>
                      <tr className="group hover:bg-card-elevated/50 transition-colors cursor-pointer">
                        <td className="px-2 py-2.5 sm:px-4 sm:py-3">
                          <Link
                            href={href}
                            className="font-mono font-bold text-primary tabular-nums"
                          >
                            {fund.tickerSymbol}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 sm:px-4 sm:py-3">
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            {fund.topHoldings.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedFundId(isExpanded ? null : fund.id)}
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? "Hide" : "Show"} top holdings of ${fund.name}`}
                                className="shrink-0 rounded p-1 text-muted hover:text-foreground transition-colors"
                              >
                                <svg
                                  className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            )}
                            <Link
                              href={href}
                              className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1"
                            >
                              <div className="hidden sm:flex h-10 w-10 rounded-lg bg-primary/10 items-center justify-center border border-primary/20 shrink-0 font-mono text-xs font-bold text-primary">
                                {fund.tickerSymbol.slice(0, 3)}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                  {fund.name}
                                </span>
                                <div className="flex items-center gap-2 text-xs text-muted">
                                  <span className="px-1.5 py-0.5 rounded-md bg-card-elevated border border-card-border uppercase text-[9px] tracking-wide font-semibold">
                                    {scopeLabel}
                                  </span>
                                  {fund.sectorType && (
                                    <span className="truncate capitalize">{fund.sectorType}</span>
                                  )}
                                  <span className="lg:hidden">
                                    <FundStatusBadge
                                      status={fund.status}
                                      backingRatio={fund.backingRatio}
                                    />
                                  </span>
                                </div>
                              </div>
                            </Link>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 sm:px-4 sm:py-3 text-right">
                          <Link href={href} className="block font-mono font-bold tabular-nums">
                            {formatPrice(fund.quotedNav, ccy)}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 sm:px-4 sm:py-3 text-right">
                          <Link href={href} className="inline-block">
                            <NavChangeBadge value={navChangeForTimeframe(fund, timeframe)} />
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          <Link href={href} className="inline-flex justify-end">
                            <FundSparkline history={fund.navSparkline} />
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          <Link href={href} className="block font-medium tabular-nums">
                            {formatAmount(fund.aumAnchor, ccy)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <FundStatusBadge status={fund.status} backingRatio={fund.backingRatio} />
                        </td>
                      </tr>
                      {isExpanded && fund.topHoldings.length > 0 && (
                        <tr>
                          <td colSpan={7} className="bg-card-elevated/30 px-4 py-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                              Top holdings
                            </p>
                            <ul className="space-y-1.5">
                              {fund.topHoldings.map((h) => (
                                <li
                                  key={h.corporationId}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <span className="min-w-0 flex-1 truncate text-foreground">
                                    {corpNames?.get(h.corporationId) ??
                                      `Corp ${h.corporationId.slice(0, 8)}`}
                                  </span>
                                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-card">
                                    <div
                                      className="h-full rounded-full bg-primary/70"
                                      style={{ width: `${Math.min(100, h.weight * 100)}%` }}
                                    />
                                  </div>
                                  <span className="w-12 shrink-0 text-right tabular-nums text-muted">
                                    {(h.weight * 100).toFixed(1)}%
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <Link
                              href={href}
                              className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                            >
                              Full composition
                            </Link>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex flex-col gap-3 border-t border-card-border bg-card-elevated/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted tabular-nums">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalCount)}{" "}
              of {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-card-elevated disabled:pointer-events-none disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs font-medium text-muted tabular-nums px-1">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-card-elevated disabled:pointer-events-none disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FundStatusBadge({
  status,
  backingRatio,
}: {
  status: string;
  backingRatio: number | null;
}) {
  if (status === "paused") {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-warning/10 text-warning border border-warning/30">
        Paused
      </span>
    );
  }
  if (status === "delisted") {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-error/10 text-error border border-error/30">
        Delisted
      </span>
    );
  }
  if (backingRatio !== null && backingRatio < 0.8) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-warning/10 text-warning border border-warning/30">
        {(backingRatio * 100).toFixed(0)}% backed
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-success/10 text-success border border-success/30">
      Active
    </span>
  );
}
