"use client";

import { useState, useEffect, use, Suspense, useCallback, useMemo } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Skeleton, TabRowSkeleton, Tooltip as InfoTooltip } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { useCurrency } from "@/contexts/CurrencyContext";
import type {
  ExchangeData,
  CommodityData,
  BondListing,
  WealthEntry,
  MarketCapPoint,
  ExchangeFilter,
  StockTab,
  StockListing,
} from "./types";
import { StockTicker } from "./components/StockTicker";
import { ExchangeSelector } from "./components/ExchangeSelector";
import { WireTicker } from "@/components/news/WireTicker";
import { MarketOverview } from "./components/MarketOverview";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { StockList } from "./components/StockList";
import { WealthList } from "./components/WealthList";
import { BondTable } from "./components/BondTable";
import { FundTable } from "./components/FundTable";
import { CommodityTable } from "./components/CommodityTable";
import { FoundCorporationModal } from "./components/FoundCorporationModal";
import { MarketStats } from "./components/MarketStats";
import { AuctionTable } from "./components/AuctionTable";
import type { AuctionListing } from "@/lib/nationalization/auctionListing";
import Link from "next/link";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";
import { buildRuntimeExchangeMeta, getStockMarketBasePath } from "./stockMarketRouting";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { Tooltip } from "@/components/Tooltip";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";

const STATS_HISTORY_LIMIT = 500;

const VALID_TABS: StockTab[] = [
  "stocks",
  "bonds",
  "commodities",
  "wealth",
  "stats",
  "funds",
  "auctions",
];

interface PublicCountryAvailability {
  id: CountryId;
  enabledForPlayers: boolean;
}

/** Table skeleton shared by the in-page loading branch and the Suspense fallback. */
function MarketTableSkeleton() {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Table header row */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-card-border bg-card-elevated">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className={`h-3 ${i === 1 ? "flex-1" : "w-20 shrink-0"}`} />
        ))}
      </div>
      {/* Table rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-card-border last:border-0"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
            <div className="space-y-1 min-w-0">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
          {[1, 2, 3, 4].map((j) => (
            <Skeleton key={j} className="h-4 w-20 shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Full-page Suspense fallback for the useSearchParams boundary — mirrors the
 * loaded layout (hero card + stats strip + tab row + table) so the first
 * paint doesn't flash blank.
 */
function StockMarketPageFallback() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-card-border border-b border-card-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-2 bg-card-elevated/40">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-32 mb-2" />
          <Skeleton className="h-8 w-48 mb-5" />
          <Skeleton className="h-[240px] w-full rounded-lg" />
        </div>
        <div className="space-y-5">
          <TabRowSkeleton count={7} />
          <div className="min-h-[480px]">
            <MarketTableSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function StockMarketPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<StockMarketPageFallback />}>
      <StockMarketPageInner params={params} />
    </Suspense>
  );
}

function StockMarketPageInner({ params }: { params: Promise<{ code: string }> }) {
  const { code: country } = use(params);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const countryKey = country.toUpperCase() as CountryId;
  const [economyVisibleCountryIds, setEconomyVisibleCountryIds] = useState<Set<CountryId> | null>(
    null
  );
  const exchangeMeta = useMemo(
    () => buildRuntimeExchangeMeta(economyVisibleCountryIds, countryKey),
    [economyVisibleCountryIds, countryKey]
  );
  const exchangeFilter: ExchangeFilter = exchangeMeta[countryKey] ? countryKey : "global";

  const rawTab = searchParams.get("tab");
  const normalizedTab = rawTab === "listings" ? "stocks" : rawTab;
  const activeTab: StockTab =
    normalizedTab && VALID_TABS.includes(normalizedTab as StockTab)
      ? (normalizedTab as StockTab)
      : "stocks";

  const setActiveTab = (tab: StockTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const { formatAmount, currencySymbol, forexEnabled, countryId: playerCountryId } = useCurrency();
  const canFoundCorp =
    !playerCountryId ||
    !COUNTRY_CONFIGS[playerCountryId.toUpperCase() as CountryId]
      ?.disallowPrivateCorporationFounding;
  const { navData } = useAuthMe();
  const [data, setData] = useState<ExchangeData | null>(null);
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [bondListings, setBondListings] = useState<BondListing[]>([]);
  const [wealthEntries, setWealthEntries] = useState<WealthEntry[]>([]);
  const [marketHistory, setMarketHistory] = useState<MarketCapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFoundModal, setShowFoundModal] = useState(false);
  const [myCorporation, setMyCorporation] = useState<{
    sequentialId: number;
    name: string;
  } | null>(null);
  // Bug #0728: per-user founding cooldown turns remaining (0 = may found now).
  const [foundingCooldownTurns, setFoundingCooldownTurns] = useState(0);
  // `playerCountryId` (the founder's home country, which drives the founding FX
  // rate shown in the modal) comes from useCurrency above — the SAME source as
  // the currency symbol — so the rate and symbol can never disagree.
  const [error, setError] = useState("");
  // NPP-run corps are negligible flavor (t834): hidden from the stocks list by
  // default, revealed via a toggle. Server already sorts them to the bottom.
  const [showNpp, setShowNpp] = useState(false);
  const [auctions, setAuctions] = useState<AuctionListing[]>([]);
  const [auctionViewerCountryId, setAuctionViewerCountryId] = useState<string | null>(null);
  const turnStatus = useGameTurnStatus();
  const currentTurn = turnStatus?.currentTurn ?? 0;
  // Prefer the server's pinned display year (honors the pre-iteration date
  // freeze); fall back to computing from the raw turn only if it's absent.
  const gameYear =
    currentTurn > 0
      ? `${
          turnStatus?.currentYear ??
          (turnStatus?.startingYear ?? STARTING_YEAR) +
            Math.floor((currentTurn - 1) / TURNS_PER_YEAR)
        }`
      : "";

  useEffect(() => {
    let cancelled = false;

    async function fetchCountryAvailability() {
      try {
        const res = await fetch("/api/countries", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { countries: PublicCountryAvailability[] };
        if (cancelled) return;

        // Player Enabled is the gate. Economy-preview countries are deliberately
        // excluded: a country an admin has not opened for play should not have
        // its exchange offered in every other country's pill row.
        const visibleIds = new Set(
          json.countries.filter((entry) => entry.enabledForPlayers).map((entry) => entry.id)
        );

        // The country whose page this is always keeps its own pill, so landing
        // directly on a non-enabled country's market page still shows that
        // country's listings rather than silently falling through to Global.
        if (COUNTRY_CONFIGS[countryKey]?.exchangeName) {
          visibleIds.add(countryKey);
        }

        setEconomyVisibleCountryIds(visibleIds);
      } catch {
        // Keep the config-based fallback exchange registry when public availability is unavailable.
      }
    }

    void fetchCountryAvailability();
    return () => {
      cancelled = true;
    };
  }, [countryKey]);

  const fetchData = useCallback(
    async (options?: { background?: boolean }) => {
      const background = options?.background === true;
      if (!background) {
        setLoading(true);
        setError("");
        setData(null);
        setCommodities([]);
        setBondListings([]);
        setWealthEntries([]);
        setMarketHistory([]);
      }

      const exchangeApi =
        exchangeMeta[exchangeFilter]?.exchangeApi ??
        exchangeMeta[exchangeFilter.toUpperCase()]?.exchangeApi ??
        "global";
      const isStatsTab = activeTab === "stats";
      const wantsCommodities = activeTab === "commodities" || isStatsTab;
      const wantsBonds = activeTab === "bonds" || isStatsTab;
      const wantsWealth = activeTab === "wealth";

      try {
        type ApiResult<T = unknown> = { res: Response; json: T };

        const loadExchangeData = async <T,>(endpoint: string): Promise<ApiResult<T>> => {
          const res = await fetch(endpoint, { cache: "no-store" });
          const json = (await res.json()) as T;
          return { res, json };
        };

        const primaryRequests: Array<Promise<ApiResult>> = [];
        // The always-visible stats strip and stock ticker need listings. This is
        // a cheap stockExchangeSnapshots document read; the other tab endpoints
        // are loaded only when the tab actually needs them.
        primaryRequests.push(loadExchangeData(`/api/stock-exchange?exchange=${exchangeApi}`));
        if (wantsCommodities) {
          primaryRequests.push(
            loadExchangeData(
              exchangeApi === "global"
                ? "/api/commodities"
                : `/api/commodities?exchange=${exchangeApi}`
            )
          );
        }
        if (wantsBonds) {
          primaryRequests.push(
            loadExchangeData(
              exchangeApi === "global" ? "/api/bonds" : `/api/bonds?exchange=${exchangeApi}`
            )
          );
        }
        if (wantsWealth) {
          primaryRequests.push(
            loadExchangeData(`/api/stock-exchange/wealth-list?exchange=${exchangeApi}`)
          );
        }
        if (isStatsTab) {
          primaryRequests.push(
            loadExchangeData(
              `/api/stock-exchange/market-cap-history?exchange=${exchangeApi}&limit=${STATS_HISTORY_LIMIT}`
            )
          );
        }

        const primaryResults = await Promise.all(primaryRequests);
        if (primaryResults.length > 0) {
          let idx = 0;
          const { res: listingsRes, json: listingsJson } = primaryResults[idx++];
          const listingsData = listingsJson as Record<string, unknown>;
          if (listingsRes.ok) setData(listingsJson as ExchangeData);
          else if (!background)
            setError((listingsData.error as string) || "Failed to load exchange data");
          if (wantsCommodities) {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) setCommodities(d.commodities as typeof commodities);
          }
          if (wantsBonds) {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) setBondListings((d.bonds as typeof bondListings) || []);
          }
          if (wantsWealth) {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) setWealthEntries((d.entries as typeof wealthEntries) || []);
          }
          if (isStatsTab) {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) {
              setMarketHistory((d.points as typeof marketHistory) ?? []);
            }
          }
        }

        if (!background) setLoading(false);
      } catch {
        if (!background) {
          setError("Network error");
          setLoading(false);
        }
      }
    },
    [activeTab, exchangeFilter, exchangeMeta]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const id = window.setInterval(
      () => {
        void fetchData({ background: true });
      },
      5 * 60 * 1000
    );
    return () => window.clearInterval(id);
  }, [fetchData]);

  // Open privatization auctions for the selected exchange (global ⇒ all countries).
  // Tiny payload, fetched on every exchange change so the tab badge + content are
  // ready without visiting the tab. See /api/stock-exchange/auctions.
  useEffect(() => {
    const exchangeApi = exchangeMeta[exchangeFilter]?.exchangeApi ?? "global";
    let cancelled = false;
    void fetch(`/api/stock-exchange/auctions?exchange=${exchangeApi}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setAuctions((json.auctions as AuctionListing[]) ?? []);
        setAuctionViewerCountryId((json.viewerCountryId as string | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setAuctions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [exchangeFilter, exchangeMeta]);

  // Check if user is CEO of a corporation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMyCorporation(
      navData?.myCorporationId
        ? {
            sequentialId: navData.myCorporationId,
            name: "",
          }
        : null
    );
  }, [navData?.myCorporationId]);

  // Bug #0728: refresh the founding cooldown whenever the Found modal opens, so
  // the countdown is current when the player is about to act.
  useEffect(() => {
    if (!showFoundModal) return;
    let cancelled = false;
    fetchJson<{ foundingCooldownTurnsRemaining?: number }>("/api/character/me", {
      cache: "no-store",
      feature: "character-me",
    })
      .then((d) => {
        if (!cancelled && d) setFoundingCooldownTurns(d.foundingCooldownTurnsRemaining ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showFoundModal]);

  const meta =
    exchangeMeta[exchangeFilter] ??
    exchangeMeta[exchangeFilter.toUpperCase()] ??
    exchangeMeta.global;

  // Stats computed from listings — use anchor-normalised values so cross-currency
  // sums (USD + GBP + JPY corps) don't mix raw numbers as if they were the same unit.
  const totalMarketCap =
    data?.listings.reduce((s, l) => s + (l.marketCapAnchor ?? l.marketCap), 0) ?? 0;
  const totalRevenue =
    data?.listings.reduce((s, l) => s + (l.totalRevenueAnchor ?? l.totalRevenue), 0) ?? 0;
  const totalIncome = data?.listings.reduce((s, l) => s + (l.incomeAnchor ?? l.income), 0) ?? 0;
  const profitable = data?.listings.filter((l) => l.income > 0).length ?? 0;
  const totalListed = data?.listings.length ?? 0;
  const unlistedPrivateCount = data?.unlistedPrivateCount ?? 0;
  const profitablePct = totalListed > 0 ? (profitable / totalListed) * 100 : 0;
  const [stockTimeframe, setStockTimeframe] = useState<"1h" | "24h" | "48h">("24h");
  const [fundCount, setFundCount] = useState<number | undefined>(undefined);

  const getPriceChange = (l: StockListing, tf: "1h" | "24h" | "48h") => {
    switch (tf) {
      case "1h":
        return l.priceChange1h ?? 0;
      case "24h":
        return l.priceChange24h ?? 0;
      case "48h":
        return l.priceChange48h ?? 0;
    }
  };

  const weightedPriceChange =
    totalMarketCap > 0 && data?.listings
      ? (data.listings.reduce(
          (s, l) => s + getPriceChange(l, stockTimeframe) * (l.marketCapAnchor ?? l.marketCap),
          0
        ) ?? 0) / totalMarketCap
      : 0;

  const tabs: { key: StockTab; label: string; tooltip: string; count?: number }[] = [
    {
      key: "stocks",
      label: "Stocks",
      tooltip: "Listed corporations, prices, and market data",
      count: data?.listings.length,
    },
    {
      key: "bonds",
      label: "Bonds",
      tooltip: "Corporate bond listings and yields",
      count: bondListings.length || undefined,
    },
    {
      key: "commodities",
      label: "Commodities",
      tooltip: "Raw material prices and exchange-traded commodities",
      count: commodities.length || undefined,
    },
    {
      key: "wealth",
      label: "Wealth List",
      tooltip: "Richest characters by portfolio value",
      count: wealthEntries.length || undefined,
    },
    { key: "stats", label: "Stats", tooltip: "Aggregate market statistics and historical trends" },
    {
      key: "funds",
      label: "Funds",
      tooltip: "Index funds — passive investment products tracking market indices",
      count: fundCount,
    },
    {
      key: "auctions",
      label: "Auctions",
      tooltip: "Open privatization auctions for carved state assets",
      count: auctions.length || undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      <StockTicker listings={data?.listings ?? []} commodities={commodities} />
      <WireTicker />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Compact header bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton iconOnly fallbackLabel="Back" fallbackHref="/dashboard" />
            <div className="min-w-0">
              <h1
                data-coach="nav-stockmarket"
                className="text-lg font-bold tracking-tight text-foreground truncate sm:text-xl"
              >
                {meta.title}
              </h1>
              <p className="text-xs text-muted truncate">{meta.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ExchangeSelector
              exchangeMeta={exchangeMeta}
              exchangeFilter={exchangeFilter}
              onSelect={(key) => {
                const params = new URLSearchParams(searchParams.toString());
                const qs = params.toString();
                const basePath = getStockMarketBasePath(key as ExchangeFilter, country);
                router.replace(qs ? `${basePath}?${qs}` : basePath, {
                  scroll: false,
                });
              }}
            />
            <Link
              href="/portfolio"
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-card-elevated transition-colors"
            >
              My Wallet
            </Link>
            {myCorporation ? (
              <Link
                href={`/corporation/${myCorporation.sequentialId}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                My Corp
              </Link>
            ) : canFoundCorp ? (
              <button
                data-coach="nav-corporations"
                onClick={() => setShowFoundModal(true)}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                Found Corp
              </button>
            ) : null}
          </div>
        </div>

        {/* Stats band */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-card-border">
            <div className="px-4 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium mb-0.5 inline-flex items-center">
                Listed
                <InfoTooltip content="Only corporations that have IPO'd (gone public) appear here. Privately-held corporations exist but aren't listed until they go public." />
              </span>
              <span className="text-lg font-bold tabular-nums block">{totalListed}</span>
              {unlistedPrivateCount > 0 && (
                <span className="text-[10px] text-muted block mt-0.5">
                  +{unlistedPrivateCount} private
                </span>
              )}
            </div>
            <div className="px-4 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium block mb-0.5">
                Market Cap
              </span>
              <span className="text-lg font-bold tabular-nums">{formatAmount(totalMarketCap)}</span>
            </div>
            <div className="px-4 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium block mb-0.5">
                Revenue
              </span>
              <span className="text-lg font-bold tabular-nums">{formatAmount(totalRevenue)}</span>
            </div>
            <div className="px-4 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium block mb-0.5">
                Income
              </span>
              <span
                className={`text-lg font-bold tabular-nums ${totalIncome >= 0 ? "text-success" : "text-error"}`}
              >
                {totalIncome >= 0 ? "+" : ""}
                {formatAmount(totalIncome)}
              </span>
            </div>
            <div className="px-4 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium block mb-0.5">
                Profitable
              </span>
              <span
                className={`text-lg font-bold tabular-nums ${
                  profitablePct >= 75
                    ? "text-success"
                    : profitablePct >= 50
                      ? "text-foreground"
                      : "text-error"
                }`}
              >
                {profitablePct.toFixed(0)}%
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                  {stockTimeframe.toUpperCase()}
                </span>
                <div className="flex items-center gap-0.5 bg-card-elevated rounded px-0.5 py-px border border-card-border">
                  {(["1h", "24h", "48h"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setStockTimeframe(tf)}
                      className={`text-[9px] font-bold px-1 py-px rounded transition-colors ${
                        stockTimeframe === tf
                          ? "bg-primary text-white"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  weightedPriceChange >= 0 ? "text-success" : "text-error"
                }`}
              >
                {weightedPriceChange >= 0 ? "+" : ""}
                {weightedPriceChange.toFixed(2)}%
              </span>
            </div>
          </div>
          {currentTurn > 0 && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-card-elevated/40 border-t border-card-border">
              <span className="text-[10px] font-mono text-muted tracking-wider">
                TURN {currentTurn}
              </span>
              <span className="text-[10px] font-mono text-muted tracking-wider">{gameYear}</span>
            </div>
          )}
        </div>

        {/* Market Overview Chart */}
        <MarketOverview exchangeFilter={exchangeFilter} />

        {/* Tabs */}
        <div className="space-y-6">
          <div className="border-b border-card-border">
            <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
              {tabs.map((tab) => (
                <Tooltip key={tab.key} content={tab.tooltip}>
                  <button
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
                </Tooltip>
              ))}
            </nav>
          </div>

          <div className="min-h-[480px]">
            {loading ? (
              <MarketTableSkeleton />
            ) : error ? (
              <div className="rounded-xl border border-error/20 bg-error/5 p-6 text-center text-error">
                {error}
              </div>
            ) : (
              <>
                {activeTab === "stocks" &&
                  (() => {
                    const all = data?.listings ?? [];
                    const nppCount = all.filter((l) => l.isNpp).length;
                    const visible = showNpp ? all : all.filter((l) => !l.isNpp);
                    return (
                      <>
                        {nppCount > 0 && (
                          <div className="mb-3 flex justify-end">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={showNpp}
                                onChange={(e) => setShowNpp(e.target.checked)}
                              />
                              Show NPP corporations ({nppCount})
                            </label>
                          </div>
                        )}
                        <StockList listings={visible} timeframe={stockTimeframe} />
                      </>
                    );
                  })()}
                {activeTab === "wealth" && <WealthList entries={wealthEntries} />}
                {activeTab === "bonds" && <BondTable bonds={bondListings} />}
                {activeTab === "commodities" && (
                  <CommodityTable commodities={commodities} exchangeFilter={exchangeFilter} />
                )}
                {activeTab === "funds" && (
                  <FundTable
                    countryCode={country}
                    exchangeFilter={exchangeFilter}
                    timeframe={stockTimeframe}
                    onCountChange={setFundCount}
                  />
                )}
                {activeTab === "stats" && (
                  <MarketStats
                    listings={data?.listings ?? []}
                    commodities={commodities}
                    bondListings={bondListings}
                    history={marketHistory}
                  />
                )}
                {activeTab === "auctions" && (
                  <AuctionTable
                    auctions={auctions}
                    viewerCountryId={auctionViewerCountryId}
                    showFlag={exchangeFilter === "global"}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <FoundCorporationModal
        open={showFoundModal}
        onClose={() => setShowFoundModal(false)}
        currencySymbol={currencySymbol}
        // Shared with the server route (POST /api/corporations) so the fee and
        // treasury figures shown here always match what the server charges.
        foundingRate={getFoundingFxRate(playerCountryId, forexEnabled)}
        countryId={playerCountryId ?? undefined}
        foundingCooldownTurnsRemaining={foundingCooldownTurns}
        onSuccess={() => {
          fetchData();
          // Refresh the global status bar (corp nav/chip) the same way trade
          // flows do — founding otherwise leaves it stale until a full reload.
          requestCharacterStatsRefetch();
          // Refresh corporation status after founding. cache:"no-store" bypasses
          // the browser HTTP cache so the post-founding read never returns a
          // pre-founding (corporation: null) body and silently skips the setter.
          fetchJson<{
            corporation?: { sequentialId: number; name: string };
            foundingCooldownTurnsRemaining?: number;
          }>("/api/character/me", { cache: "no-store", feature: "character-me" })
            .then((data) => {
              if (data?.corporation) setMyCorporation(data.corporation);
              if (data) setFoundingCooldownTurns(data.foundingCooldownTurnsRemaining ?? 0);
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}
