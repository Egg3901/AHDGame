"use client";

import { useEffect, useRef } from "react";
import type { CountryCommodityData } from "@/lib/commodity-map";
import { COUNTRIES_WITH_REGION_MAPS } from "@/lib/commodity-map";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import type { MapMode } from "./CommodityMapModeToggle";

interface CommodityCountryStatCardProps {
  countryId: CountryId;
  commodityLabel: string;
  unit: string;
  data: CountryCommodityData;
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  position?: { x: number; y: number };
  onClose: () => void;
  onViewCountryPage: () => void;
  onViewCountryMap: () => void;
}

function formatUnits(value: number, unit: string): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M ${unit}`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K ${unit}`;
  if (value >= 10) return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export default function CommodityCountryStatCard({
  countryId,
  commodityLabel,
  unit,
  data,
  mode,
  onModeChange,
  forexEnabled,
  exchangeRates,
  position,
  onClose,
  onViewCountryPage,
  onViewCountryMap,
}: CommodityCountryStatCardProps) {
  const desktopRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);
  const config = COUNTRY_CONFIGS[countryId];
  const currencyCode = getCommodityDisplayCurrency(countryId);
  const hasRegionMap = COUNTRIES_WITH_REGION_MAPS.has(countryId);
  const balanceLabel = data.balance > 0 ? "Surplus" : data.balance < 0 ? "Shortage" : "Balanced";
  const balanceColor =
    data.balance > 0 ? "text-success" : data.balance < 0 ? "text-error" : "text-muted";

  // Close on click outside — check both desktop overlay and mobile sheet refs
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const inDesktop = desktopRef.current?.contains(e.target as Node);
      const inMobile = mobileRef.current?.contains(e.target as Node);
      if (!inDesktop && !inMobile) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Prevent card clicks from bubbling to the document handler
  const handleCardInteraction = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Desktop: anchored overlay near click position
  // Mobile: bottom sheet
  return (
    <>
      {/* Desktop overlay card */}
      <div
        ref={desktopRef}
        className="hidden md:block absolute z-30 w-72 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200"
        style={
          position
            ? {
                left: Math.min(position.x + 16, window.innerWidth - 320),
                top: Math.max(position.y - 60, 16),
              }
            : { right: 16, top: 60 }
        }
        onMouseDown={handleCardInteraction}
        onClick={handleCardInteraction}
      >
        <CardContent
          config={config}
          countryId={countryId}
          commodityLabel={commodityLabel}
          unit={unit}
          data={data}
          mode={mode}
          balanceLabel={balanceLabel}
          balanceColor={balanceColor}
          hasRegionMap={hasRegionMap}
          currencyCode={currencyCode}
          forexEnabled={forexEnabled}
          exchangeRates={exchangeRates}
          onModeChange={onModeChange}
          onClose={onClose}
          onViewCountryPage={onViewCountryPage}
          onViewCountryMap={onViewCountryMap}
        />
      </div>

      {/* Mobile bottom sheet */}
      <div className="md:hidden fixed inset-0 z-50 flex items-end">
        {/* Backdrop */}
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Close dialog"
        />
        {/* Sheet */}
        <div
          ref={mobileRef}
          className="relative w-full animate-in slide-in-from-bottom duration-300 ease-out"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 bg-card rounded-t-2xl">
            <div className="w-10 h-1 rounded-full bg-card-border" />
          </div>
          <div className="bg-card px-4 pb-6 rounded-t-2xl -mt-1">
            <CardContent
              config={config}
              countryId={countryId}
              commodityLabel={commodityLabel}
              unit={unit}
              data={data}
              mode={mode}
              balanceLabel={balanceLabel}
              balanceColor={balanceColor}
              hasRegionMap={hasRegionMap}
              currencyCode={currencyCode}
              forexEnabled={forexEnabled}
              exchangeRates={exchangeRates}
              onModeChange={onModeChange}
              onClose={onClose}
              onViewCountryPage={onViewCountryPage}
              onViewCountryMap={onViewCountryMap}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function CardContent({
  config,
  countryId: _countryId,
  commodityLabel,
  unit,
  data,
  mode,
  balanceLabel,
  balanceColor,
  hasRegionMap,
  currencyCode,
  forexEnabled,
  exchangeRates,
  onModeChange,
  onClose,
  onViewCountryPage,
  onViewCountryMap,
}: {
  config: (typeof COUNTRY_CONFIGS)[CountryId];
  countryId: CountryId;
  commodityLabel: string;
  unit: string;
  data: CountryCommodityData;
  mode: MapMode;
  balanceLabel: string;
  balanceColor: string;
  hasRegionMap: boolean;
  currencyCode: CurrencyCode;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  onModeChange: (mode: MapMode) => void;
  onClose: () => void;
  onViewCountryPage: () => void;
  onViewCountryMap: () => void;
}) {
  const total = data.supply + data.demand;
  const supplyPct = total > 0 ? (data.supply / total) * 100 : 50;
  const activePrice = data.avgPrice ?? null;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-card-elevated/50 border-b border-card-border">
        <div className="flex items-center gap-2">
          <CountryFlag country={_countryId} size="md" />
          <div>
            <h3 className="text-sm font-bold text-foreground">{config.name}</h3>
            <p className="text-[10px] text-muted">{commodityLabel}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-card-elevated text-muted hover:text-foreground transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-px bg-card-border/30">
        {activePrice != null && (
          <StatRow
            label={mode === "price" ? "National Price" : "Avg Price"}
            value={formatCommodityPrice(activePrice, currencyCode, forexEnabled, exchangeRates)}
            color="text-foreground"
          />
        )}
        <StatRow
          label="Supply"
          value={`${formatUnits(data.supply, unit)}/day`}
          color="text-success"
        />
        <StatRow
          label="Demand"
          value={`${formatUnits(data.demand, unit)}/day`}
          color="text-error"
        />
        <StatRow
          label="Balance"
          value={`${data.balance > 0 ? "+" : ""}${formatUnits(Math.abs(data.balance), unit)}`}
          color={balanceColor}
          sub={balanceLabel}
        />
      </div>

      {/* Supply/demand bar */}
      {total > 0 && (
        <div className="px-4 py-2">
          <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-card-elevated">
            <div className="h-full bg-success/70" style={{ width: `${supplyPct}%` }} />
            <div className="h-full bg-error/70" style={{ width: `${100 - supplyPct}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-muted">
            <span>Supply {supplyPct.toFixed(0)}%</span>
            <span>Demand {(100 - supplyPct).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-card-border space-y-2">
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onModeChange("supply");
            }}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              mode === "supply"
                ? "bg-success text-white"
                : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            S
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onModeChange("demand");
            }}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              mode === "demand"
                ? "bg-error text-white"
                : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            D
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onModeChange("price");
            }}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              mode === "price"
                ? "bg-primary text-white"
                : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            Price
          </button>
        </div>
        {hasRegionMap ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewCountryMap();
              }}
              className="w-full px-3 py-2.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              View National Map
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewCountryPage();
              }}
              className="w-full text-center text-xs text-muted hover:text-foreground transition-colors py-0.5"
            >
              View Country Page →
            </button>
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewCountryPage();
            }}
            className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-card-border bg-card hover:bg-card-elevated transition-colors text-foreground"
          >
            View Country Page
          </button>
        )}
      </div>

      {/* Region count hint */}
      <div className="px-4 pb-2 text-[10px] text-muted">
        {data.stateCount} {data.stateCount === 1 ? "region" : "regions"} with commodity data
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="px-4 py-2 bg-card">
      <div className="text-[9px] font-semibold text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted">{sub}</div>}
    </div>
  );
}
