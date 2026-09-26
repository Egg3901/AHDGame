"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Tooltip } from "@/components/ui";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import type { BondListing } from "../types";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

type BondTypeFilter = "corporate" | "sovereign";
type BondSortField = "yield" | "coupon" | "maturity" | "available" | "holders";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;

const BOND_SORT_OPTIONS: { field: BondSortField; label: string }[] = [
  { field: "yield", label: "Yield" },
  { field: "coupon", label: "Coupon" },
  { field: "maturity", label: "Maturity" },
  { field: "available", label: "Available" },
  { field: "holders", label: "Holders" },
];

export function BondTable({
  bonds,
  totalOutstanding,
  ownedUnits,
}: {
  bonds: BondListing[];
  /** Board-wide outstanding notional in anchor units (from /api/bonds). */
  totalOutstanding?: number;
  /** Viewer bond units by bond id. */
  ownedUnits?: Map<string, number>;
}) {
  const preset = useActivePreset();
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<BondTypeFilter>("corporate");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortField, setSortField] = useState<BondSortField>("yield");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const filteredBonds = useMemo(() => {
    let list = bonds.filter((b) =>
      typeFilter === "sovereign" ? b.issuerType === "sovereign" : b.issuerType !== "sovereign"
    );
    if (availableOnly) {
      list = list.filter((b) => (b.publicFloat ?? 0) > 0);
    }
    if (filter) {
      const lower = filter.toLowerCase();
      list = list.filter(
        (b) =>
          b.corporationName.toLowerCase().includes(lower) ||
          b.maturityLabel.toLowerCase().includes(lower)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "yield":
          cmp = a.yieldToMaturity - b.yieldToMaturity;
          break;
        case "coupon":
          cmp = a.couponRate - b.couponRate;
          break;
        case "maturity":
          cmp = a.turnsRemaining - b.turnsRemaining;
          break;
        case "available":
          cmp = (a.publicFloat ?? 0) - (b.publicFloat ?? 0);
          break;
        case "holders":
          cmp = a.holders - b.holders;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [bonds, filter, typeFilter, availableOnly, sortField, sortDir]);

  const totalCount = filteredBonds.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedBonds = filteredBonds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (field: BondSortField) => {
    setPage(1);
    if (field === sortField) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const corporateCount = bonds.filter((b) => b.issuerType !== "sovereign").length;
  const sovereignCount = bonds.filter((b) => b.issuerType === "sovereign").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-card-border bg-card p-0.5">
          <button
            onClick={() => {
              setTypeFilter("corporate");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === "corporate"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted hover:text-foreground border border-transparent"
            }`}
          >
            Corporate ({corporateCount})
          </button>
          <button
            onClick={() => {
              setTypeFilter("sovereign");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === "sovereign"
                ? "bg-secondary/15 text-secondary border border-secondary/30"
                : "text-muted hover:text-foreground border border-transparent"
            }`}
          >
            Sovereign ({sovereignCount})
          </button>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            onClick={() => {
              setAvailableOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={availableOnly}
            title="Show only bonds with units currently available to buy"
            className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
              availableOnly
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-muted hover:text-foreground border-card-border"
            }`}
          >
            Available only
          </button>
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search bonds..."
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
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-xs text-muted tabular-nums">
          {bonds.length} issue{bonds.length === 1 ? "" : "s"}
          {totalOutstanding != null && totalOutstanding > 0
            ? ` · ${formatAmount(totalOutstanding)} outstanding`
            : ""}
        </p>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider shrink-0">
            Sort by:
          </span>
          {BOND_SORT_OPTIONS.map((opt) => (
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
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[40%]">
                  Issuer
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Yield
                  <Tooltip content="Annualised return if held to maturity, based on current market price" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Coupon
                  <Tooltip content="Fixed annual interest rate paid on the bond's face value each turn" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Maturity
                  <Tooltip content="Turns remaining until the bond matures and principal is repaid" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                  Price
                  <Tooltip content="Current market price per bond unit" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                  Available
                  <Tooltip content="Bond units currently on offer for purchase" />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden lg:table-cell">
                  Holders
                  <Tooltip content="Players and corporations currently holding this bond" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filteredBonds.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No bonds found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedBonds.map((bond) => (
                  <tr
                    key={bond._id}
                    className="group hover:bg-card-elevated/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/bond/${bond._id}`} className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-card-elevated flex items-center justify-center border border-card-border shrink-0 shadow-sm group-hover:border-primary/30 transition-colors text-muted overflow-hidden">
                          {bond.issuerType === "sovereign" && bond.countryId ? (
                            <Image
                              src={getCountryFlagUrlForEra(bond.countryId, preset)}
                              alt={bond.corporationName}
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                              unoptimized={bypassNextImageOptimization(
                                getCountryFlagUrlForEra(bond.countryId, preset)
                              )}
                            />
                          ) : (
                            <CorporationLogo
                              logoUrl={bond.logoUrl}
                              name={bond.corporationName}
                              size="h-10 w-10"
                              className="rounded-lg"
                            />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                            {bond.corporationName}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-muted">
                            {bond.defaulted && (
                              <span className="px-1.5 py-0.5 rounded-md bg-error/10 border border-error/20 text-error uppercase text-[9px] tracking-wide font-bold">
                                Defaulted
                              </span>
                            )}
                            <span className="truncate">Series {bond.maturityLabel}</span>
                            {(ownedUnits?.get(bond._id) ?? 0) > 0 && (
                              <span
                                className="shrink-0 px-1.5 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-primary uppercase text-[9px] tracking-wide font-semibold whitespace-nowrap"
                                title="Units you hold. See Portfolio for the full position."
                              >
                                You: {(ownedUnits?.get(bond._id) ?? 0).toLocaleString("en-US")}
                              </span>
                            )}
                            <span className="md:hidden text-muted/70">
                              · {(bond.publicFloat ?? 0).toLocaleString("en-US")} units avail
                            </span>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-mono font-bold tabular-nums text-success">
                        {bond.yieldToMaturity.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-medium tabular-nums text-foreground">
                        {bond.couponRate.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <div className="font-medium tabular-nums text-muted">
                        {bond.turnsRemaining} turns
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <div className="font-medium tabular-nums text-foreground">
                        {/* `bond.pricePerUnit` is LOCAL in `bond.currencyCode` post-v0.2.6;
                            normalize LOCAL → ₳ before formatPrice so wallet-pref display
                            applies the correct scale + symbol. Pre-B10 fed raw LOCAL into
                            formatPrice, producing values like "$114K" for JP ¥1K face bonds. */}
                        {(() => {
                          const raw = bond.pricePerUnit ?? bond.marketPrice;
                          const code = (bond.currencyCode ?? undefined) as
                            import("@/lib/constants/currencies").CurrencyCode | undefined;
                          const anchor = code ? toInternalFrom(raw, code) : raw;
                          return formatPrice(anchor, code);
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <div className="font-medium tabular-nums text-muted">
                        {(bond.publicFloat ?? 0).toLocaleString("en-US")} units
                      </div>
                      {bond.totalUnits > 0 && (
                        <div
                          className="mt-1 h-1 w-20 ml-auto overflow-hidden rounded-full bg-card-elevated"
                          title={`${bond.totalUnitsHeld.toLocaleString("en-US")} of ${bond.totalUnits.toLocaleString("en-US")} units absorbed`}
                        >
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${Math.min(100, (bond.totalUnitsHeld / bond.totalUnits) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <div className="font-medium tabular-nums text-muted">
                        {bond.holders.toLocaleString("en-US")}
                      </div>
                    </td>
                  </tr>
                ))
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
