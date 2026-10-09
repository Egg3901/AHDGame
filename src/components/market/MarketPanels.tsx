"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { StockList } from "@/app/country/[code]/stockmarket/components/StockList";
import { BondTable } from "@/app/country/[code]/stockmarket/components/BondTable";
import { WealthList } from "@/app/country/[code]/stockmarket/components/WealthList";
import { FundTable } from "@/app/country/[code]/stockmarket/components/FundTable";
import type {
  BondListing,
  ExchangeData,
  WealthEntry,
} from "@/app/country/[code]/stockmarket/types";
import type { FundListItem } from "@/components/indexFunds/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { PanelState, pctText, toneClass } from "./marketUi";
import { useMarketJson } from "./useMarketJson";

export const STOCKS_URL = "/api/stock-exchange?exchange=global";
export const stocksUrl = (exchange: string) =>
  `/api/stock-exchange?exchange=${encodeURIComponent(exchange)}`;
export const BONDS_URL = "/api/bonds";
export const FUNDS_URL = "/api/investment-funds?exchange=global";

export interface BondsResponse {
  bonds?: BondListing[];
  totalOutstanding?: number;
}
export interface FundsResponse {
  funds?: FundListItem[];
}

export function StocksPanel({ exchange = "global" }: { exchange?: string }) {
  const { data, error, loading } = useMarketJson<ExchangeData>(stocksUrl(exchange));
  const [showNpp, setShowNpp] = useState(false);
  const all = data?.listings ?? [];
  const nppCount = all.filter((l) => l.isNpp).length;
  const visible = showNpp ? all : all.filter((l) => !l.isNpp);
  return (
    <PanelState
      loading={loading}
      error={error}
      empty={all.length === 0}
      emptyText="No listed corporations yet."
    >
      {nppCount > 0 && (
        <label className="mb-3 flex cursor-pointer items-center justify-end gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-primary"
            checked={showNpp}
            onChange={(e) => setShowNpp(e.target.checked)}
          />
          Show NPP corporations ({nppCount})
        </label>
      )}
      <StockList listings={visible} timeframe="24h" />
    </PanelState>
  );
}

export interface WealthResponse {
  entries?: WealthEntry[];
}

export const wealthUrl = (exchange: string) =>
  `/api/stock-exchange/wealth-list?exchange=${encodeURIComponent(exchange)}`;

export function WealthPanel({ exchange = "global" }: { exchange?: string }) {
  const { data, error, loading } = useMarketJson<WealthResponse>(wealthUrl(exchange));
  const entries = data?.entries ?? [];
  return (
    <PanelState
      loading={loading}
      error={error}
      empty={entries.length === 0}
      emptyText="No wealth rankings yet."
    >
      <WealthList entries={entries} />
    </PanelState>
  );
}

export function BondsPanel() {
  const { data, error, loading } = useMarketJson<BondsResponse>(BONDS_URL);
  return (
    <PanelState loading={loading} error={error}>
      <BondTable bonds={data?.bonds ?? []} totalOutstanding={data?.totalOutstanding} />
    </PanelState>
  );
}

export function FundsPanel() {
  const { data, error, loading } = useMarketJson<FundsResponse>(FUNDS_URL);
  return (
    <FundTable
      countryCode="global"
      exchangeFilter="global"
      externalFunds={data?.funds ?? []}
      externalLoading={loading}
      externalError={error}
    />
  );
}

export interface SectorForSale {
  id: string;
  sectorType: CorporationType;
  sectorTypeLabel: string;
  stateName: string;
  countryName: string;
  countryFlag: string;
  corporationId: string | null;
  corporationName: string | null;
  corporationSequentialId: number | null;
  revenueAnchor: number;
  margin: number | null;
  growthRate: number | null;
  forSalePrice: number | null;
}

export interface SectorsForSaleResponse {
  page: number;
  totalPages: number;
  totalItems: number;
  sectors: SectorForSale[];
  counts: { unowned: number; owned: number; forSale: number };
}

export const sectorsUrl = (page: number) =>
  `/api/sectors?view=forSale&sort=revenue&dir=desc&page=${page}`;

export function SectorsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useMarketJson<SectorsForSaleResponse>(sectorsUrl(page));
  const { formatAmount } = useCurrency();
  const rows = data?.sectors ?? [];
  return (
    <PanelState
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyText="No sectors are for sale."
    >
      <section className="rounded-xl border border-card-border bg-card shadow-card">
        <p className="px-4 pt-3 text-sm text-muted">
          {(data?.totalItems ?? 0).toLocaleString()} for sale. Open a sector to review it and buy
          with a corporation you run.
        </p>
        <ul className="mt-2">
          {rows.map((s) => {
            const href = s.corporationId
              ? `/corporation/${s.corporationSequentialId ?? s.corporationId}/sector/${s.id}`
              : "/sectors";
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-card-border/50 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <Link href={href} className="text-sm font-medium text-foreground hover:underline">
                    {s.sectorTypeLabel}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {s.stateName} · {s.countryFlag} {s.countryName}
                    {s.corporationName ? ` · ${s.corporationName}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-muted">{formatAmount(s.revenueAnchor)} /day</span>
                  {s.growthRate != null && (
                    <span className={toneClass(s.growthRate)}>{pctText(s.growthRate)} /yr</span>
                  )}
                  {s.forSalePrice != null && (
                    <span className="text-sm font-semibold text-foreground">
                      {formatAmount(s.forSalePrice)}
                    </span>
                  )}
                  <Link
                    href={href}
                    className="inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 font-medium text-white hover:bg-primary/90"
                  >
                    Review and buy
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-card-border/50 px-4 py-2 text-xs text-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-7 rounded-md border border-card-border px-2.5 text-foreground disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {data?.page ?? page} of {data?.totalPages ?? 1}
          </span>
          <button
            type="button"
            disabled={page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((p) => p + 1)}
            className="h-7 rounded-md border border-card-border px-2.5 text-foreground disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>
    </PanelState>
  );
}

export function CurrenciesPanel() {
  return (
    <section className="rounded-xl border border-card-border bg-card p-5 shadow-card">
      <h2 className="text-heading-sm font-bold text-foreground">Currency exchange</h2>
      <p className="mt-1 text-sm text-muted">
        Swap between national currencies at the current rates and see how each one has moved.
      </p>
      <Link
        href="/forex/global"
        className="mt-3 inline-flex h-8 items-center rounded-md border border-primary bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
      >
        Open the exchange
      </Link>
    </section>
  );
}
