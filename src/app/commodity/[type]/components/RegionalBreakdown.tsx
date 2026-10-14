"use client";

import { useState } from "react";

import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatUnits } from "../lib/helpers";
import { getStateDisplayName } from "@/lib/commodity-map";
import {
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

/** Regions shown per country before the list folds. */
const REGION_PREVIEW_ROWS = 8;

interface RegionalBreakdownProps {
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  stateCountryMap: Record<string, string>;
  globalPrice: number;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  unit: string;
}

export default function RegionalBreakdown({
  stateSupply,
  stateDemand,
  statePrices,
  stateCountryMap,
  globalPrice,
  forexEnabled,
  exchangeRates,
  unit,
}: RegionalBreakdownProps) {
  const resolveCountryName = useCountryDisplayName();
  const [isOpen, setIsOpen] = useState(true);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const stateIds = Object.keys(stateCountryMap);
  const byCountry = new Map<string, string[]>();
  for (const stateId of stateIds) {
    const country = stateCountryMap[stateId];
    const list = byCountry.get(country) ?? [];
    list.push(stateId);
    byCountry.set(country, list);
  }
  // Largest market first, and the biggest regions first inside each one.
  const volume = (id: string) => (stateSupply[id] ?? 0) + (stateDemand[id] ?? 0);
  const groups = [...byCountry.entries()]
    .map(([country, ids]) => ({
      country,
      ids: ids.sort((a, b) => volume(b) - volume(a)),
      total: ids.reduce((sum, id) => sum + volume(id), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="rounded-xl border border-card-border bg-card mb-6 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-card-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">Regional breakdown</h2>
          <span className="text-xs text-muted px-2 py-0.5 rounded-full bg-card-elevated">
            {stateIds.length} regions
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="relative overflow-x-auto border-t border-card-border/50 px-6 pb-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold text-muted">
                <th className="py-2 font-semibold">Region</th>
                <th className="py-2 text-right font-semibold">Price</th>
                <th className="py-2 text-right font-semibold">Supply</th>
                <th className="py-2 text-right font-semibold">Demand</th>
                <th className="py-2 text-right font-semibold">Balance</th>
                <th className="w-[18%] py-2 pl-4 font-semibold">
                  <span className="sr-only">Supply share</span>
                </th>
              </tr>
            </thead>
            {groups.map(({ country, ids }) => {
              const currencyCode = getCommodityDisplayCurrency(country as CountryId);
              const isExpanded = expanded[country] ?? false;
              const visible = isExpanded ? ids : ids.slice(0, REGION_PREVIEW_ROWS);
              const hidden = ids.length - visible.length;

              return (
                <tbody key={country}>
                  <tr>
                    <td colSpan={6} className="pb-1 pt-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <CountryFlag country={country as CountryId} size="sm" />
                        {resolveCountryName(country as CountryId)}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          {ids.length} regions
                        </span>
                      </span>
                    </td>
                  </tr>
                  {visible.map((stateId) => {
                    const supply = stateSupply[stateId] ?? 0;
                    const demand = stateDemand[stateId] ?? 0;
                    const stateBalance = supply - demand;
                    const stateTotal = supply + demand;
                    const stateSupplyPct = stateTotal > 0 ? (supply / stateTotal) * 100 : 50;
                    const name = getStateDisplayName(country as CountryId, stateId);

                    return (
                      <tr key={stateId} className="border-b border-card-border/30">
                        <td
                          className="max-w-[12rem] truncate py-1.5 pr-3 font-medium text-foreground"
                          title={name}
                        >
                          {name}
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                          {formatCommodityPrice(
                            statePrices[stateId] ?? globalPrice,
                            currencyCode,
                            forexEnabled,
                            exchangeRates
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-success">
                          {formatUnits(supply, unit)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-error">
                          {formatUnits(demand, unit)}
                        </td>
                        <td
                          className={`py-1.5 text-right tabular-nums font-medium ${
                            stateBalance > 0
                              ? "text-success"
                              : stateBalance < 0
                                ? "text-error"
                                : "text-muted"
                          }`}
                        >
                          {stateBalance > 0 ? "+" : ""}
                          {formatUnits(stateBalance, unit)}
                        </td>
                        <td className="py-1.5 pl-4">
                          {stateTotal > 0 && (
                            <div
                              className="flex h-1.5 w-full overflow-hidden rounded-full bg-card-elevated"
                              title={`${Math.round(stateSupplyPct)}% of local volume is supply`}
                            >
                              <div
                                className="h-full bg-success/60"
                                style={{ width: `${stateSupplyPct}%` }}
                              />
                              <div className="h-full flex-1 bg-error/60" />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(hidden > 0 || isExpanded) && ids.length > REGION_PREVIEW_ROWS && (
                    <tr>
                      <td colSpan={6} className="pt-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [country]: !isExpanded }))
                          }
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {isExpanded ? "Show fewer" : `Show all ${ids.length} regions`}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}
