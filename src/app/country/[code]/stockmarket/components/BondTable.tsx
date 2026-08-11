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

export function BondTable({ bonds }: { bonds: BondListing[] }) {
  const preset = useActivePreset();
  const { formatPrice, toInternalFrom } = useCurrency();
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<BondTypeFilter>("corporate");
  const [availableOnly, setAvailableOnly] = useState(false);

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
    // Default sort by yield descending
    list.sort((a, b) => b.yieldToMaturity - a.yieldToMaturity);
    return list;
  }, [bonds, filter, typeFilter, availableOnly]);

  const corporateCount = bonds.filter((b) => b.issuerType !== "sovereign").length;
  const sovereignCount = bonds.filter((b) => b.issuerType === "sovereign").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-card-border bg-card p-0.5">
          <button
            onClick={() => setTypeFilter("corporate")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === "corporate"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted hover:text-foreground border border-transparent"
            }`}
          >
            Corporate ({corporateCount})
          </button>
          <button
            onClick={() => setTypeFilter("sovereign")}
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
            onClick={() => setAvailableOnly((v) => !v)}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filteredBonds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No bonds found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredBonds.map((bond) => (
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
