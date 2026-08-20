"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Tooltip } from "@/components/Tooltip";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import MarketPie from "../components/MarketPie";
import { DEFAULT_CORP_COLORS } from "../lib/helpers";
import type { Market, SectorData, CorporationRef, Financials } from "../types";

interface MarketPositionPanelProps {
  market: Market;
  sector: SectorData;
  corporation: CorporationRef;
  financials: Financials | null;
  /** compact=true for sidebar use: larger chart, no bottom stats grid, 2-row footer */
  compact?: boolean;
  /** Clearing market mode is on — realized revenue depends on how much actually sold. */
  clearingEnabled?: boolean;
  /** Capital market mode is on — output (and revenue) is gated by owned capacity. */
  capitalEnabled?: boolean;
}

export default function MarketPositionPanel({
  market,
  sector,
  corporation,
  financials,
  compact = false,
  clearingEnabled,
  capitalEnabled,
}: MarketPositionPanelProps) {
  const { formatAmount, formatAmountChip, toInternalFrom } = useCurrency();
  const pieSize = compact ? 160 : 120;

  // Market totals anchor on the sector's country economy, not the viewer's
  // wallet — otherwise a forex shift on the viewer's preferred currency makes
  // the underlying market size appear to drift each turn even when the state
  // economy is stable. Fall back to USD when countryId is missing on legacy
  // sector docs (older than the field's introduction).
  const sectorCurrency = COUNTRY_CURRENCY_MAP[(sector.countryId ?? "US") as CountryId] ?? "USD";
  const corpCurrency = (corporation.liquidCurrencyCode ?? sectorCurrency) as CurrencyCode;
  const marketCurrencyNote = `Market values are normalized for forex. Local mode shows ${sectorCurrency}, this sector's home currency; other display modes convert from the same underlying value.`;
  const fmtMarketChip = (v: number) => formatAmountChip(v, sectorCurrency);
  const fmtCorpSectorMoney = (v: number) =>
    formatAmount(toInternalFrom(v, corpCurrency), corpCurrency);
  // Market figures are stored per financial day; show them per turn (÷24).
  const perTurn = (v: number) => Math.round(v / 24);

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-4 text-lg font-bold text-foreground">
        {compact
          ? "Market Position"
          : `Market Position — ${sector.sectorLabel} in ${sector.stateName}`}
      </h2>

      <div
        className={`mb-4 flex ${compact ? "flex-col" : "flex-col sm:flex-row"} items-center gap-4`}
      >
        <div className="shrink-0">
          <MarketPie
            myShare={market.marketShare}
            myColor={corporation.brandColor ?? "#3b82f6"}
            competitors={market.competitors}
            unownedPercent={market.unownedPercent}
            size={pieSize}
          />
        </div>
        <div className="w-full flex-1 space-y-1.5 text-xs">
          <div className="flex justify-between text-muted">
            <Tooltip content={marketCurrencyNote}>
              <span className="cursor-help border-b border-dashed border-card-border/70">
                Total Market
              </span>
            </Tooltip>
            <span className="font-medium text-foreground">
              {fmtMarketChip(perTurn(market.totalMarket))}/turn
            </span>
          </div>
          {/* This corporation */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: corporation.brandColor ?? "#3b82f6" }}
            />
            <span className="truncate font-medium text-primary">{corporation.name}</span>
            <span className="ml-auto tabular-nums font-medium text-foreground">
              {market.marketShare}%
            </span>
          </div>
          {/* Competitors */}
          {market.competitors.map((comp, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    comp.brandColor || DEFAULT_CORP_COLORS[i % DEFAULT_CORP_COLORS.length],
                }}
              />
              {comp.corporationSequentialId != null || comp.corporationId ? (
                <Link
                  href={`/corporation/${comp.corporationSequentialId ?? comp.corporationId}`}
                  className="truncate text-primary hover:underline"
                >
                  {comp.corporationName}
                </Link>
              ) : (
                <span className="truncate text-foreground">{comp.corporationName}</span>
              )}
              <span className="ml-auto tabular-nums font-medium text-foreground">
                {comp.marketShare}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Compact mode: 1-row footer only */}
      {compact ? (
        <div className="space-y-1.5 border-t border-card-border pt-3 text-xs">
          <div className="flex justify-between">
            <Tooltip content={marketCurrencyNote}>
              <span className="cursor-help border-b border-dashed border-card-border/70 text-muted">
                Total market
              </span>
            </Tooltip>
            <span className="tabular-nums font-medium text-foreground">
              {fmtMarketChip(perTurn(market.totalMarket))}/turn
            </span>
          </div>
        </div>
      ) : (
        /* Full mode: stats grid */
        <div className="grid grid-cols-3 gap-4">
          <div>
            <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
              Your Revenue
            </span>
            <span className="text-sm font-bold tabular-nums text-success">
              {financials ? fmtCorpSectorMoney(perTurn(financials.revenue)) : "—"}
              <span className="text-[10px] font-normal text-muted">/turn</span>
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
              Your Share
            </span>
            <span className="text-sm font-bold tabular-nums text-primary">
              {market.marketShare}%
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
              Competitors
            </span>
            <span className="text-sm font-bold text-foreground">{market.competitors.length}</span>
          </div>
        </div>
      )}
      {(clearingEnabled || capitalEnabled) && (
        <p className="mt-3 border-t border-card-border/60 pt-2 text-[11px] leading-snug text-muted">
          {capitalEnabled
            ? "Revenue — and therefore this sector's valuation and share price — is limited by how much your capacity produces and how much of it actually sells. "
            : "Revenue — and therefore this sector's valuation and share price — reflects how much of your output actually sold this turn, not just your list price. "}
          See the {capitalEnabled ? "Capital and Pricing" : "Pricing"} panels for the drivers.
        </p>
      )}
    </div>
  );
}
