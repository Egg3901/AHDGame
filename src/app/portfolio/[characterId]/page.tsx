"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { PortfolioChart } from "@/components/charts/PortfolioChart";
import { PortfolioBreakdownChart } from "@/components/charts/PortfolioBreakdownChart";
import { SovereignBondHoldingsPanel } from "@/components/portfolio/SovereignBondHoldingsPanel";
import {
  StocksTable,
  BondsTable,
  type Holding,
  type BondHolding,
} from "@/components/portfolio/HoldingsTables";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface HistoryPoint {
  turn: number;
  totalValue: number;
  netValue?: number;
  stockValue?: number;
  bondValue?: number;
  cashValue?: number;
  liquidCashValue?: number;
  savingsCashValue?: number;
  locDebtValue?: number;
  /** FX snapshot at the time of recording — keeps charts honest across rate moves. */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
}

type Tab = "stocks" | "bonds";
type ChartView = "total" | "breakdown";
type SeriesView = "total" | "stocks" | "bonds" | "cash" | "savings";

export default function CharacterPortfolioPage() {
  const { formatAmount } = useCurrency();
  const params = useParams();
  const characterId = params.characterId as string;

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [bondHoldings, setBondHoldings] = useState<BondHolding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [totalBondValue, setTotalBondValue] = useState(0);
  const [totalBondIncomePerTurn, setTotalBondIncomePerTurn] = useState(0);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [locDebtValue, setLocDebtValue] = useState(0);
  const [characterName, setCharacterName] = useState("");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("stocks");
  const [chartView, setChartView] = useState<ChartView>("total");
  const [seriesView, setSeriesView] = useState<SeriesView>("total");

  useEffect(() => {
    if (!characterId) return;

    fetch(`/api/character/${characterId}/portfolio`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 404) {
            throw new Error("Character not found");
          }
          throw new Error("Failed to load portfolio");
        }
        return r.json();
      })
      .then((data) => {
        setHoldings(data.holdings || []);
        setBondHoldings(data.bondHoldings || []);
        setTotalValue(data.totalValue || 0);
        setTotalBondValue(data.totalBondValue || 0);
        setTotalBondIncomePerTurn(data.totalBondIncomePerTurn || 0);
        setCashOnHand(data.cashOnHand || 0);
        setLocDebtValue(data.locDebtValue || 0);
        setCharacterName(data.characterName || "");
        setHistory(data.history || []);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  const combinedTotal = totalValue + totalBondValue + cashOnHand - locDebtValue;

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16 pt-8">
        <div className="mx-auto max-w-5xl px-4 space-y-8">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
          <BackButton fallbackHref={`/character/${characterId}`} fallbackLabel="Profile" />
          <div className="mt-8 rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-error">{error}</p>
            <Link
              href={`/character/${characterId}`}
              className="mt-4 inline-block text-primary hover:underline"
            >
              Back to Profile
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="space-y-4">
          <BackButton fallbackHref={`/character/${characterId}`} fallbackLabel="Profile" />
          <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
            <div className="bg-card-elevated px-6 py-6 border-b border-card-border">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-bold text-foreground tracking-tight">
                    {characterName ? `${characterName}'s Portfolio` : "Portfolio"}
                  </h1>
                  <p className="text-muted">Investment holdings and assets</p>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                    Total Net Worth
                  </span>
                  <span className="text-3xl font-bold text-foreground tabular-nums tracking-tight">
                    {formatAmount(combinedTotal)}
                  </span>
                </div>
              </div>
            </div>

            {/* Itemized breakdown so Total Net Worth reconciles:
                stocks + bonds + cash on hand - loans. */}
            <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-card-border">
              <div className="p-6">
                <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
                  Stock Holdings
                </span>
                <span className="block text-xl font-bold text-foreground tabular-nums">
                  {formatAmount(totalValue)}
                </span>
              </div>
              <div className="p-6">
                <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
                  Bond Holdings
                </span>
                <span className="block text-xl font-bold text-foreground tabular-nums">
                  {formatAmount(totalBondValue)}
                </span>
              </div>
              <div className="p-6">
                <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
                  Cash on Hand
                </span>
                <span className="block text-xl font-bold text-foreground tabular-nums">
                  {formatAmount(cashOnHand)}
                </span>
              </div>
              <div className="p-6">
                <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
                  Loans
                </span>
                <span
                  className={`block text-xl font-bold tabular-nums ${
                    locDebtValue > 0 ? "text-error" : "text-foreground"
                  }`}
                >
                  {locDebtValue > 0 ? `-${formatAmount(locDebtValue)}` : formatAmount(0)}
                </span>
              </div>
              <div className="p-6">
                <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
                  Bond Income
                </span>
                <span className="block text-xl font-bold text-success tabular-nums">
                  +{formatAmount(totalBondIncomePerTurn)}/turn
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Portfolio Chart */}
        {history.length >= 2 && (
          <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Portfolio Value Over Time</h2>
                <p className="text-xs text-muted">
                  {chartView === "total"
                    ? seriesView === "total"
                      ? "Total net worth history"
                      : seriesView === "savings"
                        ? "High-yield savings balance history (internal units)"
                        : `${seriesView.charAt(0).toUpperCase() + seriesView.slice(1)} value history`
                    : "Breakdown of stocks, bonds, and cash"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChartView("total")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    chartView === "total"
                      ? "bg-primary text-white"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  Total
                </button>
                <button
                  onClick={() => setChartView("breakdown")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    chartView === "breakdown"
                      ? "bg-primary text-white"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  Breakdown
                </button>
                {chartView === "total" && (
                  <>
                    <button
                      onClick={() => setSeriesView("total")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        seriesView === "total"
                          ? "bg-primary text-white"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      Total
                    </button>
                    <button
                      onClick={() => setSeriesView("stocks")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        seriesView === "stocks"
                          ? "bg-success text-white"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      Stocks
                    </button>
                    <button
                      onClick={() => setSeriesView("bonds")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        seriesView === "bonds"
                          ? "bg-warning text-white"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      Bonds
                    </button>
                    <button
                      onClick={() => setSeriesView("cash")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        seriesView === "cash"
                          ? "bg-info text-white"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      Cash
                    </button>
                    <button
                      onClick={() => setSeriesView("savings")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        seriesView === "savings"
                          ? "bg-primary text-white"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      Savings
                    </button>
                  </>
                )}
              </div>
            </div>
            {chartView === "total" ? (
              <PortfolioChart history={history} view={seriesView} />
            ) : (
              <PortfolioBreakdownChart history={history} />
            )}
          </div>
        )}

        <div className="space-y-6">
          <div className="border-b border-card-border">
            <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
              <button
                onClick={() => setActiveTab("stocks")}
                className={`
                  shrink-0 whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors
                  ${
                    activeTab === "stocks"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:border-card-border hover:text-foreground"
                  }
                `}
              >
                Stocks
                <span className="ml-2 rounded-full bg-card-elevated px-2 py-0.5 text-xs text-muted">
                  {holdings.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("bonds")}
                className={`
                  shrink-0 whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors
                  ${
                    activeTab === "bonds"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:border-card-border hover:text-foreground"
                  }
                `}
              >
                Bonds
                <span className="ml-2 rounded-full bg-card-elevated px-2 py-0.5 text-xs text-muted">
                  {bondHoldings.length}
                </span>
              </button>
            </nav>
          </div>

          <div className="min-h-[400px] space-y-6">
            {activeTab === "stocks" && (
              // Read-only view: the public endpoint doesn't expose cost basis,
              // so the avg-cost / unrealized P&L columns are hidden.
              <StocksTable holdings={holdings} showCostBasis={false} />
            )}

            {/* Phase 3 sovereign-default: per-country sovereign-holdings demand contribution. */}
            {activeTab === "bonds" && <SovereignBondHoldingsPanel characterId={characterId} />}

            {activeTab === "bonds" && (
              <BondsTable
                bondHoldings={bondHoldings}
                totalBondIncomePerTurn={totalBondIncomePerTurn}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
