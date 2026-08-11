"use client";

import { useRouter } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import { getStateDisplayName } from "@/lib/commodity-map";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import CommodityRegionMap from "./CommodityRegionMap";
import CommodityMapModeToggle, { type MapMode } from "./CommodityMapModeToggle";
import CommodityMapLegend from "./CommodityMapLegend";

interface CommodityCountryDrilldownViewProps {
  countryId: CountryId;
  commodityLabel: string;
  unit: string;
  basePrice: number;
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  stateCountryMap: Record<string, string>;
  capacityByState?: Record<string, number>;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  onBack: () => void;
}

function formatUnits(value: number, unit: string): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M ${unit}`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K ${unit}`;
  if (value >= 10) return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export default function CommodityCountryDrilldownView({
  countryId,
  commodityLabel,
  unit,
  basePrice,
  mode,
  onModeChange,
  stateSupply,
  stateDemand,
  statePrices,
  stateCountryMap,
  capacityByState,
  forexEnabled,
  exchangeRates,
  onBack,
}: CommodityCountryDrilldownViewProps) {
  const config = COUNTRY_CONFIGS[countryId];
  const router = useRouter();
  const currencyCode = getCommodityDisplayCurrency(countryId);

  const countryStateIds = Object.keys(stateCountryMap).filter(
    (id) => stateCountryMap[id] === countryId
  );

  // Sort regions by the active mode value (desc)
  const sortedRegions = [...countryStateIds].sort((a, b) => {
    const aVal =
      mode === "price"
        ? (statePrices[a] ?? basePrice)
        : mode === "capacity"
          ? (capacityByState?.[a] ?? 0)
          : mode === "supply"
            ? (stateSupply[a] ?? 0)
            : (stateDemand[a] ?? 0);
    const bVal =
      mode === "price"
        ? (statePrices[b] ?? basePrice)
        : mode === "capacity"
          ? (capacityByState?.[b] ?? 0)
          : mode === "supply"
            ? (stateSupply[b] ?? 0)
            : (stateDemand[b] ?? 0);
    return bVal - aVal;
  });

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-lg overflow-hidden">
      {/* Header with back button */}
      <div className="flex items-center justify-between px-4 py-3 bg-card-elevated/50 border-b border-card-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">World Map</span>
          </button>
          <div className="h-4 w-px bg-card-border" />
          <div className="flex items-center gap-2">
            <CountryFlag country={countryId} size="md" />
            <div>
              <h3 className="text-sm font-bold text-foreground">{config.name} National Map</h3>
              <p className="text-[10px] text-muted">
                {commodityLabel} by {config.regionLabelPlural.toLowerCase()} or regional price
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CommodityMapModeToggle
            mode={mode}
            onModeChange={onModeChange}
            showCapacity={!!capacityByState}
          />
        </div>
      </div>

      {/* Map and legend */}
      <div className="relative">
        <CommodityRegionMap
          countryId={countryId}
          mode={mode}
          basePrice={basePrice}
          stateSupply={stateSupply}
          stateDemand={stateDemand}
          statePrices={statePrices}
          stateCountryMap={stateCountryMap}
          capacityByState={capacityByState}
          unit={unit}
          forexEnabled={forexEnabled}
          exchangeRates={exchangeRates}
          onStateClick={(stateId) => router.push(`/state/${stateId}`)}
        />
        <div className="absolute bottom-3 left-3">
          <CommodityMapLegend
            mode={mode}
            label={commodityLabel}
            unit={unit}
            priceLabel="Regional Price"
          />
        </div>
      </div>

      {/* Regional data table */}
      <div className="border-t border-card-border">
        <div className="px-4 py-2 bg-card-elevated/30">
          <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
            {config.regionLabel} Breakdown
          </h4>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-card-border text-[10px] font-semibold text-muted uppercase tracking-wider">
                <th className="px-4 py-2 text-left">{config.regionLabel}</th>
                {capacityByState && <th className="px-4 py-2 text-right">Deposits</th>}
                <th className="px-4 py-2 text-right">
                  {mode === "price" ? "Regional Price" : "Price"}
                </th>
                <th className="px-4 py-2 text-right">Supply</th>
                <th className="px-4 py-2 text-right">Demand</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {sortedRegions.map((stateId) => {
                const supply = stateSupply[stateId] ?? 0;
                const demand = stateDemand[stateId] ?? 0;
                const balance = supply - demand;
                const stateTotal = supply + demand;
                const supplyPct = stateTotal > 0 ? (supply / stateTotal) * 100 : 50;
                const deposits = capacityByState?.[stateId] ?? 0;
                return (
                  <tr
                    key={stateId}
                    className="border-b border-card-border/30 last:border-b-0 hover:bg-card-elevated/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/state/${stateId}`)}
                  >
                    <td className="px-4 py-2 font-medium text-foreground">
                      {getStateDisplayName(countryId, stateId)}
                    </td>
                    {capacityByState && (
                      <td className="px-4 py-2 text-right tabular-nums text-warning text-xs">
                        {deposits > 0 ? (
                          formatUnits(deposits, unit)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-foreground">
                      {formatCommodityPrice(
                        statePrices[stateId] ?? basePrice,
                        currencyCode,
                        forexEnabled,
                        exchangeRates
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-success">
                      {formatUnits(supply, unit)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-error">
                      {formatUnits(demand, unit)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`tabular-nums text-xs font-medium ${balance > 0 ? "text-success" : balance < 0 ? "text-error" : "text-muted"}`}
                      >
                        {balance > 0 ? "+" : ""}
                        {formatUnits(Math.abs(balance), unit)}
                      </span>
                      {stateTotal > 0 && (
                        <div className="flex h-1 w-full rounded-full overflow-hidden bg-card-elevated mt-1">
                          <div
                            className="h-full bg-success/60"
                            style={{ width: `${supplyPct}%` }}
                          />
                          <div
                            className="h-full bg-error/60"
                            style={{ width: `${100 - supplyPct}%` }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
