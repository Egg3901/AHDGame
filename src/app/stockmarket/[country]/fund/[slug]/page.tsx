"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { use, useCallback, useEffect, useState, Suspense } from "react";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { NavChangeBadge } from "@/components/indexFunds/NavChangeBadge";
import type { FundDetail } from "@/components/indexFunds/types";
import { FundActions, type FundCorporationAccount } from "@/components/indexFunds/FundActions";
import FundFinancialsTab, {
  type FundFinancialsData,
  type FundBalanceSheetData,
} from "@/components/indexFunds/FundFinancialsTab";
import FundSubscribersTab from "@/components/indexFunds/FundSubscribersTab";
import { FundNavChart } from "@/components/indexFunds/FundNavChart";
import { BondHoldingsPanel } from "@/components/indexFunds/BondHoldingsPanel";
import { ConstituentsPanel } from "@/components/indexFunds/ConstituentsPanel";
import { BackingRatioGauge } from "@/components/indexFunds/BackingRatioGauge";
import { AssetCompositionBar } from "@/components/indexFunds/AssetCompositionBar";
import { YourPositionCard } from "@/components/indexFunds/YourPositionCard";
import { SponsorshipCard } from "@/components/indexFunds/SponsorshipCard";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { PriceChangeTimeframe } from "@/app/country/[code]/stockmarket/components/StockList";

export default function FundDetailPage({
  params,
}: {
  params: Promise<{ country: string; slug: string }>;
}) {
  return (
    <Suspense>
      <FundDetailPageInner params={params} />
    </Suspense>
  );
}

function FundDetailPageInner({ params }: { params: Promise<{ country: string; slug: string }> }) {
  const { country, slug } = use(params);
  const { formatAmount, formatPrice, forexEnabled, forexRates } = useCurrency();
  const [data, setData] = useState<{
    fund: FundDetail;
    corporationAccounts?: FundCorporationAccount[];
    summary: { totalHolders: number; totalNonReserveUnits: number };
    myPosition: { units: number; legacyUnits: number; avgNavAnchor: number | null } | null;
    navHistory: {
      turn: number;
      quotedNav: number;
    }[];
  } | null>(null);
  const [financials, setFinancials] = useState<FundFinancialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [timeframe, setTimeframe] = useState<PriceChangeTimeframe>("24h");
  const [activeTab, setActiveTab] = useState<
    "overview" | "holdings" | "financials" | "subscribers"
  >("overview");

  const stockMarketHref = `/stockmarket/${country.toLowerCase()}?tab=funds`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [fundRes, txData] = await Promise.all([
        fetch(`/api/investment-funds/${slug}`, { cache: "no-store" }),
        fetchJson<FundFinancialsData>(`/api/investment-funds/${slug}/transactions`, {
          cache: "no-store",
          feature: "index-fund-transactions",
        }).catch(() => null),
      ]);

      if (fundRes.status === 403) {
        setError("Index funds are not enabled.");
        return;
      }
      if (!fundRes.ok) {
        const body = (await fundRes.json()) as { error?: string };
        setError(apiErrorText(body, "Fund not found"));
        return;
      }
      setData(await fundRes.json());

      if (txData) {
        setFinancials(txData);
      }
    } catch {
      setError("Failed to load fund");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16" data-replay-block>
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16" data-replay-block>
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <BackButton fallbackHref={stockMarketHref} fallbackLabel="Funds" />
          <div className="rounded-xl border border-error/20 bg-error/5 p-6 text-center text-error">
            {error || "Fund not found"}
          </div>
        </main>
      </div>
    );
  }

  const { fund, summary, myPosition, navHistory } = data;
  const ccy = fund.anchorCurrencyCode as CurrencyCode;
  const navChange =
    timeframe === "1h"
      ? fund.navChange1
      : timeframe === "24h"
        ? fund.navChange24
        : fund.navChange48;

  const holdingsValueAnchor = fund.holdings.reduce(
    (sum, h) => sum + (h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0)),
    0
  );

  const bondPrincipalAnchor = fund.bondHoldingsValueAnchor ?? 0;

  const balanceSheet: FundBalanceSheetData | null = {
    cashAnchor: fund.cashAnchor,
    openOrdersEscrowAnchor: fund.openOrdersEscrowAnchor ?? 0,
    holdingsValueAnchor,
    bondPrincipalAnchor,
    totalBackingAnchor:
      fund.cashAnchor +
      holdingsValueAnchor +
      bondPrincipalAnchor +
      (fund.openOrdersEscrowAnchor ?? 0),
    quotedLiabilityAnchor: fund.quotedNav * fund.unitSupply,
    backingRatio: fund.backingRatio ?? null,
    unitSupply: fund.unitSupply,
    quotedNav: fund.quotedNav,
  };

  const statusTone =
    fund.status === "active"
      ? { label: "Active", tone: "var(--success)" }
      : fund.status === "paused"
        ? { label: "Paused", tone: "var(--warning)" }
        : fund.status === "winding_down"
          ? { label: "Winding down", tone: "var(--warning)" }
          : { label: "Delisted", tone: "var(--error)" };

  const statusBg = `color-mix(in srgb, ${statusTone.tone} 10%, transparent)`;
  const statusBorder = `color-mix(in srgb, ${statusTone.tone} 30%, transparent)`;

  const tabs: { key: typeof activeTab; label: string; count?: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "holdings", label: "Holdings" },
    { key: "financials", label: "Financials" },
    {
      key: "subscribers",
      label: "Subscribers",
      count: summary.totalHolders.toLocaleString("en-US"),
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-16" data-replay-block>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-3">
          <BackButton fallbackHref={stockMarketHref} fallbackLabel="Funds" />
          <span className="text-muted text-sm">/</span>
          <span className="font-mono text-sm font-bold text-primary">{fund.tickerSymbol}</span>
        </div>

        {/* Masthead */}
        <header className="flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs font-bold text-primary rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-0.5">
                {fund.tickerSymbol}
              </span>
              <span
                className="inline-flex rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ color: statusTone.tone, background: statusBg, borderColor: statusBorder }}
              >
                {statusTone.label}
              </span>
            </div>
            <h1 className="mt-3 text-2xl sm:text-4xl font-semibold leading-tight tracking-tight">
              {fund.name}
            </h1>
            <p className="mt-2.5 text-[13px] text-muted">
              {fund.scope === "country" ? `${fund.countryId} broad index` : "Global index"} ·{" "}
              {fund.anchorCurrencyCode} anchor
              {fund.sectorType ? ` · ${fund.sectorType}` : ""} ·{" "}
              {fund.holdings.length + (fund.bondHoldings?.length ?? 0)} constituents
              {fund.lastRebalancedAt ? ` · rebalances every 24 turns` : ""}
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-body-sm font-medium text-muted">NAV / unit</div>
            <div className="mt-1 font-mono tabular-nums text-[28px] sm:text-[42px] font-bold leading-none">
              {formatPrice(fund.quotedNav, ccy)}
            </div>
            <div className="mt-2 flex items-center justify-end gap-2.5">
              <div className="flex gap-0.5 rounded-lg border border-card-border bg-card p-0.5">
                {(["1h", "24h", "48h"] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] font-bold transition-all ${
                      timeframe === tf
                        ? "border-primary/45 bg-primary/14 text-primary"
                        : "border-transparent text-muted hover:text-foreground"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <NavChangeBadge value={navChange} />
            </div>
          </div>
        </header>

        <FundActions
          corporations={data.corporationAccounts}
          fundId={fund.id}
          quotedNav={fund.quotedNav}
          anchorCurrencyCode={fund.anchorCurrencyCode}
          status={fund.status}
          myUnits={myPosition?.units ?? 0}
          myLegacyUnits={myPosition?.legacyUnits ?? myPosition?.units ?? 0}
          onSuccess={() => void load()}
        />

        {/* Stat strip — open hairline (no nested cards) */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 border-b border-card-border py-3">
          {[
            { label: "AUM", value: formatAmount(fund.aumAnchor, ccy) },
            { label: "Units outstanding", value: fund.unitSupply.toLocaleString("en-US") },
            { label: "Holders", value: summary.totalHolders.toLocaleString("en-US") },
            {
              label: "Backing ratio",
              value: fund.backingRatio != null ? `${(fund.backingRatio * 100).toFixed(1)}%` : "—",
            },
          ].map((s) => (
            <div key={s.label} className="whitespace-nowrap">
              <div className="text-body-sm font-medium text-muted">{s.label}</div>
              <div className="mt-1.5 font-mono tabular-nums text-base font-bold">{s.value}</div>
            </div>
          ))}
        </div>

        {fund.status === "paused" && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
            This fund is paused
            {fund.pauseReason ? ` (${fund.pauseReason.replace(/_/g, " ")})` : ""}. Subscriptions may
            be restricted; redemptions still pay from available cash.
          </div>
        )}

        {/* Two-column grid: tabs left, sticky trade right */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 space-y-5">
            {/* Card-style tab bar */}
            <div className="flex flex-wrap gap-2" role="tablist">
              {tabs.map((t) => {
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    role="tab"
                    aria-selected={active}
                    className={`inline-flex items-center gap-2 rounded-[10px] border px-4 py-2 text-[13px] font-semibold transition-all ${
                      active
                        ? "border-primary/55 bg-card-elevated text-foreground"
                        : "border-card-border bg-card text-muted hover:text-foreground"
                    }`}
                  >
                    {t.label}
                    {t.count && (
                      <span
                        className="rounded-full px-1.5 py-px font-mono text-[10px] font-bold"
                        style={{
                          background: active ? "var(--primary)" : "var(--card-elevated)",
                          color: active ? "var(--primary-foreground, #fff)" : "var(--muted)",
                        }}
                      >
                        {t.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === "overview" && (
              <div className="animate-fade-in space-y-5">
                {/* NAV chart card */}
                <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
                  <FundNavChart history={navHistory} />
                </div>

                {/* Fund health: gauge + composition */}
                <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
                  <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">Backing ratio</h2>
                      <span
                        className="inline-flex rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                        style={{
                          color: statusTone.tone,
                          background: statusBg,
                          borderColor: statusBorder,
                        }}
                      >
                        {fund.backingRatio != null && fund.backingRatio >= 1
                          ? "Fully backed"
                          : fund.backingRatio != null && fund.backingRatio >= 0.5
                            ? "At risk"
                            : "Auto-pause"}
                      </span>
                    </div>
                    <BackingRatioGauge ratio={fund.backingRatio ?? null} />
                    <p className="mt-3 text-[11px] leading-relaxed text-muted">
                      Assets ÷ (NAV × units outstanding). Below{" "}
                      <span className="font-mono text-error">50%</span> the fund is under-backed.
                    </p>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
                    <h2 className="text-sm font-semibold">Asset composition</h2>
                    <AssetCompositionBar
                      holdingsValueAnchor={holdingsValueAnchor}
                      cashAnchor={fund.cashAnchor}
                      openOrdersEscrowAnchor={fund.openOrdersEscrowAnchor ?? 0}
                      bondPrincipalAnchor={bondPrincipalAnchor}
                      formatAmount={formatAmount}
                      ccy={ccy}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "holdings" && (
              <div className="space-y-5">
                {fund.lastRebalancedAt && (
                  <p className="text-sm text-muted">
                    Last rebalanced: {formatRebalanceDate(fund.lastRebalancedAt)}
                  </p>
                )}
                <BondHoldingsPanel
                  holdings={fund.bondHoldings ?? []}
                  formatAmount={formatAmount}
                  ccy={ccy}
                />

                {/* Constituents donut + tables */}
                {(fund.kind !== "bond" || fund.holdings.length > 0) && (
                  <ConstituentsPanel
                    holdings={fund.holdings}
                    targetConstituents={fund.targetConstituents}
                    formatAmount={formatAmount}
                    formatPrice={formatPrice}
                    ccy={ccy}
                  />
                )}
              </div>
            )}

            {activeTab === "financials" && (
              <div className="animate-fade-in">
                <FundFinancialsTab
                  financials={financials}
                  balanceSheet={balanceSheet}
                  formatAmount={formatAmount}
                  ccy={ccy}
                />
              </div>
            )}

            {activeTab === "subscribers" && (
              <div className="animate-fade-in">
                <FundSubscribersTab fundId={fund.id} anchorCurrencyCode={fund.anchorCurrencyCode} />
              </div>
            )}
          </div>

          {/* Right rail: position + trade panel */}
          <div className="sticky top-20 flex flex-col gap-4 self-start">
            <SponsorshipCard
              fund={fund}
              formatAmount={formatAmount}
              ccy={ccy}
              onWindUpStarted={() => void load()}
            />
            <YourPositionCard
              units={myPosition?.units ?? 0}
              legacyUnits={myPosition?.legacyUnits ?? myPosition?.units ?? 0}
              avgNavAnchor={myPosition?.avgNavAnchor ?? null}
              navAnchor={fund.quotedNav}
              fundFxRate={forexEnabled ? (forexRates?.[ccy] ?? 1) : 1}
              forexEnabled={forexEnabled}
              formatAmount={formatAmount}
              formatPrice={formatPrice}
              ccy={ccy}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/** Format the rebalance timestamp for the holdings tab. */
function formatRebalanceDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}
