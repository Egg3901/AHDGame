"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { PortfolioChart } from "@/components/charts/PortfolioChart";
import { PortfolioBreakdownChart } from "@/components/charts/PortfolioBreakdownChart";
import PortfolioSellModal from "@/components/corporation/PortfolioSellModal";
import {
  PortfolioShell,
  ChartPill,
  StatCard,
  IconOverview,
  IconCash,
  IconStocks,
  IconBonds,
  type PortfolioRailItem,
} from "./PortfolioShell";
import type {
  PortfolioStockHolding,
  PortfolioBondHolding,
} from "@/components/corporation/CorporationPageTypes";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface HistoryPoint {
  turn: number;
  totalValue: number;
  netValue?: number;
  stockValue?: number;
  bondValue?: number;
  cashValue?: number;
  liabilityValue?: number;
  /** FX snapshot at the time of recording — keeps charts honest across rate moves. */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
}

interface CorpPortfolioApiResponse {
  corporationName?: string;
  isNationalCorp?: boolean;
  stockHoldings: PortfolioStockHolding[];
  /** Market bonds plus IMF facility receivables as bond-shaped rows (`imfFacilityLoan`). */
  bondHoldings: PortfolioBondHolding[];
  totalStockValue: number;
  /** Includes IMF facility principal when this corp is the lender. */
  totalBondValue: number;
  totalLiabilityValue: number;
  grossPortfolioValue: number;
  /** Anchor-normalized corp liquidCapital — the cash side of Net Worth. */
  cashOnHand: number;
  /** Net Worth: stocks + bonds + cash. */
  totalPortfolioValue: number;
  totalCouponIncomePerTurn: number;
  history: HistoryPoint[];
  error?: string;
}

type Section = "overview" | "cash" | "stocks" | "bonds";
type ChartView = "total" | "breakdown";
type SeriesView = "total" | "stocks" | "bonds" | "cash";

const VALID_SECTIONS: Section[] = ["overview", "cash", "stocks", "bonds"];
const LEGACY_TAB_MAP: Record<string, Section> = {
  stocks: "stocks",
  bonds: "bonds",
  currency: "cash",
};

interface CorporationPortfolioViewProps {
  corpRouteId: string;
  isCeo: boolean;
  /** When true, read/write ?section= in the URL (used on /portfolio with ?corp=). */
  syncTabToUrl?: boolean;
  /** Segmented owner toggle rendered inside the masthead (character ↔ corp). */
  ownerSwitcher?: ReactNode;
}

export default function CorporationPortfolioView({
  corpRouteId,
  isCeo,
  syncTabToUrl = false,
  ownerSwitcher,
}: CorporationPortfolioViewProps) {
  const { formatAmount } = useCurrency();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialSection: Section = (() => {
    if (!syncTabToUrl) return "overview";
    const rawSection = searchParams.get("section");
    if (rawSection && VALID_SECTIONS.includes(rawSection as Section)) return rawSection as Section;
    const rawTab = searchParams.get("tab");
    if (rawTab && LEGACY_TAB_MAP[rawTab]) return LEGACY_TAB_MAP[rawTab];
    return "overview";
  })();

  const [data, setData] = useState<CorpPortfolioApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [chartView, setChartView] = useState<ChartView>("total");
  const [seriesView, setSeriesView] = useState<SeriesView>("total");
  const [sellStock, setSellStock] = useState<PortfolioStockHolding | null>(null);
  const [sellBond, setSellBond] = useState<PortfolioBondHolding | null>(null);

  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    if (!syncTabToUrl) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    if (section === "overview") {
      params.delete("section");
    } else {
      params.set("section", section);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpRouteId}/portfolio`);
      const json = (await res.json()) as CorpPortfolioApiResponse;
      if (!res.ok) {
        setError(json.error ?? "Failed to load portfolio");
        setData(null);
        return;
      }
      setData(json);
      setError("");
    } catch {
      setError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [corpRouteId]);

  useEffect(() => {
    void fetchPortfolio();
  }, [fetchPortfolio]);

  const deltas = useMemo(() => {
    if (!data || data.history.length < 2) return null;
    const last = data.history[data.history.length - 1];
    const prev = data.history[data.history.length - 2];
    const pct = (cur: number | undefined, old: number | undefined) => {
      if (cur == null || old == null || old === 0) return null;
      return ((cur - old) / old) * 100;
    };
    return {
      total: pct(last.totalValue, prev.totalValue),
      stocks: pct(last.stockValue, prev.stockValue),
      bonds: pct(last.bondValue, prev.bondValue),
      cash: pct(last.cashValue, prev.cashValue),
    };
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid lg:grid-cols-[240px_1fr] gap-8">
          <Skeleton className="h-96 w-full rounded-xl hidden lg:block" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const corpName = data.corporationName ?? "Corporation";
  const netWorthTotal = data.totalPortfolioValue;

  const rail: PortfolioRailItem<Section>[] = [
    {
      key: "overview",
      label: "Overview",
      value: formatAmount(netWorthTotal),
      delta: deltas?.total ?? null,
      icon: <IconOverview />,
    },
    {
      key: "cash",
      label: "Liquid Capital",
      value: formatAmount(data.cashOnHand),
      delta: deltas?.cash ?? null,
      icon: <IconCash />,
    },
    {
      key: "stocks",
      label: "Stocks",
      value: formatAmount(data.totalStockValue),
      delta: deltas?.stocks ?? null,
      icon: <IconStocks />,
    },
    {
      key: "bonds",
      label: "Bonds",
      value: formatAmount(data.totalBondValue),
      delta: deltas?.bonds ?? null,
      icon: <IconBonds />,
    },
  ];

  const viewCorpLink = (
    <Link
      href={`/corporation/${corpRouteId}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:border-muted/40 hover:bg-card-elevated"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      View corporation
    </Link>
  );

  return (
    <>
      <PortfolioShell
        title={`${corpName} Portfolio`}
        subtitle="Corporate stocks, bonds, and investments"
        netWorthLabel="Total Net Worth"
        netWorth={formatAmount(netWorthTotal)}
        ownerSwitcher={ownerSwitcher}
        mastheadAside={viewCorpLink}
        rail={rail}
        active={activeSection}
        onSelect={handleSectionChange}
      >
        {activeSection === "overview" && (
          <CorpOverviewPane
            data={data}
            chartView={chartView}
            setChartView={setChartView}
            seriesView={seriesView}
            setSeriesView={setSeriesView}
          />
        )}

        {activeSection === "cash" && <CorpCashPane cashOnHand={data.cashOnHand} />}

        {activeSection === "stocks" && (
          <CorpStocksTable
            holdings={data.stockHoldings}
            canSell={isCeo && !data.isNationalCorp}
            onSell={setSellStock}
          />
        )}

        {activeSection === "bonds" && (
          <CorpBondsTable
            holdings={data.bondHoldings}
            totalCouponIncomePerTurn={data.totalCouponIncomePerTurn}
            canSell={isCeo && !data.isNationalCorp}
            onSell={setSellBond}
          />
        )}
      </PortfolioShell>

      {sellStock && (
        <PortfolioSellModal
          type="stock"
          holding={sellStock}
          corpId={sellStock.corporationId}
          onClose={() => setSellStock(null)}
          onSuccess={() => {
            setSellStock(null);
            void fetchPortfolio();
          }}
        />
      )}
      {sellBond && (
        <PortfolioSellModal
          type="bond"
          holding={sellBond}
          onClose={() => setSellBond(null)}
          onSuccess={() => {
            setSellBond(null);
            void fetchPortfolio();
          }}
        />
      )}
    </>
  );
}

/* ============================ Sub-components ============================ */

function CorpOverviewPane({
  data,
  chartView,
  setChartView,
  seriesView,
  setSeriesView,
}: {
  data: CorpPortfolioApiResponse;
  chartView: ChartView;
  setChartView: (v: ChartView) => void;
  seriesView: SeriesView;
  setSeriesView: (v: SeriesView) => void;
}) {
  const { formatAmount } = useCurrency();
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Liquid Capital" value={formatAmount(data.cashOnHand)} />
        <StatCard label="Stock Holdings" value={formatAmount(data.totalStockValue)} />
        <StatCard label="Bond Holdings" value={formatAmount(data.totalBondValue)} />
        <StatCard label="Liabilities" value={formatAmount(data.totalLiabilityValue)} />
        <StatCard
          label="Bond Income"
          value={`+${formatAmount(data.totalCouponIncomePerTurn)}/turn`}
          accent="success"
        />
      </div>

      {data.history.length >= 2 && (
        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Portfolio Value Over Time</h2>
              <p className="text-xs text-muted">
                {chartView === "total"
                  ? seriesView === "total"
                    ? "Total net worth history"
                    : `${seriesView.charAt(0).toUpperCase() + seriesView.slice(1)} value history`
                  : "Breakdown of stocks, bonds, and cash"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ChartPill active={chartView === "total"} onClick={() => setChartView("total")}>
                Total
              </ChartPill>
              <ChartPill
                active={chartView === "breakdown"}
                onClick={() => setChartView("breakdown")}
              >
                Breakdown
              </ChartPill>
              {chartView === "total" && (
                <>
                  <ChartPill active={seriesView === "total"} onClick={() => setSeriesView("total")}>
                    Total
                  </ChartPill>
                  <ChartPill
                    active={seriesView === "stocks"}
                    onClick={() => setSeriesView("stocks")}
                    activeTone="success"
                  >
                    Stocks
                  </ChartPill>
                  <ChartPill
                    active={seriesView === "bonds"}
                    onClick={() => setSeriesView("bonds")}
                    activeTone="warning"
                  >
                    Bonds
                  </ChartPill>
                  <ChartPill
                    active={seriesView === "cash"}
                    onClick={() => setSeriesView("cash")}
                    activeTone="info"
                  >
                    Cash
                  </ChartPill>
                </>
              )}
            </div>
          </div>
          {chartView === "total" ? (
            <PortfolioChart history={data.history} view={seriesView} />
          ) : (
            <PortfolioBreakdownChart history={data.history} />
          )}
        </div>
      )}
    </>
  );
}

function CorpCashPane({ cashOnHand }: { cashOnHand: number }) {
  const { formatAmount } = useCurrency();
  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
        Liquid Capital
      </span>
      <span className="block text-2xl font-bold text-foreground tabular-nums">
        {formatAmount(cashOnHand)}
      </span>
      <p className="mt-3 text-xs text-muted">
        The corporation&apos;s on-hand balance used for payroll, dividends, bond service, and new
        investment. Earnings from business activity land here.
      </p>
    </div>
  );
}

function CorpStocksTable({
  holdings,
  canSell,
  onSell,
}: {
  holdings: PortfolioStockHolding[];
  canSell: boolean;
  onSell: (h: PortfolioStockHolding) => void;
}) {
  const { formatAmount, formatPrice: sp, toInternalFrom } = useCurrency();
  const norm = (value: number, ccy: CurrencyCode | undefined) =>
    ccy ? toInternalFrom(value, ccy) : value;
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-card-elevated border-b border-card-border">
            <tr>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[40%]">
                Corporation
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                Shares
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                Avg Cost
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                Unr. P&amp;L
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden md:table-cell">
                Price
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                Value
              </th>
              {canSell && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={canSell ? 7 : 6} className="px-4 py-8 text-center text-muted">
                  No stock holdings.
                </td>
              </tr>
            ) : (
              holdings.map((h) => (
                <tr
                  key={h.corporationId}
                  className="group hover:bg-card-elevated/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/corporation/${h.sequentialId ?? h.corporationId}`}
                      className="flex items-center gap-3"
                    >
                      <div className="h-8 w-8 rounded bg-card-elevated flex items-center justify-center border border-card-border shrink-0 overflow-hidden">
                        <CorporationLogo
                          logoUrl={h.logoUrl}
                          name={h.corporationName}
                          size="h-8 w-8"
                          className="rounded"
                        />
                      </div>
                      <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                        {h.corporationName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {h.shares.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden sm:table-cell">
                    {h.avgCostPerShare !== null
                      ? sp(norm(h.avgCostPerShare, h.currencyCode), h.currencyCode)
                      : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono tabular-nums ${
                      h.unrealizedPnl === null
                        ? "text-muted"
                        : h.unrealizedPnl >= 0
                          ? "text-success"
                          : "text-error"
                    }`}
                  >
                    {h.unrealizedPnl !== null ? (
                      <>
                        {h.unrealizedPnl >= 0 ? "+" : ""}
                        {formatAmount(norm(h.unrealizedPnl, h.currencyCode), h.currencyCode)}
                        {h.unrealizedPnlPct !== null && (
                          <span className="block text-[10px] opacity-75">
                            {h.unrealizedPnlPct >= 0 ? "+" : ""}
                            {h.unrealizedPnlPct}%
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums hidden md:table-cell">
                    {sp(norm(h.sharePrice, h.currencyCode), h.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                    {formatAmount(norm(h.totalValue, h.currencyCode), h.currencyCode)}
                  </td>
                  {canSell && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSell(h)}
                        className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                      >
                        Sell
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CorpBondsTable({
  holdings,
  totalCouponIncomePerTurn,
  canSell,
  onSell,
}: {
  holdings: PortfolioBondHolding[];
  totalCouponIncomePerTurn: number;
  canSell: boolean;
  onSell: (b: PortfolioBondHolding) => void;
}) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const norm = (value: number, ccy: CurrencyCode | undefined) =>
    ccy ? toInternalFrom(value, ccy) : value;
  const hasImfFacility = holdings.some((h) => h.imfFacilityLoan);
  return (
    <>
      {totalCouponIncomePerTurn > 0 && (
        <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted">Income per turn from bond coupons</span>
          <span className="text-sm font-bold text-success tabular-nums">
            +{formatAmount(totalCouponIncomePerTurn)}
          </span>
        </div>
      )}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        {hasImfFacility && (
          <div className="px-4 py-2 border-b border-card-border bg-primary/5">
            <p className="text-[10px] font-semibold text-foreground tracking-wide uppercase">
              IMF facility
            </p>
            <p className="text-[10px] text-muted mt-0.5">
              Loan receivable from restructuring. Not a tradable bond.
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border">
              <tr>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[30%]">
                  Bond
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Units
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Coupon
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Maturity
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Value
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No bond holdings.
                  </td>
                </tr>
              ) : (
                holdings.map((b) => {
                  const isImf = b.imfFacilityLoan === true;
                  const corpHref = `/corporation/${b.issuerSequentialId ?? b.corporationId ?? ""}`;
                  return (
                    <tr
                      key={b.bondId}
                      className="group hover:bg-card-elevated/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        {isImf ? (
                          <Link href={corpHref} className="flex items-center gap-2">
                            <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {b.issuerName}
                            </span>
                          </Link>
                        ) : (
                          <Link href={`/bond/${b.bondId}`} className="flex items-center gap-3">
                            <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {b.issuerName}
                            </span>
                            {b.defaulted && (
                              <span className="text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 font-bold uppercase">
                                Defaulted
                              </span>
                            )}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                        {isImf ? "—" : b.units.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums hidden sm:table-cell">
                        {Number(b.couponRate).toFixed(2)}%{isImf ? " ann." : ""}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                        {b.turnsRemaining} turns
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                        {formatAmount(
                          isImf ? b.totalValue : norm(b.totalValue, b.currencyCode),
                          isImf ? undefined : b.currencyCode
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!isImf && (
                            <Link
                              href={`/bond/${b.bondId}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Trade
                            </Link>
                          )}
                          {isImf && (
                            <Link
                              href={corpHref}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Borrower
                            </Link>
                          )}
                          {canSell && !b.defaulted && !isImf && (
                            <button
                              type="button"
                              onClick={() => onSell(b)}
                              className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                            >
                              Sell
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
