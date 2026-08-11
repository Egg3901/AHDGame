"use client";

import { HeroImage } from "@/components/HeroImage";
import { COMMODITY_HERO_SLUGS, COMMODITY_HERO_ALTS } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";
import { formatCurrencyPrecise } from "@/lib/utils/formatters";
import BackButton from "@/components/BackButton";
import { formatUnits } from "../lib/helpers";
import type { CommodityDetail } from "../types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { isStateRegister } from "@/lib/constants/exchangeRegistry";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import type { CommodityMarketScope } from "../lib/marketScope";
import { useMemo } from "react";

interface HeroPanelProps {
  data: CommodityDetail;
  marketScope: CommodityMarketScope;
  activeCountry: CountryId | null;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  onSelectExchange: (countryId: CountryId | null) => void;
}

export default function HeroPanel({
  data,
  marketScope,
  activeCountry,
  forexEnabled,
  exchangeRates,
  onSelectExchange,
}: HeroPanelProps) {
  const registered = useRegisteredCountries();
  // Exchange tabs follow the runtime registered set, filtered to countries that
  // actually run a market (exchangeName). A latent SCO/WAL surfaces here only once
  // activated and configured with an exchange. Command economies are excluded:
  // they carry an exchangeName so their state enterprises have a listing venue,
  // but a planning committee is not a commodity market — `exchangeName` alone
  // stopped meaning "runs a market" once state registers were introduced.
  const exchangeTabs = useMemo<{ countryId: CountryId; label: string }[]>(
    () =>
      registered
        .filter((id) => !!COUNTRY_CONFIGS[id].exchangeName && !isStateRegister(id))
        .map((id) => ({ countryId: id, label: COUNTRY_CONFIGS[id].exchangeName!.toUpperCase() })),
    [registered]
  );
  const heroSlug = COMMODITY_HERO_SLUGS[data.commodity as CommodityType];
  const heroAlt = COMMODITY_HERO_ALTS[data.commodity as CommodityType] ?? data.label;
  const selectedCurrency = activeCountry ? getCommodityDisplayCurrency(activeCountry) : null;
  const priceDisplay = selectedCurrency
    ? formatCommodityPrice(marketScope.marketPrice, selectedCurrency, forexEnabled, exchangeRates)
    : formatCurrencyPrecise(marketScope.marketPrice);
  const basePriceDisplay = selectedCurrency
    ? formatCommodityPrice(data.basePrice, selectedCurrency, forexEnabled, exchangeRates)
    : formatCurrencyPrecise(data.basePrice);

  const balance = marketScope.balance;
  const balanceLabel = balance > 0 ? "Surplus" : balance < 0 ? "Shortage" : "Balanced";
  const balanceColor = balance > 0 ? "text-success" : balance < 0 ? "text-error" : "text-muted";

  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg mb-6">
      <div className="relative h-[160px] w-full sm:h-[200px]">
        <HeroImage
          src={`/api/images/hero/${heroSlug}`}
          alt={heroAlt}
          fill
          className="object-cover"
          style={{ objectPosition: "center 40%" }}
          priority
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
          aria-hidden
        />

        <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
          {/* Top row */}
          <div className="flex items-center justify-between gap-2">
            <BackButton
              iconOnly
              fallbackLabel="Back"
              fallbackHref="/country/us/stockmarket?tab=commodities"
            />
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                onClick={() => onSelectExchange(null)}
                className={`rounded-lg backdrop-blur-sm border px-3 py-1 text-xs font-bold transition-colors ${
                  activeCountry === null
                    ? "bg-white/20 border-white/40 text-white"
                    : "bg-black/50 border-white/10 text-white/80 hover:text-white"
                }`}
              >
                GLOBAL
              </button>
              {exchangeTabs.map(({ countryId, label }) => (
                <button
                  key={countryId}
                  onClick={() => onSelectExchange(countryId)}
                  className={`rounded-lg backdrop-blur-sm border px-3 py-1 text-xs font-bold transition-colors ${
                    activeCountry === countryId
                      ? "bg-white/20 border-white/40 text-white"
                      : "bg-black/50 border-white/10 text-white/80 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom row */}
          <div className="flex items-end gap-3">
            <span
              className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border text-base font-bold shadow-md ${data.colors}`}
            >
              {data.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-white/70 drop-shadow italic mb-0.5">
                Base: {basePriceDisplay}/{data.unit.replace(/s$/, "")}
              </p>
              <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                {data.label}
              </h1>
            </div>
          </div>
        </div>
      </div>
      {/* Stats strip */}
      <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            Market Price
          </span>
          <span className="text-base font-bold tabular-nums">{priceDisplay}</span>
          <span
            className={`text-xs tabular-nums ${
              marketScope.priceChange > 0
                ? "text-error"
                : marketScope.priceChange < 0
                  ? "text-success"
                  : "text-muted"
            }`}
          >
            {marketScope.priceChange > 0 ? "+" : ""}
            {marketScope.priceChange}% vs base
          </span>
          <span className="mt-1 text-[10px] text-muted">{marketScope.marketCaption}</span>
        </div>
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            {activeCountry ? "Regions" : "Rolling 1Y"}
          </span>
          {activeCountry ? (
            <>
              <span className="text-base font-bold tabular-nums text-foreground">
                {marketScope.regionCount}
              </span>
              <span className="text-xs text-muted">
                {COUNTRY_CONFIGS[activeCountry].regionLabelPlural}
              </span>
            </>
          ) : (
            <>
              <span
                className={`text-base font-bold tabular-nums ${
                  data.annualPriceChange > 0
                    ? "text-success"
                    : data.annualPriceChange < 0
                      ? "text-error"
                      : "text-muted"
                }`}
              >
                {data.annualPriceChange > 0 ? "+" : ""}
                {data.annualPriceChange.toFixed(2)}%
              </span>
              <span className="text-xs text-muted">48-turn annualized</span>
            </>
          )}
        </div>
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            {activeCountry ? "National Supply" : "Global Supply"}
          </span>
          <span className="text-base font-bold tabular-nums text-success">
            {formatUnits(marketScope.supply, data.unit)}
          </span>
          <span className="text-xs text-muted">per day</span>
        </div>
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            {activeCountry ? "National Demand" : "Global Demand"}
          </span>
          <span className="text-base font-bold tabular-nums text-error">
            {formatUnits(marketScope.demand, data.unit)}
          </span>
          <span className="text-xs text-muted">per day</span>
        </div>
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            Balance
          </span>
          <span className={`text-base font-bold tabular-nums ${balanceColor}`}>
            {balance > 0 ? "+" : ""}
            {formatUnits(Math.abs(balance), data.unit)}
          </span>
          <span className={`text-xs ${balanceColor}`}>{balanceLabel}</span>
        </div>
      </div>
    </header>
  );
}
