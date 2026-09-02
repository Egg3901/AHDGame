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

  const stateIds = Object.keys(stateCountryMap).sort((a, b) => {
    const aCountry = stateCountryMap[a];
    const bCountry = stateCountryMap[b];
    if (aCountry !== bCountry) return aCountry.localeCompare(bCountry);
    const aSupply = stateSupply[a] ?? 0;
    const bSupply = stateSupply[b] ?? 0;
    return bSupply - aSupply;
  });

  return (
    <div className="rounded-xl border border-card-border bg-card mb-6 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-card-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">Regional Breakdown</h2>
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
        <div className="px-6 pb-6 border-t border-card-border/50">
          <div className="space-y-2 pt-3">
            <div className="grid grid-cols-5 text-xs font-semibold text-muted uppercase tracking-wider pb-2 border-b border-card-border">
              <div>Region</div>
              <div className="text-right">Price</div>
              <div className="text-right">Supply</div>
              <div className="text-right">Demand</div>
              <div className="text-right">Balance</div>
            </div>
            {(() => {
              let lastCountry = "";
              return stateIds.map((stateId) => {
                const country = stateCountryMap[stateId];
                const showHeader = country !== lastCountry;
                lastCountry = country;

                const supply = stateSupply[stateId] ?? 0;
                const demand = stateDemand[stateId] ?? 0;
                const stateBalance = supply - demand;
                const stateTotal = supply + demand;
                const stateSupplyPct = stateTotal > 0 ? (supply / stateTotal) * 100 : 50;
                const stateDemandPct = 100 - stateSupplyPct;
                const currencyCode = getCommodityDisplayCurrency(country as CountryId);

                return (
                  <div key={stateId}>
                    {showHeader && (
                      <div className="flex items-center gap-2 mt-3 mb-1">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                          <CountryFlag country={country as CountryId} size="sm" />
                          {resolveCountryName(country as CountryId)}
                        </span>
                        <div className="flex-1 h-px bg-card-border" />
                      </div>
                    )}
                    <div className="border-b border-card-border/30 last:border-b-0 py-1.5">
                      <div className="grid grid-cols-5 text-sm">
                        <div
                          className="text-foreground font-medium"
                          title={getStateDisplayName(country as CountryId, stateId)}
                        >
                          {getStateDisplayName(country as CountryId, stateId)}
                        </div>
                        <div className="text-right font-mono text-foreground tabular-nums">
                          {formatCommodityPrice(
                            statePrices[stateId] ?? globalPrice,
                            currencyCode,
                            forexEnabled,
                            exchangeRates
                          )}
                        </div>
                        <div className="text-right text-success tabular-nums">
                          {formatUnits(supply, unit)}
                        </div>
                        <div className="text-right text-error tabular-nums">
                          {formatUnits(demand, unit)}
                        </div>
                        <div
                          className={`text-right tabular-nums text-xs font-medium ${
                            stateBalance > 0
                              ? "text-success"
                              : stateBalance < 0
                                ? "text-error"
                                : "text-muted"
                          }`}
                        >
                          {stateBalance > 0 ? "+" : ""}
                          {formatUnits(Math.abs(stateBalance), unit)}
                        </div>
                      </div>
                      {stateTotal > 0 && (
                        <div className="flex h-1 w-full rounded-full overflow-hidden bg-card-elevated mt-1.5">
                          <div
                            className="h-full bg-success/60"
                            style={{ width: `${stateSupplyPct}%` }}
                          />
                          <div
                            className="h-full bg-error/60"
                            style={{ width: `${stateDemandPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
