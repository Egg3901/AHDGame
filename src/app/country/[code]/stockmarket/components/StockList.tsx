"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Tooltip } from "@/components/ui";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { StockListing, SortField, SortDir } from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type PriceChangeTimeframe = "1h" | "24h" | "48h";

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "marketCap", label: "Market Cap" },
  { field: "sharePrice", label: "Price" },
  { field: "priceChange", label: "ROI %" },
  { field: "income", label: "Income" },
  { field: "revenue", label: "Revenue" },
  { field: "publicFloat", label: "Float" },
  { field: "tickerSymbol", label: "Ticker" },
  { field: "name", label: "Name" },
];

const PAGE_SIZE = 10;

/**
 * A nation's state-owned enterprises collapsed into one summary row.
 * Only built when a country owns 2+ SoEs — a lone SoE stays a normal row
 * (grouping a single item doesn't reduce clutter and just adds a click).
 */
interface SoEGroup {
  kind: "soeGroup";
  countryId: string;
  countryName: string;
  logoUrl?: string;
  members: StockListing[];
  marketCap: number;
  marketCapAnchor: number;
  totalRevenue: number;
  totalRevenueAnchor: number;
  income: number;
  incomeAnchor: number;
  publicFloat: number;
  totalShares: number;
  priceChange1h: number;
  priceChange24h: number;
  priceChange48h: number;
}

type Row = { kind: "listing"; listing: StockListing } | SoEGroup;

function isSoEGroup(row: Row): row is SoEGroup {
  return row.kind === "soeGroup";
}

/** Market-cap-weighted average of a per-listing field, using anchor mirrors. */
function weightedAverage(members: StockListing[], pick: (l: StockListing) => number): number {
  const totalWeight = members.reduce((s, m) => s + (m.marketCapAnchor ?? m.marketCap), 0);
  if (totalWeight <= 0) return 0;
  const sum = members.reduce((s, m) => s + pick(m) * (m.marketCapAnchor ?? m.marketCap), 0);
  return sum / totalWeight;
}

function buildRows(
  listings: StockListing[],
  /**
   * How to name the owning country of a state-enterprise group. Passed in
   * rather than read from `COUNTRY_CONFIGS` here, so a country renamed at
   * runtime does not head its own group with the name it no longer uses.
   */
  countryName: (id: CountryId) => string
): Row[] {
  const byCountry = new Map<string, StockListing[]>();
  const ungrouped: StockListing[] = [];

  for (const listing of listings) {
    if (listing.isNatcorp && listing.countryOwnerId) {
      const bucket = byCountry.get(listing.countryOwnerId);
      if (bucket) bucket.push(listing);
      else byCountry.set(listing.countryOwnerId, [listing]);
    } else {
      ungrouped.push(listing);
    }
  }

  const rows: Row[] = ungrouped.map((listing) => ({ kind: "listing", listing }));

  for (const [countryId, members] of byCountry) {
    if (members.length < 2) {
      rows.push({ kind: "listing", listing: members[0] });
      continue;
    }
    rows.push({
      kind: "soeGroup",
      countryId,
      countryName: countryName(countryId as CountryId),
      logoUrl: members[0].logoUrl,
      members,
      marketCap: members.reduce((s, m) => s + m.marketCap, 0),
      marketCapAnchor: members.reduce((s, m) => s + (m.marketCapAnchor ?? m.marketCap), 0),
      totalRevenue: members.reduce((s, m) => s + m.totalRevenue, 0),
      totalRevenueAnchor: members.reduce((s, m) => s + (m.totalRevenueAnchor ?? m.totalRevenue), 0),
      income: members.reduce((s, m) => s + m.income, 0),
      incomeAnchor: members.reduce((s, m) => s + (m.incomeAnchor ?? m.income), 0),
      publicFloat: members.reduce((s, m) => s + (m.publicFloat ?? 0), 0),
      totalShares: members.reduce((s, m) => s + m.totalShares, 0),
      priceChange1h: weightedAverage(members, (m) => m.priceChange1h ?? 0),
      priceChange24h: weightedAverage(members, (m) => m.priceChange24h ?? 0),
      priceChange48h: weightedAverage(members, (m) => m.priceChange48h ?? 0),
    });
  }

  return rows;
}

function getPriceChangeForTimeframe(
  getter: { priceChange1h?: number; priceChange24h?: number; priceChange48h?: number },
  tf: PriceChangeTimeframe
): number {
  switch (tf) {
    case "1h":
      return getter.priceChange1h ?? 0;
    case "24h":
      return getter.priceChange24h ?? 0;
    case "48h":
      return getter.priceChange48h ?? 0;
  }
}

/**
 * Sort key extraction shared by individual listings and SoE group summary
 * rows, for fields where a group aggregate is well-defined (unlike share
 * price or ticker, which have no meaningful group-level value — those are
 * handled as explicit cases in the comparator below).
 */
function getSortValue(row: Row, field: SortField, timeframe: PriceChangeTimeframe): number {
  if (isSoEGroup(row)) {
    switch (field) {
      case "marketCap":
        return row.marketCapAnchor;
      case "income":
        return row.incomeAnchor;
      case "revenue":
        return row.totalRevenueAnchor;
      case "priceChange":
        return getPriceChangeForTimeframe(row, timeframe);
      case "publicFloat":
        return row.publicFloat;
      default:
        return 0;
    }
  }
  const l = row.listing;
  switch (field) {
    case "marketCap":
      return l.marketCapAnchor ?? l.marketCap;
    case "income":
      return l.incomeAnchor ?? l.income;
    case "revenue":
      return l.totalRevenueAnchor ?? l.totalRevenue;
    case "priceChange":
      return getPriceChangeForTimeframe(l, timeframe);
    case "publicFloat":
      return l.publicFloat ?? 0;
    default:
      return 0;
  }
}

function getSortName(row: Row): string {
  return isSoEGroup(row) ? row.countryName : row.listing.name;
}

function getSortTicker(row: Row): string | undefined {
  return isSoEGroup(row) ? undefined : row.listing.tickerSymbol;
}

export function StockList({
  listings,
  timeframe = "48h",
}: {
  listings: StockListing[];
  timeframe?: PriceChangeTimeframe;
}) {
  const { formatAmount, formatPrice } = useCurrency();
  const countryName = useCountryDisplayName();
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (countryId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(countryId)) next.delete(countryId);
      else next.add(countryId);
      return next;
    });
  };

  const sortedRows = useMemo(() => {
    let filtered = listings;

    if (filter) {
      const lower = filter.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.name.toLowerCase().includes(lower) ||
          l.typeLabel.toLowerCase().includes(lower) ||
          (l.exchange?.toLowerCase().includes(lower) ?? false) ||
          (l.tickerSymbol?.toLowerCase().includes(lower) ?? false)
      );
    }

    const rows = buildRows(filtered, countryName);

    rows.sort((a, b) => {
      let cmp = 0;
      // Post-v0.2.6: listings in one exchange can carry different liquidCurrencyCodes
      // (e.g. a TSX listing where the corp was relocated). Sort on anchor mirrors
      // so the ranking is currency-comparable; raw per-listing magnitudes would
      // mix currencies. SoE group rows use combined-nation aggregates so they
      // slot into the same ranking as individual corps.
      switch (sortField) {
        case "name":
          cmp = getSortName(a).localeCompare(getSortName(b));
          break;
        case "sharePrice": {
          // A nation's SoE basket has no single share price — sort group
          // rows last regardless of direction, same treatment as tickerless
          // legacy corps below.
          const aGroup = isSoEGroup(a);
          const bGroup = isSoEGroup(b);
          if (aGroup && bGroup) cmp = 0;
          else if (aGroup) cmp = sortDir === "desc" ? -1 : 1;
          else if (bGroup) cmp = sortDir === "desc" ? 1 : -1;
          else {
            const av = a.listing.sharePriceAnchor ?? a.listing.sharePrice;
            const bv = b.listing.sharePriceAnchor ?? b.listing.sharePrice;
            cmp = av - bv;
          }
          break;
        }
        case "tickerSymbol": {
          // Legacy corps (and SoE group rows) without a ticker always sort last,
          // regardless of direction. The final inversion below (`sortDir === "desc"
          // ? -cmp : cmp`) would otherwise float them to the top in one direction,
          // which would feel like garbage data.
          const at = getSortTicker(a);
          const bt = getSortTicker(b);
          if (!at && !bt) cmp = 0;
          else if (!at) cmp = sortDir === "desc" ? -1 : 1;
          else if (!bt) cmp = sortDir === "desc" ? 1 : -1;
          else cmp = at.localeCompare(bt);
          break;
        }
        default:
          cmp = getSortValue(a, sortField, timeframe) - getSortValue(b, sortField, timeframe);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return rows;
  }, [listings, sortField, sortDir, filter, timeframe, countryName]);

  const totalCount = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Clamp page to valid range (handles implicit reset when filter/sort changes shrink results)
  const safePage = Math.min(page, totalPages);
  const paginatedRows = sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const getPriceChangeValue = (listing: StockListing, tf: PriceChangeTimeframe): number =>
    getPriceChangeForTimeframe(listing, tf);

  const renderPriceChangeBadge = (value: number) => (
    <div
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
        value > 0
          ? "bg-success/10 text-success"
          : value < 0
            ? "bg-error/10 text-error"
            : "bg-muted/10 text-muted"
      }`}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </div>
  );

  const renderListingRow = (listing: StockListing, nested: boolean) => (
    <tr
      key={listing._id}
      className={`group hover:bg-card-elevated/50 transition-colors cursor-pointer ${
        nested ? "bg-card-elevated/20" : ""
      }`}
    >
      <td className={`px-4 py-3 ${nested ? "pl-10" : ""}`}>
        {listing.tickerSymbol ? (
          <Link
            href={`/corporation/${listing.sequentialId ?? listing._id}`}
            className="font-mono font-bold text-primary tabular-nums"
          >
            {listing.tickerSymbol}
          </Link>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/corporation/${listing.sequentialId ?? listing._id}`}
          className="flex items-center gap-3"
        >
          <div className="h-10 w-10 rounded-lg bg-card-elevated flex items-center justify-center border border-card-border shrink-0 shadow-sm group-hover:border-primary/30 transition-colors overflow-hidden">
            <CorporationLogo
              logoUrl={listing.logoUrl}
              name={listing.name}
              size="h-10 w-10"
              className="rounded-lg"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
              {listing.name}
            </span>
            <div className="flex items-center gap-2 text-xs text-muted">
              {listing.exchange && (
                <span className="px-1.5 py-0.5 rounded-md bg-card-elevated border border-card-border uppercase text-[9px] tracking-wide font-semibold">
                  {listing.exchange}
                </span>
              )}
              {listing.isNatcorp && !nested && (
                <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 uppercase text-[9px] tracking-wide font-semibold">
                  State-Owned
                </span>
              )}
              {listing.isSubsidiary && (
                <span
                  className="px-1.5 py-0.5 rounded-md bg-muted/40 border border-card-border text-muted-foreground uppercase text-[9px] tracking-wide font-semibold"
                  title={
                    listing.subsidiaryParentName
                      ? `Subsidiary — ${listing.subsidiaryParentName}`
                      : "Subsidiary"
                  }
                >
                  Sub
                </span>
              )}
              <span className="truncate">{listing.typeLabel}</span>
            </div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="font-mono font-bold tabular-nums text-foreground">
          {formatPrice(
            listing.sharePriceAnchor ?? listing.sharePrice,
            (listing.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {renderPriceChangeBadge(getPriceChangeValue(listing, timeframe))}
      </td>
      <td className="px-4 py-3 text-right hidden sm:table-cell">
        <div className="font-medium tabular-nums text-foreground">
          {formatAmount(
            listing.marketCapAnchor ?? listing.marketCap,
            (listing.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right hidden md:table-cell">
        <div className="font-medium tabular-nums text-muted">
          {formatAmount(
            listing.totalRevenueAnchor ?? listing.totalRevenue,
            (listing.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right hidden md:table-cell">
        <div
          className={`font-medium tabular-nums ${listing.income >= 0 ? "text-success" : "text-error"}`}
        >
          {listing.income >= 0 ? "+" : ""}
          {formatAmount(
            listing.incomeAnchor ?? listing.income,
            (listing.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right hidden lg:table-cell">
        {(listing.publicFloat ?? 0) > 0 ? (
          <div className="inline-flex items-center gap-1.5">
            <span className="font-medium tabular-nums text-foreground">
              {(listing.publicFloat ?? 0).toLocaleString("en-US")}
            </span>
            <span className="text-[10px] text-muted">
              ({Math.round(((listing.publicFloat ?? 0) / listing.totalShares) * 100)}%)
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
    </tr>
  );

  const renderGroupRow = (group: SoEGroup) => {
    const isExpanded = expandedGroups.has(group.countryId);
    return (
      <Fragment key={`soe-${group.countryId}`}>
        <tr
          className="group cursor-pointer bg-amber-500/[0.03] hover:bg-amber-500/[0.07] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.countryName} state-owned enterprises (${group.members.length})`}
          onClick={() => toggleGroup(group.countryId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleGroup(group.countryId);
            }
          }}
        >
          <td className="px-4 py-3">
            <span className="text-xs text-muted">—</span>
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 ${
                  isExpanded ? "rotate-90" : ""
                }`}
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
              <div className="h-10 w-10 rounded-lg bg-card-elevated flex items-center justify-center border border-card-border shrink-0 shadow-sm overflow-hidden">
                <CorporationLogo
                  logoUrl={group.logoUrl}
                  name={group.countryName}
                  size="h-10 w-10"
                  className="rounded-lg"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-foreground truncate">{group.countryName}</span>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 uppercase text-[9px] tracking-wide font-semibold">
                    State-Owned
                  </span>
                  <span>{group.members.length} enterprises</span>
                </div>
              </div>
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <span className="text-xs text-muted">—</span>
          </td>
          <td className="px-4 py-3 text-right">
            {renderPriceChangeBadge(getPriceChangeForTimeframe(group, timeframe))}
          </td>
          <td className="px-4 py-3 text-right hidden sm:table-cell">
            <div className="font-medium tabular-nums text-foreground">
              {formatAmount(group.marketCapAnchor)}
            </div>
          </td>
          <td className="px-4 py-3 text-right hidden md:table-cell">
            <div className="font-medium tabular-nums text-muted">
              {formatAmount(group.totalRevenueAnchor)}
            </div>
          </td>
          <td className="px-4 py-3 text-right hidden md:table-cell">
            <div
              className={`font-medium tabular-nums ${group.income >= 0 ? "text-success" : "text-error"}`}
            >
              {group.income >= 0 ? "+" : ""}
              {formatAmount(group.incomeAnchor)}
            </div>
          </td>
          <td className="px-4 py-3 text-right hidden lg:table-cell">
            {group.publicFloat > 0 ? (
              <div className="inline-flex items-center gap-1.5">
                <span className="font-medium tabular-nums text-foreground">
                  {group.publicFloat.toLocaleString("en-US")}
                </span>
                <span className="text-[10px] text-muted">
                  ({Math.round((group.publicFloat / group.totalShares) * 100)}%)
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted">—</span>
            )}
          </td>
        </tr>
        {isExpanded &&
          [...group.members]
            .sort((a, b) => (b.marketCapAnchor ?? b.marketCap) - (a.marketCapAnchor ?? a.marketCap))
            .map((member) => renderListingRow(member, true))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search corporations..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
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
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.field}
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
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[80px]">
                  Ticker
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[40%]">
                  Corporation
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Share Price
                  <Tooltip content="Current price per share on this exchange" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  {timeframe} Change
                  <Tooltip content="Percentage change in share price over the selected period" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Market Cap
                  <Tooltip content="Total market value — share price × total shares issued" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                  Revenue
                  <Tooltip content="Gross revenue earned per game day (24 turns)" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                  Income
                  <Tooltip content="Net income per game day (24 turns) after mandatory dividend distributions: operating income − corporate tax + bond coupon income − bond interest expense − dividends paid to shareholders. Matches the corporation page Income/Hr × 24." />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden lg:table-cell">
                  Float
                  <Tooltip content="Shares available for immediate purchase. Zero means no shares are on the open market." />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No corporations found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) =>
                  isSoEGroup(row) ? renderGroupRow(row) : renderListingRow(row.listing, false)
                )
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
