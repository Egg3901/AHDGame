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
  /**
   * Claimable market share and true buyers' room, in sector output units.
   *
   * These are DIFFERENT QUANTITIES and the panel has to say so. The pie's
   * unclaimed slice is `headroomUnits` — share nobody has built into. What a
   * build is actually allowed to add is `min(headroomUnits, demandGapUnits)`,
   * because unmet demand is the binding constraint: extra units in a glut
   * simply go unsold. Showing only the first is what produced "60.6% of this
   * market is unowned but the game will not let me expand into it"
   * (ticket #1145, #1162). Absent under non-plants tiers, where there is no
   * unit-denominated capacity model to report.
   */
  room?: { headroomUnits: number; demandGapUnits?: number } | null;
}

export default function MarketPositionPanel({
  market,
  sector,
  corporation,
  financials,
  compact = false,
  clearingEnabled,
  capitalEnabled,
  room = null,
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

  // Buyers' room: what a build may actually add. `headroomUnits` alone is
  // claimable SHARE and reads huge in a glut, where the extra units would go
  // unsold — so the binding constraint is unmet demand, and this is the exact
  // expression BuildCapacityDialog gates on. Kept in one place so the two
  // cannot drift.
  const buyersRoomUnits =
    room != null ? Math.max(0, Math.min(room.headroomUnits, room.demandGapUnits ?? 0)) : null;
  const roomIsShareBound =
    room != null && buyersRoomUnits != null && room.headroomUnits <= (room.demandGapUnits ?? 0);
  const fmtUnits = (v: number) => Math.round(v).toLocaleString();

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
          {/* Unclaimed share vs room to build — the two numbers players kept
              reading as one. Named apart, with the gap explained. */}
          {room != null && buyersRoomUnits != null && (
            <>
              <div className="flex items-center gap-2 border-t border-card-border/60 pt-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-muted/30" />
                <Tooltip content="Share of this market nobody has built into yet. It is not the same as room to build: you can only add capacity buyers will actually take.">
                  <span className="cursor-help border-b border-dashed border-card-border/70 text-muted">
                    Unclaimed share
                  </span>
                </Tooltip>
                <span className="ml-auto tabular-nums font-medium text-foreground">
                  {market.unownedPercent}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip
                  content={
                    buyersRoomUnits > 0
                      ? roomIsShareBound
                        ? "Capacity you may still add here, limited by unclaimed share. Buyers exist for more than the market has left to claim."
                        : "Capacity you may still add here, limited by unmet demand. Building past it produces units that go unsold."
                      : "No unmet demand for this output right now, so a build would produce units nobody buys. Unclaimed share stays above zero because it counts market nobody has built into, not buyers waiting."
                  }
                >
                  <span className="cursor-help border-b border-dashed border-card-border/70 text-muted">
                    Room to build
                  </span>
                </Tooltip>
                <span
                  className={`ml-auto tabular-nums font-medium ${buyersRoomUnits > 0 ? "text-foreground" : "text-muted"}`}
                >
                  {fmtUnits(buyersRoomUnits)} units
                </span>
              </div>
            </>
          )}
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
