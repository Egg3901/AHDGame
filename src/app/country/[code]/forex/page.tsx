"use client";

import { useState, useEffect, use, Suspense, useCallback, useMemo } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { ExchangeRatesTable } from "@/components/forex/ExchangeRatesTable";
import { ReserveLeaders } from "@/components/forex/ReserveLeaders";
import { CentralBankPolicyStrip } from "@/components/forex/CentralBankPolicyStrip";
import { RateChart } from "@/components/forex/RateChart";
import { GlobalMonetaryPolicyChart } from "@/components/forex/GlobalMonetaryPolicyChart";
import { OrderBook } from "@/components/forex/OrderBook";
import { MyOrders } from "@/components/forex/MyOrders";
import { CurrencyWallet } from "@/components/forex/CurrencyWallet";
import { TradeHistory } from "@/components/forex/TradeHistory";
import { PublicTradeHistory } from "@/components/forex/PublicTradeHistory";
import { CurrencyTradeModal } from "@/components/forex/CurrencyTradeModal";
import type {
  ExchangeRateDisplay,
  OrderDisplay,
  WalletBalances,
  ForexTab,
  CountryMacroSnapshot,
  ReserveLeaderDisplay,
} from "./types";
import { FOREX_ACTIVE_CURRENCIES, type CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { computeStrengthVsReferencePercent } from "@/lib/forex/rateSemantics";
import {
  partitionForexRates,
  type ForexCountryAccess,
} from "@/components/forex/partitionForexCurrencies";
import type { CountryId } from "@/lib/constants/countries";

const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg/960px-NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg";

const VALID_TABS: ForexTab[] = ["rates", "policy", "orders", "history", "feed"];

export default function ForexPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense>
      <ForexPageInner params={params} />
    </Suspense>
  );
}

function ForexPageInner({ params }: { params: Promise<{ code: string }> }) {
  const { code: _country } = use(params);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const rawTab = searchParams.get("tab");
  const activeTab: ForexTab =
    rawTab && VALID_TABS.includes(rawTab as ForexTab) ? (rawTab as ForexTab) : "rates";

  const setActiveTab = (tab: ForexTab) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", tab);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const [rates, setRates] = useState<ExchangeRateDisplay[]>([]);
  const [orderBook, setOrderBook] = useState<OrderDisplay[]>([]);
  const [myOrders, setMyOrders] = useState<OrderDisplay[]>([]);
  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeFrom, setTradeFrom] = useState<CurrencyCode | undefined>();
  const [tradeTo, setTradeTo] = useState<CurrencyCode | undefined>();
  const [macroCountries, setMacroCountries] = useState<CountryMacroSnapshot[]>([]);
  const [reserveLeaders, setReserveLeaders] = useState<ReserveLeaderDisplay[]>([]);
  const [countryAccess, setCountryAccess] = useState<Partial<
    Record<CountryId, ForexCountryAccess>
  > | null>(null);

  const openTradeModal = (from: CurrencyCode, to: CurrencyCode) => {
    setTradeFrom(from);
    setTradeTo(to);
    setTradeOpen(true);
  };

  const defaultHomeCurrency = (wallet?.homeCurrency ?? "USD") as CurrencyCode;

  const activeRates = useMemo(
    () =>
      FOREX_ACTIVE_CURRENCIES.map((code) => rates.find((r) => r.currencyCode === code)).filter(
        (r): r is ExchangeRateDisplay => r != null
      ),
    [rates]
  );

  const { player: playerRates, other: otherRates } = useMemo(
    () => partitionForexRates(activeRates, countryAccess),
    [activeRates, countryAccess]
  );

  const playerCurrencyCodeList = useMemo(
    () => playerRates.map((r) => r.currencyCode),
    [playerRates]
  );

  const playerCountryIdList = useMemo(() => playerRates.map((r) => r.countryId), [playerRates]);

  const heroRates = playerRates.length > 0 ? playerRates : activeRates;

  // Wait for /api/countries before locking chart defaults, otherwise the first
  // paint (access=null → all currencies as "player") sticks forever.
  const chartDefaultCurrencies =
    countryAccess != null && playerCurrencyCodeList.length > 0 ? playerCurrencyCodeList : undefined;
  const chartDefaultCountries =
    countryAccess != null && playerCountryIdList.length > 0 ? playerCountryIdList : undefined;

  const firstActiveCounter: CurrencyCode =
    FOREX_ACTIVE_CURRENCIES.find(
      (c) => c !== defaultHomeCurrency && heroRates.some((r) => r.currencyCode === c)
    ) ??
    FOREX_ACTIVE_CURRENCIES.find(
      (c) => c !== defaultHomeCurrency && activeRates.some((r) => r.currencyCode === c)
    ) ??
    "GBP";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [exchangeRes, ordersRes, macroRes, countriesRes] = await Promise.all([
        fetch("/api/forex/exchange"),
        fetch("/api/forex/orders"),
        fetch("/api/forex/monetary-policy"),
        fetch("/api/countries", { cache: "no-store" }),
      ]);

      if (!exchangeRes.ok) {
        if (exchangeRes.status === 403) {
          setEnabled(false);
          setLoading(false);
          return;
        }
        setError("Failed to load exchange data");
        setLoading(false);
        return;
      }

      const exchangeData = await exchangeRes.json();
      setEnabled(true);

      if (countriesRes.ok) {
        try {
          const countriesData = (await countriesRes.json()) as {
            countries: Array<{
              id: CountryId;
              enabledForPlayers: boolean;
              economyPreview: boolean;
              econOnly: boolean;
            }>;
          };
          const access: Partial<Record<CountryId, ForexCountryAccess>> = {};
          for (const entry of countriesData.countries ?? []) {
            access[entry.id] = {
              enabledForPlayers: entry.enabledForPlayers,
              economyPreview: entry.economyPreview,
              econOnly: entry.econOnly,
            };
          }
          setCountryAccess(access);
        } catch {
          setCountryAccess(null);
        }
      } else {
        setCountryAccess(null);
      }

      try {
        const meRes = await fetch("/api/character/me");
        if (meRes.ok) {
          const meData = await meRes.json();
          const char = meData.character;
          if (char) {
            setWallet({
              campaign: char.currencyBalances?.campaign ?? 0,
              personal: char.currencyBalances?.personal ?? {},
              homeCurrency: char.homeCurrency ?? "USD",
            });
          }
        }
      } catch {
        // Wallet fetch is non-critical — forex page still works without it
      }

      const mappedRates: ExchangeRateDisplay[] = (exchangeData.rates ?? []).map(
        (r: Record<string, unknown>) => ({
          countryId: r.countryId,
          currencyCode: r.currencyCode,
          rate: r.rate,
          baseRate: r.baseRate,
          rateHistory: ((r.rateHistory as { turn: number; rate: number }[]) ?? []).map(
            (h: { turn: number; rate: number }) => ({ turn: h.turn, value: h.rate })
          ),
          strengthVsBase: r.baseRate
            ? computeStrengthVsReferencePercent(r.rate as number, r.baseRate as number)
            : 0,
          buyVolume24: r.buyVolume24 as number | undefined,
          sellVolume24: r.sellVolume24 as number | undefined,
          interventionBand: r.interventionBand as ExchangeRateDisplay["interventionBand"],
        })
      );
      setRates(mappedRates);
      setOrderBook(exchangeData.orderBook ?? []);
      setReserveLeaders((exchangeData.reserveLeaders ?? []) as ReserveLeaderDisplay[]);

      if (macroRes.ok) {
        try {
          const macroData = await macroRes.json();
          setMacroCountries((macroData.countries ?? []) as CountryMacroSnapshot[]);
        } catch {
          setMacroCountries([]);
        }
      } else {
        setMacroCountries([]);
      }

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setMyOrders(ordersData.orders ?? []);
      }

      setLoading(false);
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [fetchData]);

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <BackButton iconOnly fallbackLabel="Back" fallbackHref="/dashboard" />
          <div className="mt-8 rounded-xl border border-card-border bg-card p-12 text-center shadow-sm">
            <div className="text-4xl mb-4 font-bold text-muted">¤</div>
            <h1 className="text-2xl font-bold mb-2">Currency Exchange</h1>
            <p className="text-muted text-sm max-w-md mx-auto">
              The foreign exchange market is not yet open. Multi-currency trading will be available
              in a future update.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const tabs: { key: ForexTab; label: string; count?: number }[] = [
    { key: "rates", label: "Currencies" },
    { key: "policy", label: "Monetary policy" },
    {
      key: "orders",
      label: "My Orders",
      count:
        myOrders.filter((o) => o.status === "open" || o.status === "partial").length || undefined,
    },
    { key: "history", label: "History" },
    { key: "feed", label: "Trade Feed" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero Card */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={HERO_IMAGE_URL}
              alt="Currency Exchange"
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
              <div className="flex items-center justify-between gap-2">
                <BackButton iconOnly fallbackLabel="Back" fallbackHref="/dashboard" />
                {!loading && enabled && (
                  <button
                    onClick={() => {
                      openTradeModal(defaultHomeCurrency, firstActiveCounter);
                    }}
                    className="rounded-lg bg-white/20 backdrop-blur-sm border border-white/30 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
                  >
                    Trade
                  </button>
                )}
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-white/70 drop-shadow italic mb-1">
                    Foreign exchange market
                  </p>
                  <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                    Currency Exchange
                  </h1>
                </div>
              </div>
            </div>
          </div>

          {/* Market stats strip — player-enabled nations only */}
          {heroRates.length > 0 && !loading && (
            <div className="border-t border-card-border bg-card-elevated/50 px-5 py-3 flex flex-wrap gap-x-6 gap-y-2">
              {heroRates.map((r) => {
                const buyNative = Math.round((r.buyVolume24 ?? 0) * r.rate);
                const sellNative = Math.round((r.sellVolume24 ?? 0) * r.rate);
                const volNative = buyNative + sellNative;
                return (
                  <div key={r.currencyCode} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-foreground">{r.currencyCode}</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {r.rate != null
                        ? r.rate >= 10
                          ? r.rate.toFixed(2)
                          : r.rate.toFixed(4)
                        : "—"}
                    </span>
                    <span
                      className={`tabular-nums font-medium ${r.strengthVsBase > 0 ? "text-success" : r.strengthVsBase < 0 ? "text-error" : "text-muted"}`}
                      title="Strength vs calibration/base rate. Positive means the currency is stronger; negative means weaker."
                    >
                      Str {r.strengthVsBase > 0 ? "+" : ""}
                      {r.strengthVsBase.toFixed(2)}%
                    </span>
                    {volNative > 0 && (
                      <span
                        className="text-muted hidden sm:inline tabular-nums"
                        title="Buy + sell volume (24 turns), native units"
                      >
                        Vol {formatCurrencyFaceAmount(volNative, r.currencyCode)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {wallet && <CurrencyWallet wallet={wallet} variant="strip" />}
        </header>

        {/* Tabs */}
        <div className="space-y-6">
          <div className="border-b border-card-border">
            <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`
                    whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors
                    ${
                      activeTab === tab.key
                        ? "border-primary text-primary"
                        : "border-transparent text-muted hover:border-card-border hover:text-foreground"
                    }
                  `}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        activeTab === tab.key
                          ? "bg-primary/10 text-primary"
                          : "bg-card-elevated text-muted"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="min-h-[400px]">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-64 w-full rounded-xl" />
              </div>
            ) : error ? (
              <div className="rounded-xl border border-error/20 bg-error/5 p-6 text-center text-error">
                {error}
              </div>
            ) : (
              <>
                {activeTab === "rates" && (
                  <div className="space-y-8">
                    <ReserveLeaders leaders={reserveLeaders} />
                    <CentralBankPolicyStrip
                      rates={heroRates}
                      currentTurn={rates.reduce(
                        (max, r) => Math.max(max, r.rateHistory.at(-1)?.turn ?? 0),
                        0
                      )}
                    />
                    <ExchangeRatesTable
                      rates={playerRates.length > 0 ? playerRates : activeRates}
                      otherRates={otherRates}
                      countryCode={_country}
                      onOpenTradeForCurrency={(code) => {
                        const counter =
                          FOREX_ACTIVE_CURRENCIES.find(
                            (c) =>
                              c !== code &&
                              (playerRates.some((rr) => rr.currencyCode === c) ||
                                activeRates.some((rr) => rr.currencyCode === c))
                          ) ?? "GBP";
                        openTradeModal(
                          defaultHomeCurrency,
                          code === defaultHomeCurrency ? counter : code
                        );
                      }}
                    />
                    <RateChart rates={activeRates} defaultCurrencyCodes={chartDefaultCurrencies} />
                    <OrderBook orders={orderBook} onFilled={fetchData} />
                  </div>
                )}
                {activeTab === "policy" && (
                  <div className="space-y-6">
                    <GlobalMonetaryPolicyChart
                      countries={macroCountries}
                      defaultCountryIds={chartDefaultCountries}
                    />
                  </div>
                )}
                {activeTab === "orders" && (
                  <MyOrders orders={myOrders} onOrderCancelled={fetchData} />
                )}
                {activeTab === "history" && <TradeHistory />}
                {activeTab === "feed" && <PublicTradeHistory />}
              </>
            )}
          </div>
        </div>
      </main>

      <CurrencyTradeModal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        rates={rates}
        wallet={wallet}
        initialFrom={tradeFrom}
        initialTo={tradeTo}
        onTradeComplete={fetchData}
      />
    </div>
  );
}
