"use client";

import { CountryFlag } from "@/components/CountryFlag";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryCommodityData } from "@/lib/commodity-map";
import {
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import type { MapMode } from "./CommodityMapModeToggle";
import { formatUnits } from "../lib/helpers";

export interface CountryRailRow {
  countryId: CountryId;
  /** Sort and bar magnitude for the active mode. */
  magnitude: number;
  label: string;
  tone: "success" | "error" | "warning" | "muted";
}

/**
 * Ranks every country with a book for the active map mode, so the small
 * markets the choropleth can barely show still get a readable number.
 */
export function buildCountryRailRows({
  mode,
  unit,
  basePrice,
  countryData,
  countryCapacity,
  reachableRatioByCountry,
  forexEnabled,
  exchangeRates,
}: {
  mode: MapMode;
  unit: string;
  basePrice: number;
  countryData: Record<string, CountryCommodityData>;
  countryCapacity: Record<string, number>;
  reachableRatioByCountry: Record<string, number | null>;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}): CountryRailRow[] {
  const rows: CountryRailRow[] = [];

  if (mode === "capacity") {
    for (const [countryId, cap] of Object.entries(countryCapacity)) {
      if (cap <= 0) continue;
      rows.push({
        countryId: countryId as CountryId,
        magnitude: cap,
        label: `${formatUnits(cap, unit)}/turn`,
        tone: "warning",
      });
    }
  } else if (mode === "reachable") {
    for (const [countryId, ratio] of Object.entries(reachableRatioByCountry)) {
      rows.push({
        countryId: countryId as CountryId,
        magnitude: ratio == null ? 0 : Math.abs(Math.log(ratio)),
        label: ratio == null ? "No trade" : `${ratio.toFixed(2)}x demand/supply`,
        tone: ratio == null ? "muted" : ratio > 1.15 ? "error" : ratio < 0.85 ? "success" : "muted",
      });
    }
  } else {
    for (const data of Object.values(countryData)) {
      if (mode === "price") {
        if (data.avgPrice == null) continue;
        const currency = getCommodityDisplayCurrency(data.countryId);
        const premium = basePrice > 0 ? data.avgPrice / basePrice : 1;
        rows.push({
          countryId: data.countryId,
          magnitude: premium,
          label: formatCommodityPrice(data.avgPrice, currency, forexEnabled, exchangeRates),
          tone: premium > 1.05 ? "error" : premium < 0.95 ? "success" : "muted",
        });
        continue;
      }
      const value = mode === "supply" ? data.supply : data.demand;
      if (value <= 0) continue;
      rows.push({
        countryId: data.countryId,
        magnitude: value,
        label: formatUnits(value, unit),
        tone: mode === "supply" ? "success" : "error",
      });
    }
  }

  return rows.sort((a, b) => b.magnitude - a.magnitude);
}

const TONE_TEXT: Record<CountryRailRow["tone"], string> = {
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  muted: "text-muted",
};

const TONE_BAR: Record<CountryRailRow["tone"], string> = {
  success: "bg-success/60",
  error: "bg-error/60",
  warning: "bg-warning/60",
  muted: "bg-muted/40",
};

const MODE_TITLE: Record<MapMode, string> = {
  supply: "Supply by country",
  demand: "Demand by country",
  price: "Average price by country",
  capacity: "Deposits by country",
  reachable: "Reachable balance by country",
};

export default function CommodityCountryRail({
  mode,
  rows,
  highlighted,
  onHighlight,
  onSelect,
}: {
  mode: MapMode;
  rows: CountryRailRow[];
  highlighted: CountryId | null;
  onHighlight: (countryId: CountryId | null) => void;
  onSelect: (countryId: CountryId) => void;
}) {
  const resolveCountryName = useCountryDisplayName();
  const max = rows.reduce((m, r) => Math.max(m, r.magnitude), 0) || 1;

  return (
    <div className="flex min-h-0 flex-col border-t border-card-border lg:border-l lg:border-t-0">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
        <h3 className="text-sm font-semibold text-foreground">{MODE_TITLE[mode]}</h3>
        <span className="text-[11px] text-muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted">No country has a book in this view.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 lg:max-h-[440px]">
          {rows.map((row, index) => {
            const active = highlighted === row.countryId;
            return (
              <li key={row.countryId}>
                <button
                  type="button"
                  onMouseEnter={() => onHighlight(row.countryId)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(row.countryId)}
                  onBlur={() => onHighlight(null)}
                  onClick={() => onSelect(row.countryId)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                    active ? "bg-card-elevated" : "hover:bg-card-elevated/60"
                  }`}
                  title="Open regional map"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-right tabular-nums text-muted">{index + 1}</span>
                    <CountryFlag country={row.countryId} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {resolveCountryName(row.countryId)}
                    </span>
                    <span className={`tabular-nums font-semibold ${TONE_TEXT[row.tone]}`}>
                      {row.label}
                    </span>
                  </div>
                  <div className="ml-6 mt-1 h-1 overflow-hidden rounded-full bg-card-elevated">
                    <div
                      className={`h-full rounded-full ${TONE_BAR[row.tone]}`}
                      style={{ width: `${Math.max(2, (row.magnitude / max) * 100)}%` }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
