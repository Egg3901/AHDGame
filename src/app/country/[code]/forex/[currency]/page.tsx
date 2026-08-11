"use client";

import { useState, useEffect, use, Suspense } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { HeroImage } from "@/components/HeroImage";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";
import { RateChart } from "@/components/forex/RateChart";
import { OrderBook } from "@/components/forex/OrderBook";
import { CurrencyWallet } from "@/components/forex/CurrencyWallet";
import { CurrencyTradeModal } from "@/components/forex/CurrencyTradeModal";
import { TransactionHistory } from "@/components/forex/TransactionHistory";
import { CurrencyHolders } from "@/components/forex/CurrencyHolders";
import type {
  ExchangeRateDisplay,
  WalletBalances,
  OrderDisplay,
} from "@/app/country/[code]/forex/types";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { CountryFlag } from "@/components/CountryFlag";
import { CURRENCY_FLAG_CODE } from "@/components/forex/currencyDisplay";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { computeStrengthVsReferencePercent } from "@/lib/forex/rateSemantics";

const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CAD: "Canadian Dollar",
  EUR: "Euro",
};
const CURRENCY_HERO_IMAGES: Record<string, string> = {
  USD: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg/960px-NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg",
  GBP: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Bank_of_England_-_geograph.org.uk_-_1444914.jpg/1280px-Bank_of_England_-_geograph.org.uk_-_1444914.jpg",
  JPY: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Tokyo_International_Financial_Centre.jpg/1280px-Tokyo_International_Financial_Centre.jpg",
  EUR: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/European_Central_Bank_new_premises_from_the_south_2015.jpg/1280px-European_Central_Bank_new_premises_from_the_south_2015.jpg",
  CAD: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Toronto_-_ON_-_Bay_Street_Financial_District.jpg/1280px-Toronto_-_ON_-_Bay_Street_Financial_District.jpg",
};
const FALLBACK_HERO_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg/960px-NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg";

export default function CurrencyDetailPage({
  params,
}: {
  params: Promise<{ code: string; currency: string }>;
}) {
  return (
    <Suspense>
      <CurrencyDetailInner params={params} />
    </Suspense>
  );
}

function CurrencyDetailInner({ params }: { params: Promise<{ code: string; currency: string }> }) {
  const { code: countryCode, currency: currencyParam } = use(params);
  const router = useRouter();
  const currencyCode = currencyParam.toUpperCase() as CurrencyCode;

  const [rates, setRates] = useState<ExchangeRateDisplay[]>([]);
  const [orderBook, setOrderBook] = useState<OrderDisplay[]>([]);
  const [myOrders, setMyOrders] = useState<OrderDisplay[]>([]);
  const [activeTab, setActiveTab] = useState<"market" | "holders" | "history">("market");
  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);

  const fetchData = async () => {
    // Whole body guarded: a rejected fetch (network drop) used to skip every
    // setLoading(false) below, leaving the page spinning forever. try/finally
    // guarantees the spinner ends; the catch surfaces an error state + reports.
    try {
      const [res, ordersRes] = await Promise.all([
        fetch("/api/forex/exchange"),
        fetch("/api/forex/orders"),
      ]);
      if (!res.ok) {
        if (res.status === 403) {
          setEnabled(false);
          return;
        }
        setLoadError(true);
        return;
      }
      const data = await res.json();
      setEnabled(true);

      const mappedRates: ExchangeRateDisplay[] = (data.rates ?? []).map(
        (r: Record<string, unknown>) => ({
          countryId: r.countryId,
          currencyCode: r.currencyCode,
          rate: r.rate,
          baseRate: r.baseRate,
          rateHistory: ((r.rateHistory as { turn: number; rate: number }[]) ?? []).map((h) => ({
            turn: h.turn,
            value: h.rate,
          })),
          strengthVsBase: r.baseRate
            ? computeStrengthVsReferencePercent(r.rate as number, r.baseRate as number)
            : 0,
          buyVolume24: r.buyVolume24 as number | undefined,
          sellVolume24: r.sellVolume24 as number | undefined,
        })
      );
      setRates(mappedRates);

      // Map orderBook items to OrderDisplay (some fields not returned by API; use defaults)
      const mappedOrders: OrderDisplay[] = (data.orderBook ?? []).map(
        (o: Record<string, unknown>) => ({
          _id: o._id as string,
          characterId: "",
          characterName: o.characterName as string,
          type: o.type as OrderDisplay["type"],
          fromCurrency: o.fromCurrency as CurrencyCode,
          toCurrency: o.toCurrency as CurrencyCode,
          amount: o.amount as number,
          limitRate: o.limitRate as number | undefined,
          status: o.status as OrderDisplay["status"],
          filledAmount: o.filledAmount as number,
          spreadCharged: 0,
          createdAt: o.createdAt as string,
        })
      );
      setOrderBook(mappedOrders);

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setMyOrders(ordersData.orders ?? []);
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
        /* wallet is non-critical */
      }
    } catch (err) {
      setLoadError(true);
      Sentry.captureException(err, { tags: { feature: "forex.currencyDetail" } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Redirect if currency not found after load
  const rateEntry = rates.find((r) => r.currencyCode === currencyCode);
  useEffect(() => {
    if (!loading && enabled && rates.length > 0 && !rateEntry) {
      router.replace(`/country/${countryCode}/forex`);
    }
  }, [loading, enabled, rates, rateEntry, router, countryCode]);

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <BackButton
            iconOnly
            fallbackLabel="Back"
            fallbackHref={`/country/${countryCode}/forex`}
          />
          <div className="mt-8 rounded-xl border border-card-border bg-card p-12 text-center shadow-sm">
            <p className="text-muted text-sm">Currency exchange is not yet enabled.</p>
          </div>
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <BackButton
            iconOnly
            fallbackLabel="Back"
            fallbackHref={`/country/${countryCode}/forex`}
          />
          <div className="mt-8 rounded-xl border border-card-border bg-card p-12 text-center shadow-sm">
            <p className="text-muted text-sm">
              Couldn&apos;t load the currency market. Please try again.
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadError(false);
                setLoading(true);
                fetchData();
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

  const sym = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
  const name = CURRENCY_NAMES[currencyCode] ?? currencyCode;
  const strengthVsBase = rateEntry?.strengthVsBase ?? 0;

  // Filter order book to orders involving this currency
  const filteredOrderBook = orderBook.filter(
    (o) => o.fromCurrency === currencyCode || o.toCurrency === currencyCode
  );

  const myOpenOrdersForCurrency = myOrders.filter(
    (o) =>
      (o.status === "open" || o.status === "partial") &&
      (o.fromCurrency === currencyCode || o.toCurrency === currencyCode)
  ).length;

  // Volumes are stored in internal (USD-equivalent) units; multiply by rate to get native units
  const ownRate = rateEntry?.rate ?? 1;
  const buyVolumeNative = Math.round((rateEntry?.buyVolume24 ?? 0) * ownRate);
  const sellVolumeNative = Math.round((rateEntry?.sellVolume24 ?? 0) * ownRate);

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={CURRENCY_HERO_IMAGES[currencyCode] ?? FALLBACK_HERO_IMAGE}
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
                <BackButton
                  iconOnly
                  fallbackLabel="Back"
                  fallbackHref={`/country/${countryCode}/forex`}
                />
                {!loading && enabled && (
                  <button
                    type="button"
                    onClick={() => setTradeOpen(true)}
                    className="rounded-lg bg-white/20 backdrop-blur-sm border border-white/30 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
                  >
                    Trade
                  </button>
                )}
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CountryFlag
                    country={(CURRENCY_FLAG_CODE[currencyCode] ?? currencyCode).toUpperCase()}
                    size="xl"
                    className="rounded-md shadow-lg"
                  />
                  <div>
                    <p className="text-xs text-white/70 italic mb-0.5">Currency Exchange</p>
                    <h1 className="text-xl font-bold text-white drop-shadow-md sm:text-3xl tabular-nums">
                      {sym} {currencyCode}
                    </h1>
                    <p className="text-sm text-white/80">{name}</p>
                  </div>
                </div>
                {rateEntry && (
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold tabular-nums text-white">
                      {rateEntry.rate != null
                        ? rateEntry.rate >= 10
                          ? rateEntry.rate.toFixed(2)
                          : rateEntry.rate.toFixed(4)
                        : "—"}
                    </div>
                    <div
                      className={`text-sm font-medium tabular-nums ${
                        strengthVsBase > 0
                          ? "text-green-400"
                          : strengthVsBase < 0
                            ? "text-red-400"
                            : "text-white/60"
                      }`}
                    >
                      {strengthVsBase > 0 ? "+" : ""}
                      {strengthVsBase.toFixed(2)}% strength vs base
                    </div>
                    <div className="text-[10px] text-white/60">Higher rate = weaker currency</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats strip */}
          {rateEntry && !loading && (
            <div className="border-t border-card-border bg-card-elevated/50 px-5 py-3 flex flex-wrap gap-x-8 gap-y-2 items-center justify-between">
              <div className="flex gap-x-8 gap-y-2 flex-wrap text-xs">
                <div>
                  <span className="text-muted">Buy Vol (24t)</span>{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {formatCurrencyFaceAmount(buyVolumeNative, currencyCode)}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Sell Vol (24t)</span>{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {formatCurrencyFaceAmount(sellVolumeNative, currencyCode)}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Order book</span>{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {filteredOrderBook.length}
                  </span>
                </div>
                <div>
                  <span className="text-muted">My open orders</span>{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {myOpenOrdersForCurrency}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setTradeOpen(true)}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                Trade {currencyCode}
              </button>
            </div>
          )}

          {wallet && <CurrencyWallet wallet={wallet} variant="strip" />}
        </header>

        {/* Tab nav */}
        <div className="border-b border-card-border">
          <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
            {(
              [
                { key: "market", label: "Market" },
                { key: "holders", label: "Holders" },
                { key: "history", label: "Transactions" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted hover:border-card-border hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : activeTab === "market" ? (
          <div className="space-y-8">
            {rateEntry && (
              <RateChart rates={rates.filter((r) => r.currencyCode === currencyCode)} />
            )}
            <OrderBook orders={filteredOrderBook} onFilled={fetchData} />
          </div>
        ) : activeTab === "holders" ? (
          <CurrencyHolders currency={currencyCode} />
        ) : (
          <TransactionHistory currency={currencyCode} />
        )}
      </main>

      <CurrencyTradeModal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        rates={rates}
        wallet={wallet}
        initialFrom={wallet?.homeCurrency ?? "USD"}
        initialTo={currencyCode !== (wallet?.homeCurrency ?? "USD") ? currencyCode : undefined}
        onTradeComplete={fetchData}
      />
    </div>
  );
}
