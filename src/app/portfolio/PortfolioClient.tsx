"use client";

import { useState, useEffect, Suspense, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { fetchJson, HttpError } from "@/lib/observability/fetchJson";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { PortfolioChart } from "@/components/charts/PortfolioChart";
import { PortfolioBreakdownChart } from "@/components/charts/PortfolioBreakdownChart";
import { WireTransferCard } from "./components/WireTransferCard";
import { CurrencyWallet } from "@/components/forex/CurrencyWallet";
import { DisplayPreferenceToggle } from "@/components/forex/DisplayPreferenceToggle";
import CorporationPortfolioView from "./components/CorporationPortfolioView";
import { FundHoldingsPanel } from "./components/FundHoldingsPanel";
import { OpenShareOrdersPanel } from "./components/OpenShareOrdersPanel";
import { TradeHistoryPanel } from "./components/TradeHistoryPanel";
import {
  PortfolioShell,
  OwnerToggle,
  ChartPill,
  StatCard,
  IconOverview,
  IconCash,
  IconStocks,
  IconBonds,
  IconFunds,
  IconLoans,
  IconTransfers,
  type PortfolioRailItem,
} from "./components/PortfolioShell";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { LoansPane, type LocSnapshot } from "./components/LoansPane";
import {
  StocksTable,
  BondsTable,
  type Holding,
  type BondHolding,
} from "@/components/portfolio/HoldingsTables";

interface MeCeoCorporation {
  _id: string;
  sequentialId?: number;
  name: string;
  isNationalCorp?: boolean;
}

type Section =
  | "overview"
  | "cash"
  | "stocks"
  | "bonds"
  | "orders"
  | "trades"
  | "funds"
  | "transfers"
  | "loans";
type ChartView = "total" | "breakdown";
type SeriesView = "total" | "stocks" | "bonds" | "cash" | "savings";

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

const VALID_SECTIONS: Section[] = [
  "overview",
  "cash",
  "stocks",
  "bonds",
  "orders",
  "trades",
  "funds",
  "transfers",
  "loans",
];

// Back-compat: legacy ?tab= values still resolve to sections
const LEGACY_TAB_MAP: Record<string, Section> = {
  stocks: "stocks",
  bonds: "bonds",
  currency: "cash",
};

// GET /api/character/portfolio is typed `any` (wide payload); the server seed
// carries the same shape, so mirror that here rather than duplicate ~18 fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PortfolioSeed = any;

/**
 * Report a portfolio load failure, except 4xx. A signed-out or expired session
 * answers /api/character/me and /api/character/portfolio with 401 — that is the
 * auth flow working, not a fault, and it was the top client error in GlitchTip.
 * fetchJson already reports network and 5xx faults with its own context.
 */
function reportPortfolioLoadError(err: unknown): void {
  if (err instanceof HttpError && err.status >= 400 && err.status < 500) return;
  Sentry.captureException(err, { tags: { feature: "portfolio" } });
}

interface PortfolioClientProps {
  /** Server-seeded portfolio payload so holdings render without a client round trip. */
  initialPortfolio?: PortfolioSeed;
}

export default function PortfolioClient({ initialPortfolio }: PortfolioClientProps) {
  return (
    <Suspense>
      <PortfolioPageInner initialPortfolio={initialPortfolio} />
    </Suspense>
  );
}

function PortfolioPageInner({ initialPortfolio }: PortfolioClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawSection = searchParams.get("section");
  const rawTab = searchParams.get("tab");
  const initialSection: Section =
    rawSection && VALID_SECTIONS.includes(rawSection as Section)
      ? (rawSection as Section)
      : rawTab && LEGACY_TAB_MAP[rawTab]
        ? LEGACY_TAB_MAP[rawTab]
        : "overview";

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [bondHoldings, setBondHoldings] = useState<BondHolding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [totalBondValue, setTotalBondValue] = useState(0);
  const [totalBondIncomePerTurn, setTotalBondIncomePerTurn] = useState(0);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [myCharacterId, setMyCharacterId] = useState("");
  const [myCountryId, setMyCountryId] = useState("");
  // Seeded from the server → holdings render immediately; the wallet / CEO / LoC
  // secondary data hydrates a beat later without blocking the page behind a spinner.
  const [loading, setLoading] = useState(initialPortfolio === undefined);
  const [loadError, setLoadError] = useState(false);
  const skipInitialPortfolioFetch = useRef(initialPortfolio !== undefined);
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [chartView, setChartView] = useState<ChartView>("total");
  const [seriesView, setSeriesView] = useState<SeriesView>("total");
  const [currencyBalances, setCurrencyBalances] = useState<{
    campaign: number;
    personal: Partial<Record<CurrencyCode, number>>;
    savings?: Partial<Record<CurrencyCode, number>>;
  } | null>(null);
  const [savingsAccountsOpenedState, setSavingsAccountsOpenedState] = useState<Partial<
    Record<CurrencyCode, boolean>
  > | null>(null);
  const [savingsApyByCurrency, setSavingsApyByCurrency] = useState<Partial<
    Record<CurrencyCode, number>
  > | null>(null);
  const [interestEarnedByCurrency, setInterestEarnedByCurrency] = useState<Partial<
    Record<CurrencyCode, number>
  > | null>(null);
  const [pendingSavingsInterestByCurrency, setPendingSavingsInterestByCurrency] = useState<Partial<
    Record<CurrencyCode, number>
  > | null>(null);
  const [turnsUntilSavingsCredit, setTurnsUntilSavingsCredit] = useState<number | null>(null);
  const [estimatedSavingsAccrualPerTurn, setEstimatedSavingsAccrualPerTurn] = useState<Partial<
    Record<CurrencyCode, number>
  > | null>(null);
  const [homeCurrency, setHomeCurrency] = useState<CurrencyCode | null>(null);
  const [ceoCorporation, setCeoCorporation] = useState<MeCeoCorporation | null>(null);
  const [corpViewIsCeo, setCorpViewIsCeo] = useState(false);
  const [locSnapshot, setLocSnapshot] = useState<LocSnapshot | null>(null);
  const [fundHoldingsValue, setFundHoldingsValue] = useState(0);
  const [fundsFeatureEnabled, setFundsFeatureEnabled] = useState(false);

  const corpQuery = searchParams.get("corp");
  const showCorpPortfolio = !!corpQuery;

  const ceoPortfolioPathId =
    ceoCorporation != null
      ? ceoCorporation.sequentialId != null
        ? String(ceoCorporation.sequentialId)
        : ceoCorporation._id
      : "";

  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
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

  // Apply the portfolio payload (server-seeded on first paint, or freshly
  // fetched on refetch) to the portfolio-derived state.
  const applyPortfolio = useCallback((portfolio: PortfolioSeed) => {
    setHoldings(portfolio.holdings || []);
    setBondHoldings(portfolio.bondHoldings || []);
    setTotalValue(portfolio.totalValue || 0);
    setTotalBondValue(portfolio.totalBondValue || 0);
    setTotalBondIncomePerTurn(portfolio.totalBondIncomePerTurn || 0);
    setCashOnHand(portfolio.cashOnHand || 0);
    setHistory(portfolio.history || []);
    setSavingsApyByCurrency(portfolio.apyByCurrency ?? null);
    setSavingsAccountsOpenedState(portfolio.savingsAccountsOpened ?? null);
    setInterestEarnedByCurrency(portfolio.interestEarnedByCurrency ?? null);
    setPendingSavingsInterestByCurrency(portfolio.pendingSavingsInterestByCurrency ?? null);
    setTurnsUntilSavingsCredit(
      typeof portfolio.turnsUntilSavingsCredit === "number"
        ? portfolio.turnsUntilSavingsCredit
        : null
    );
    setEstimatedSavingsAccrualPerTurn(portfolio.estimatedSavingsAccrualPerTurn ?? null);
  }, []);

  // Apply the me + corp-detail + LoC payloads. `savingsBalances` comes from the
  // portfolio payload (the wallet's savings figure prefers the portfolio's
  // per-currency snapshot over the character doc's).
  const applySecondary = useCallback(
    (
      me: PortfolioSeed,
      corpDetail: PortfolioSeed,
      locData: unknown,
      savingsBalances: unknown,
      corpQ: string | null
    ) => {
      if (me?.character) {
        setMyCharacterId(me.character._id || "");
        setMyCountryId(me.character.countryId || "US");
        if (me.character.currencyBalances) {
          setCurrencyBalances({
            campaign: me.character.currencyBalances.campaign,
            personal: me.character.currencyBalances.personal,
            savings: savingsBalances ?? me.character.currencyBalances.savings ?? {},
          });
        }
        if (me.character.homeCurrency) {
          setHomeCurrency(me.character.homeCurrency);
        }
      }
      if (me?.corporation && !me.corporation.isNationalCorp) {
        setCeoCorporation(me.corporation as MeCeoCorporation);
      } else {
        setCeoCorporation(null);
      }
      const charId = me?.character?._id;
      const ceoCharId = corpDetail?.ceo?.characterId;
      if (corpQ && charId && ceoCharId) {
        setCorpViewIsCeo(ceoCharId === charId);
      } else {
        setCorpViewIsCeo(false);
      }
      setLocSnapshot((locData as LocSnapshot | null) ?? null);
    },
    []
  );

  const loadPortfolioAndMe = useCallback(() => {
    const corpQ = corpQuery;
    return Promise.all([
      // Critical data: fetchJson throws (and reports 5xx/network) instead of
      // parsing an error body into a "$0 portfolio" that looks real. Typed as
      // any to match the previous untyped r.json() consumption below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchJson<any>("/api/character/portfolio", { feature: "portfolio" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchJson<any>("/api/character/me", { feature: "portfolio" }),
      corpQ
        ? fetch(`/api/corporations/${corpQ}`).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      // Optional data: fetchJson reports network/5xx to GlitchTip; the catch
      // degrades to null (no LoC section) rather than failing the whole load.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchJson<any>("/api/character/loc", { feature: "portfolio" }).catch(() => null),
    ]).then(([portfolio, me, corpDetail, locData]) => {
      applyPortfolio(portfolio);
      applySecondary(me, corpDetail, locData, portfolio.savingsBalances, corpQ);
    });
  }, [corpQuery, applyPortfolio, applySecondary]);

  // Seeded first paint: the portfolio came from the server, so only the wallet
  // (me), CEO-corp detail, and LoC still need a client fetch. Uses the seeded
  // portfolio's savingsBalances for the wallet's savings figure.
  const loadSecondaryOnly = useCallback(() => {
    const corpQ = corpQuery;
    return Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchJson<any>("/api/character/me", { feature: "portfolio" }),
      corpQ
        ? fetch(`/api/corporations/${corpQ}`).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchJson<any>("/api/character/loc", { feature: "portfolio" }).catch(() => null),
    ]).then(([me, corpDetail, locData]) => {
      applySecondary(me, corpDetail, locData, initialPortfolio?.savingsBalances, corpQ);
    });
  }, [corpQuery, applySecondary, initialPortfolio]);

  useEffect(() => {
    // Intentional reset of stale error state when (re)loading on dep change —
    // the synchronous-setState-in-effect the rule permits for this purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(false);
    let promise: Promise<void>;
    if (skipInitialPortfolioFetch.current) {
      // First paint with server-seeded portfolio: apply it, fetch only secondaries.
      skipInitialPortfolioFetch.current = false;
      if (initialPortfolio) applyPortfolio(initialPortfolio);
      promise = loadSecondaryOnly();
    } else {
      promise = loadPortfolioAndMe();
    }
    promise
      .catch((err) => {
        // Was `.catch(() => {})` — a failed load silently rendered a $0
        // portfolio. Surface it to the user and report it.
        setLoadError(true);
        reportPortfolioLoadError(err);
      })
      .finally(() => setLoading(false));
  }, [loadPortfolioAndMe, loadSecondaryOnly, applyPortfolio, initialPortfolio]);

  useEffect(() => {
    if (!myCharacterId) return;
    let cancelled = false;
    void fetchJson<{ positions?: { marketValueAnchor: number | null }[] }>(
      `/api/character/${myCharacterId}/fund-portfolio`,
      { cache: "no-store", feature: "portfolio-funds" }
    )
      .then((data) => {
        if (cancelled) return;
        setFundsFeatureEnabled(true);
        const positions = data.positions ?? [];
        setFundHoldingsValue(positions.reduce((s, p) => s + (p.marketValueAnchor ?? 0), 0));
      })
      .catch((err) => {
        // 403 = funds feature disabled for this player (expected) — hide the
        // section. fetchJson already reported any network/5xx fault; leave the
        // holdings value untouched in that case.
        if (err instanceof HttpError && err.status === 403 && !cancelled) {
          setFundsFeatureEnabled(false);
          setFundHoldingsValue(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [myCharacterId]);

  const setPortfolioOwner = (owner: "character" | "corporation") => {
    const params = new URLSearchParams(searchParams.toString());
    if (owner === "corporation" && ceoPortfolioPathId) {
      params.set("corp", ceoPortfolioPathId);
      // Transfers/loans are character-only sections. Corps have cash, stocks, bonds
      // — matching section names carry over so the tab stays anchored on toggle.
      if (params.get("section") === "transfers" || params.get("section") === "loans") {
        params.delete("section");
      }
    } else {
      params.delete("corp");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // True net worth: stock holdings + bond holdings + all cash & savings − outstanding LOC debt.
  // Previously this only summed stocks + bonds, which is why a player with £16M cash and £10M
  // loans showed a "Net Worth" identical to their stock-only total.
  const investmentTotal = totalValue + totalBondValue + fundHoldingsValue;
  const loanObligation = locSnapshot?.outstandingInternal ?? 0;
  const combinedTotal = investmentTotal + cashOnHand - loanObligation;
  const stockMarketFundsHref = myCountryId
    ? `/country/${myCountryId.toLowerCase()}/stockmarket?tab=funds`
    : "/country/us/stockmarket?tab=funds";
  const { formatAmount } = useCurrency();

  // Per-series turn-over-turn delta derived from the last two history points.
  // Powers the "pulse" in the sidebar and mobile rail.
  const deltas = useMemo(() => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const resolveTotal = (point: HistoryPoint) => point.netValue ?? point.totalValue;
    const pct = (cur: number | undefined, old: number | undefined) => {
      if (cur == null || old == null || old === 0) return null;
      return ((cur - old) / old) * 100;
    };
    return {
      total: pct(resolveTotal(last), resolveTotal(prev)),
      stocks: pct(last.stockValue, prev.stockValue),
      bonds: pct(last.bondValue, prev.bondValue),
      cash: pct(last.cashValue, prev.cashValue),
    };
  }, [history]);

  const ownerSwitcher = ceoCorporation ? (
    <OwnerToggle
      options={[
        { key: "character", label: "My Assets", subtitle: "Personal" },
        { key: "corporation", label: ceoCorporation.name, subtitle: "Corporation" },
      ]}
      active={showCorpPortfolio ? "corporation" : "character"}
      onChange={(k) => setPortfolioOwner(k === "corporation" ? "corporation" : "character")}
    />
  ) : null;

  if (loadError) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <BackButton iconOnly fallbackLabel="Back" />
          <div className="mt-8 rounded-xl border border-card-border bg-card p-12 text-center shadow-sm">
            <p className="text-muted text-sm">
              Couldn&apos;t load your portfolio. Please try again.
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadError(false);
                setLoading(true);
                loadPortfolioAndMe()
                  .catch((err) => {
                    setLoadError(true);
                    reportPortfolioLoadError(err);
                  })
                  .finally(() => setLoading(false));
              }}
              className="mt-4 rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-background"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {/* Back button */}
          <Skeleton className="h-4 w-24 rounded" />

          {/* Shell header — title + net worth */}
          <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
              <div className="text-right space-y-1 shrink-0">
                <Skeleton className="h-2.5 w-20 ml-auto" />
                <Skeleton className="h-8 w-36" />
              </div>
            </div>
          </div>

          {/* Rail + content */}
          <div className="grid lg:grid-cols-[240px_1fr] gap-8">
            {/* Side rail — desktop only */}
            <div className="hidden lg:flex lg:flex-col gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="rounded-lg border border-card-border p-3 flex items-center gap-3"
                >
                  <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              ))}
            </div>

            {/* Main content area */}
            <div className="space-y-4">
              {/* Overview chart area */}
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-7 w-24 rounded-lg" />
                </div>
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
              {/* Holdings table area */}
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                <Skeleton className="h-4 w-28" />
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 py-2 border-b border-card-border last:border-0"
                  >
                    <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-2.5 w-20" />
                    </div>
                    <Skeleton className="h-5 w-20 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Corporation mode — delegate to the shared view but feed it the same owner switcher
  // so the toggle stays anchored in an identical-looking masthead.
  if (showCorpPortfolio && corpQuery) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <BackButton fallbackHref="/dashboard" fallbackLabel="Dashboard" />
          <CorporationPortfolioView
            corpRouteId={corpQuery}
            isCeo={corpViewIsCeo}
            syncTabToUrl
            ownerSwitcher={ownerSwitcher}
          />
        </main>
      </div>
    );
  }

  const rail: PortfolioRailItem<Section>[] = [
    {
      key: "overview",
      label: "Overview",
      value: formatAmount(combinedTotal),
      delta: deltas?.total ?? null,
      icon: <IconOverview />,
    },
    {
      key: "cash",
      label: "Cash on Hand",
      value: formatAmount(cashOnHand),
      delta: deltas?.cash ?? null,
      icon: <IconCash />,
      hidden: !currencyBalances,
    },
    {
      key: "stocks",
      label: "Stocks",
      value: formatAmount(totalValue),
      delta: deltas?.stocks ?? null,
      icon: <IconStocks />,
    },
    {
      key: "bonds",
      label: "Bonds",
      value: formatAmount(totalBondValue),
      delta: deltas?.bonds ?? null,
      icon: <IconBonds />,
    },
    {
      key: "orders",
      label: "My Orders",
      value: "",
      delta: null,
      icon: <IconStocks />,
    },
    {
      key: "trades",
      label: "Trade History",
      value: "",
      delta: null,
      icon: <IconStocks />,
    },
    {
      key: "funds",
      label: "Funds",
      value: formatAmount(fundHoldingsValue),
      delta: null,
      icon: <IconFunds />,
      hidden: !fundsFeatureEnabled,
    },
    {
      key: "loans",
      label: "Loans",
      value:
        locSnapshot && locSnapshot.outstandingInternal > 0
          ? formatAmount(locSnapshot.outstandingInternal)
          : "No loan",
      delta: null,
      icon: <IconLoans />,
      hidden: !locSnapshot,
    },
    {
      key: "transfers",
      label: "Wire Transfer",
      value: formatAmount(cashOnHand),
      delta: null,
      icon: <IconTransfers />,
    },
  ];

  const handleWireSuccess = (newBalance: number, currency: CurrencyCode) => {
    // The wire API returns the remaining balance in the currency that was sent. If forex
    // is on, update the corresponding bucket; otherwise update legacy cashOnHand.
    if (currencyBalances && homeCurrency) {
      setCurrencyBalances({
        ...currencyBalances,
        personal: { ...currencyBalances.personal, [currency]: newBalance },
      });
      // Recompute legacy cashOnHand summary display: when the sent currency is home,
      // just mirror the new balance; otherwise recompute from the updated map.
      if (currency === homeCurrency) {
        setCashOnHand(newBalance);
      }
    } else {
      setCashOnHand(newBalance);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <BackButton fallbackHref="/dashboard" fallbackLabel="Dashboard" />

        <PortfolioShell
          title="Portfolio & Wallet"
          subtitle="Stocks, bonds, currency, and transfers"
          netWorthLabel="Net Worth"
          netWorth={formatAmount(combinedTotal)}
          ownerSwitcher={ownerSwitcher}
          rail={rail}
          active={activeSection}
          onSelect={handleSectionChange}
        >
          {activeSection === "overview" && (
            <OverviewPane
              totalValue={totalValue}
              totalBondValue={totalBondValue}
              totalBondIncomePerTurn={totalBondIncomePerTurn}
              garnishedPerTurnInternal={locSnapshot?.garnishedPerTurnInternal}
              history={history}
              chartView={chartView}
              setChartView={setChartView}
              seriesView={seriesView}
              setSeriesView={setSeriesView}
            />
          )}

          {activeSection === "cash" && currencyBalances && homeCurrency && (
            <div className="space-y-4">
              <DisplayPreferenceToggle />
              <CurrencyWallet
                wallet={{
                  campaign: 0,
                  personal: currencyBalances.personal,
                  homeCurrency,
                  savings: currencyBalances.savings,
                  savingsAccountsOpened: savingsAccountsOpenedState ?? undefined,
                  apyByCurrency: savingsApyByCurrency ?? undefined,
                  interestEarned: interestEarnedByCurrency ?? undefined,
                  pendingSavingsInterest: pendingSavingsInterestByCurrency ?? undefined,
                  turnsUntilSavingsCredit: turnsUntilSavingsCredit ?? undefined,
                  estimatedSavingsAccrualPerTurn: estimatedSavingsAccrualPerTurn ?? undefined,
                }}
                variant="card"
                onSavingsUpdated={() => {
                  void loadPortfolioAndMe();
                }}
              />
            </div>
          )}

          {activeSection === "stocks" && <StocksTable holdings={holdings} />}

          {activeSection === "bonds" && (
            <BondsTable
              bondHoldings={bondHoldings}
              totalBondIncomePerTurn={totalBondIncomePerTurn}
            />
          )}

          {activeSection === "orders" && <OpenShareOrdersPanel />}

          {activeSection === "trades" && <TradeHistoryPanel />}

          {activeSection === "funds" && myCharacterId && (
            <FundHoldingsPanel characterId={myCharacterId} stockMarketHref={stockMarketFundsHref} />
          )}

          {activeSection === "loans" && locSnapshot && (
            <LoansPane snapshot={locSnapshot} countryId={myCountryId} homeCurrency={homeCurrency} />
          )}

          {activeSection === "transfers" && myCharacterId && (
            <WireTransferCard
              cashOnHand={cashOnHand}
              myCharacterId={myCharacterId}
              countryId={myCountryId}
              personalBalances={currencyBalances?.personal}
              homeCurrency={homeCurrency ?? undefined}
              onSuccess={handleWireSuccess}
            />
          )}
        </PortfolioShell>
      </main>
    </div>
  );
}

/* ============================ Sub-components ============================ */

function OverviewPane({
  totalValue,
  totalBondValue,
  totalBondIncomePerTurn,
  garnishedPerTurnInternal,
  history,
  chartView,
  setChartView,
  seriesView,
  setSeriesView,
}: {
  totalValue: number;
  totalBondValue: number;
  totalBondIncomePerTurn: number;
  garnishedPerTurnInternal?: number;
  history: HistoryPoint[];
  chartView: ChartView;
  setChartView: (v: ChartView) => void;
  seriesView: SeriesView;
  setSeriesView: (v: SeriesView) => void;
}) {
  const { formatAmount } = useCurrency();
  const isGarnished = (garnishedPerTurnInternal ?? 0) > 0;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Stock Holdings" value={formatAmount(totalValue)} />
        <StatCard label="Bond Holdings" value={formatAmount(totalBondValue)} />
        <StatCard
          label="Bond Income"
          value={`+${formatAmount(totalBondIncomePerTurn)}/turn`}
          accent="success"
        />
      </div>
      {isGarnished && (
        <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm">
          <span className="mt-0.5 shrink-0 text-error">&#9888;</span>
          <div>
            <span className="font-semibold text-error">Bond income is being garnished</span>
            <span className="ml-1.5 text-muted">
              ~{formatAmount(garnishedPerTurnInternal!)}/turn is captured by your LOC lender before
              reaching your wallet. See the Loans tab for details.
            </span>
          </div>
        </div>
      )}

      {history.length >= 2 && (
        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
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
                  <ChartPill
                    active={seriesView === "savings"}
                    onClick={() => setSeriesView("savings")}
                  >
                    Savings
                  </ChartPill>
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
    </>
  );
}
