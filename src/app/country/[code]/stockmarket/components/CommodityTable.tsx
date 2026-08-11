"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatUnits } from "@/lib/utils/formatters";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Tooltip } from "@/components/ui";
import type { CommodityData, ExchangeFilter } from "../types";
import { ShortageHeatMap } from "./ShortageHeatMap";

interface NationalView {
  nationalPrice: number;
  pctVsBase: number;
}

function computeNationalView(commodity: CommodityData): NationalView | null {
  const prices = commodity.statePrices ?? {};
  const supply = commodity.stateSupply ?? {};

  let weightedSum = 0;
  let weightTotal = 0;
  let simpleSum = 0;
  let simpleCount = 0;

  for (const [stateId, price] of Object.entries(prices)) {
    if (price == null) continue;
    const w = supply[stateId] ?? 0;
    weightedSum += price * w;
    weightTotal += w;
    simpleSum += price;
    simpleCount += 1;
  }

  if (simpleCount === 0) return null;

  const nationalPrice = weightTotal > 0 ? weightedSum / weightTotal : simpleSum / simpleCount;
  const pctVsBase =
    commodity.basePrice > 0
      ? ((nationalPrice - commodity.basePrice) / commodity.basePrice) * 100
      : 0;

  return { nationalPrice, pctVsBase };
}

interface CommodityTableProps {
  commodities: CommodityData[];
  exchangeFilter?: ExchangeFilter;
}

export function CommodityTable({ commodities, exchangeFilter = "global" }: CommodityTableProps) {
  const { formatPrice } = useCurrency();
  const [filter, setFilter] = useState("");

  const isNational = exchangeFilter !== "global";

  const filteredCommodities = useMemo(() => {
    let list = [...commodities];
    if (filter) {
      const lower = filter.toLowerCase();
      list = list.filter((c) => c.label.toLowerCase().includes(lower));
    }
    list.sort((a, b) => b.globalPrice - a.globalPrice);
    return list;
  }, [commodities, filter]);

  return (
    <div className="space-y-4">
      {/* Diverging shortage heat map: at-a-glance view of what the world is
          scarce on (scarce = premium = worth supplying). Uses the full global
          commodity set, independent of the table's search filter below. */}
      <ShortageHeatMap commodities={commodities} />
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search commodities..."
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

      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border">
              <tr>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[36%]">
                  Commodity
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  {isNational ? "National Price" : "Global Price"}
                  <Tooltip
                    content={
                      isNational
                        ? "Volume-weighted average of state prices within the selected market"
                        : "Current world market price per unit, reflecting global supply and demand"
                    }
                  />
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  {isNational ? "vs Base" : "Rolling 1Y"}
                  <Tooltip
                    content={
                      isNational
                        ? "National price percentage change from the commodity's base price"
                        : "Price change over the last 48 turns (one in-game year)"
                    }
                  />
                </th>
                {isNational && (
                  <>
                    <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                      Supply
                      <Tooltip content="Total units produced nationally this turn" />
                    </th>
                    <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                      Demand
                      <Tooltip content="Total units consumed nationally this turn" />
                    </th>
                  </>
                )}
                {!isNational && (
                  <>
                    <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                      Supply
                      <Tooltip content="Total units produced globally this turn" />
                    </th>
                    <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                      Demand
                      <Tooltip content="Total units consumed globally this turn" />
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filteredCommodities.length === 0 ? (
                <tr>
                  <td colSpan={isNational ? 5 : 5} className="px-4 py-8 text-center text-muted">
                    No commodities found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredCommodities.map((commodity) => {
                  const national = isNational ? computeNationalView(commodity) : null;
                  const displayPrice = national ? national.nationalPrice : commodity.globalPrice;
                  const displayPct = national
                    ? national.pctVsBase
                    : (commodity.annualPriceChange ?? commodity.priceChange ?? 0);

                  return (
                    <tr
                      key={commodity.commodity}
                      className="group hover:bg-card-elevated/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/commodity/${commodity.commodity}`}
                          className="flex items-center gap-3"
                        >
                          <div className="h-10 w-10 rounded-lg bg-card-elevated flex items-center justify-center border border-card-border shrink-0 shadow-sm group-hover:border-primary/30 transition-colors">
                            <span className="text-xl">{commodity.icon}</span>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                              {commodity.label}
                            </span>
                            <span className="text-xs text-muted">per {commodity.unit}</span>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-mono font-bold tabular-nums text-foreground">
                          {formatPrice(displayPrice)}
                          <span className="ml-1 text-[10px] font-normal text-muted">
                            /{commodity.unit}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
                            displayPct > 0
                              ? "bg-success/10 text-success"
                              : displayPct < 0
                                ? "bg-error/10 text-error"
                                : "bg-muted/10 text-muted"
                          }`}
                        >
                          {displayPct > 0 ? "+" : ""}
                          {displayPct.toFixed(2)}%
                        </div>
                      </td>
                      {isNational && (
                        <>
                          <td className="px-4 py-3 text-right hidden sm:table-cell">
                            <div className="font-medium tabular-nums text-muted">
                              {formatUnits(commodity.exchangeSupply, commodity.unit)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <div className="font-medium tabular-nums text-muted">
                              {formatUnits(commodity.exchangeDemand, commodity.unit)}
                            </div>
                          </td>
                        </>
                      )}
                      {!isNational && (
                        <>
                          <td className="px-4 py-3 text-right hidden sm:table-cell">
                            <div className="font-medium tabular-nums text-muted">
                              {formatUnits(commodity.globalSupply, commodity.unit)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <div className="font-medium tabular-nums text-muted">
                              {formatUnits(commodity.globalDemand, commodity.unit)}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
