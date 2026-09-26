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
import { ExchangeSelector, type ExchangeCompareRow } from "./components/ExchangeSelector";
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
import type { FundTickerInput } from "./components/StockTicker";
import type { FundListItem } from "@/components/indexFunds/types";
import type { Holding, BondHolding } from "@/components/portfolio/HoldingsTables";
import Link from "next/link";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { privateEnterpriseBlockedByYear } from "@/lib/economy/queries/privateEnterpriseRegime";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { buildRuntimeExchangeMeta, getStockMarketBasePath } from "./stockMarketRouting";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { Tooltip } from "@/components/Tooltip";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";
import { aggregateExchangeTotals } from "@/lib/stockExchange/aggregate";

/**
 * Shared history window (newest 2000 turns). One fetch feeds both the overview
 * chart, which slices per timeframe client-side, and the stats tab, so the two
 * never hold overlapping copies from different requests.
 */
const HISTORY_LIMIT = 2000;

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

/**
 * Slim contextual strip for the non-equity tabs, where the total-market index
 * chart adds little. Returns null until its tab's data arrives.
 */
function TabContextStrip({
  activeTab,
  wealthEntries,
  funds,
  auctions,
}: {
  activeTab: StockTab;
  wealthEntries: WealthEntry[];
  funds: FundListItem[];
  auctions: AuctionListing[];
}) {
  const { formatAmount } = useCurrency();
  const stats: { label: string; value: string }[] = [];
  if (activeTab === "wealth" && wealthEntries.length > 0) {
    stats.push(
      { label: "Ranked players", value: wealthEntries.length.toLocaleString("en-US") },
      { label: "Top wealth", value: formatAmount(wealthEntries[0].totalWealth) }
    );
  } else if (activeTab === "funds" && funds.length > 0) {
    stats.push(
      { label: "Index funds", value: funds.length.toLocaleString("en-US") },
      {
        label: "Combined AUM",
        value: formatAmount(funds.reduce((s, f) => s + f.aumAnchor, 0)),
      }
    );
  } else if (activeTab === "auctions" && auctions.length > 0) {
    const closingSoon = auctions.filter((a) => a.turnsLeft <= 24).length;
    stats.push(
      { label: "Open auctions", value: auctions.length.toLocaleString("en-US") },
      {
        label: "Closing within 24 turns",
        value: closingSoon.toLocaleString("en-US"),
      }
    );
  }
  if (stats.length === 0) return null;
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-card-border">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <span className="text-[10px] uppercase tracking-widest text-muted font-medium block mb-0.5">
              {s.label}
            </span>
            <span className="text-lg font-bold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
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
  const countryName = useCountryDisplayName();
  const exchangeMeta = useMemo(
    () => buildRuntimeExchangeMeta(economyVisibleCountryIds, countryKey, countryName),
    [economyVisibleCountryIds, countryKey, countryName]
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

  const {
    formatAmount,
    currencySymbol,
    forexEnabled,
    countryId: playerCountryId,
    baseRates,
  } = useCurrency();
  const turnStatusForGate = useGameTurnStatus();
  // Schedule-only (no DB) because this is a client component: the server route is
  // the authority and re-checks against the live persisted dial. Near the command
  // ceiling the two can disagree, in which case the button shows and the POST
  // returns 403 with the same message.
  const canFoundCorp =
    !playerCountryId ||
    !privateEnterpriseBlockedByYear(
      playerCountryId.toUpperCase(),
      turnStatusForGate?.currentYear ?? null
    );
  const { navData } = useAuthMe();
  const [data, setData] = useState<ExchangeData | null>(null);
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [bondListings, setBondListings] = useState<BondListing[]>([]);
  const [wealthEntries, setWealthEntries] = useState<WealthEntry[]>([]);
  const [marketHistory, setMarketHistory] = useState<MarketCapPoint[]>([]);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [funds, setFunds] = useState<FundListItem[]>([]);
  const [fundsError, setFundsError] = useState("");
  const [bondTotalOutstanding, setBondTotalOutstanding] = useState<number | undefined>(undefined);
  // Viewer positions for owned-markers (P1). Absent when signed out: the
  // request 401s, the catch keeps the maps empty, and no chips render.
  const [myStockHoldings, setMyStockHoldings] = useState<Holding[]>([]);
  const [myBondHoldings, setMyBondHoldings] = useState<BondHolding[]>([]);
  // Lazy per-exchange sizes for the compare panel (P14): fetched once when
  // opened, never on the background poll.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, ExchangeCompareRow>>({});
  const [compareLoading, setCompareLoading] = useState(false);
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

  const [stockTimeframe, setStockTimeframe] = useState<"1h" | "24h" | "48h">("24h");
  const [fundCount, setFundCount] = useState<number | undefined>(undefined);

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
        setHistoryDate(null);
        setFunds([]);
        setFundsError("");
        setBondTotalOutstanding(undefined);
      }

      const exchangeApi =
        exchangeMeta[exchangeFilter]?.exchangeApi ??
        exchangeMeta[exchangeFilter.toUpperCase()]?.exchangeApi ??
        "global";
      // Commodities feed the always-visible ticker, so they load on every tab,
      // not just the commodities tab. History is shared the same way: one
      // window feeds both the overview chart and the stats tab. Bonds and
      // wealth are cheap snapshot reads and load eagerly so their tab badges
      // are populated on first paint; only auctions stay lazy.
      const fundsExchangeApi = exchangeFilter === "global" ? "global" : exchangeFilter;

      try {
        type ApiResult<T = unknown> = { res: Response; json: T };

        const loadExchangeData = async <T,>(endpoint: string): Promise<ApiResult<T>> => {
          const res = await fetch(endpoint, { cache: "no-store" });
          const json = (await res.json()) as T;
          return { res, json };
        };

        const primaryRequests: Array<Promise<ApiResult>> = [];
        // The always-visible stats strip and stock ticker need listings. This is
        // a cheap stockExchangeSnapshots document read; the bonds and wealth
        // endpoints are loaded only when a tab actually needs them.
        primaryRequests.push(loadExchangeData(`/api/stock-exchange?exchange=${exchangeApi}`));
        primaryRequests.push(
          loadExchangeData(
            exchangeApi === "global"
              ? "/api/commodities"
              : `/api/commodities?exchange=${exchangeApi}`
          )
        );
        primaryRequests.push(
          loadExchangeData(
            exchangeApi === "global" ? "/api/bonds" : `/api/bonds?exchange=${exchangeApi}`
          )
        );
        primaryRequests.push(
          loadExchangeData(`/api/stock-exchange/wealth-list?exchange=${exchangeApi}`)
        );
        primaryRequests.push(
          loadExchangeData(
            `/api/stock-exchange/market-cap-history?exchange=${exchangeApi}&limit=${HISTORY_LIMIT}`
          )
        );
        primaryRequests.push(
          loadExchangeData(`/api/investment-funds?exchange=${fundsExchangeApi}`)
        );

        const primaryResults = await Promise.all(primaryRequests);
        if (primaryResults.length > 0) {
          let idx = 0;
          const { res: listingsRes, json: listingsJson } = primaryResults[idx++];
          const listingsData = listingsJson as Record<string, unknown>;
          if (listingsRes.ok) setData(listingsJson as ExchangeData);
          else if (!background)
            setError((listingsData.error as string) || "Failed to load exchange data");
          {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) setCommodities(d.commodities as typeof commodities);
          }
          {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) {
              setBondListings((d.bonds as typeof bondListings) || []);
              setBondTotalOutstanding(
                typeof d.totalOutstanding === "number" ? d.totalOutstanding : undefined
              );
            }
          }
          {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) setWealthEntries((d.entries as typeof wealthEntries) || []);
          }
          {
            const { res, json } = primaryResults[idx++];
            const d = json as Record<string, unknown>;
            if (res.ok) {
              setMarketHistory((d.points as typeof marketHistory) ?? []);
              setHistoryDate((d.newestTurnDate as string | null) ?? null);
            }
          }
          {
            const { res, json } = primaryResults[idx++];
            if (res.status === 403) {
              setFunds([]);
              setFundCount(0);
            } else if (res.ok) {
              const d = json as { funds?: FundListItem[] };
              const list = d.funds ?? [];
              setFunds(list);
              setFundCount(list.length);
              if (!background) setFundsError("");
            } else if (!background) {
              setFundsError("Failed to load funds");
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
    [exchangeFilter, exchangeMeta]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  // Viewer positions, fetched once per page visit (not on the 5-minute poll:
  // positions change only when the viewer trades). Signed-out or unreachable
  // viewers simply get no owned-markers; that is an expected state, not a fault.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/character/portfolio", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { holdings?: unknown; bondHoldings?: unknown };
        if (cancelled) return;
        if (Array.isArray(json.holdings)) setMyStockHoldings(json.holdings as Holding[]);
        if (Array.isArray(json.bondHoldings))
          setMyBondHoldings(json.bondHoldings as BondHolding[]);
      } catch {
        // Expected when signed out or offline: leave the maps empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Fetched only while the auctions tab is active (#2168), avoiding an extra
  // request on every default stocks-page visit. The tab badge populates once the
  // tab is visited; cached rows persist across tab switches in-session.
  const isAuctionsTab = activeTab === "auctions";
  useEffect(() => {
    if (!isAuctionsTab) return;
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
  }, [exchangeFilter, exchangeMeta, isAuctionsTab]);

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

  // Stats computed from listings — anchor-normalised so cross-currency sums
  // (USD + GBP + JPY corps) don't mix raw numbers as if they were the same unit.
  // Shared with the Economy page card and the public API so the three cannot
  // report different totals for one exchange. See lib/stockExchange/aggregate.
  const exchangeTotals = aggregateExchangeTotals(data?.listings ?? []);
  const totalMarketCap = exchangeTotals.marketCap;
  const totalRevenue = exchangeTotals.revenue;
  const totalIncome = exchangeTotals.income;
  const profitable = data?.listings.filter((l) => l.income > 0).length ?? 0;
  const totalListed = data?.listings.length ?? 0;
  const unlistedPrivateCount = data?.unlistedPrivateCount ?? 0;
  const profitablePct = totalListed > 0 ? (profitable / totalListed) * 100 : 0;
  // Ticker inputs derived from the shared funds fetch (P2): the same response
  // that feeds the Funds tab, so the ticker and the tab cannot disagree.
  const fundTickerItems: FundTickerInput[] = useMemo(
    () =>
      funds.map((f) => ({
        id: f.id,
        slug: f.slug,
        tickerSymbol: f.tickerSymbol,
        name: f.name,
        quotedNav: f.quotedNav,
        navChange24: f.navChange24,
        countryCode: f.countryId ?? country,
      })),
    [funds, country]
  );

  // Corporation names by id for the fund holdings previews.
  const corpNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of data?.listings ?? []) {
      m.set(l._id, l.name);
      if (l.sequentialId != null) m.set(String(l.sequentialId), l.name);
    }
    return m;
  }, [data]);

  const toggleCompare = () => {
    const next = !compareOpen;
    setCompareOpen(next);
    if (next && Object.keys(compareData).length === 0) {
      setCompareLoading(true);
      const rows = Object.entries(exchangeMeta);
      void Promise.all(
        rows.map(async ([key, meta]) => {
          try {
            const res = await fetch(`/api/stock-exchange?exchange=${meta.exchangeApi}`, {
              cache: "no-store",
            });
            if (!res.ok) return null;
            const json = (await res.json()) as ExchangeData;
            const totals = aggregateExchangeTotals(json.listings ?? []);
            return {
              key,
              row: { listings: (json.listings ?? []).length, marketCap: totals.marketCap },
            };
          } catch {
            return null;
          }
        })
      ).then((results) => {
        const nextData: Record<string, ExchangeCompareRow> = {};
        for (const r of results) {
          if (r) nextData[r.key] = r.row;
        }
        setCompareData(nextData);
        setCompareLoading(false);
      });
    }
  };

  // Owned-position lookups keyed by corporation/bond id (plus sequential id
  // for listings, since portfolio holdings key off the ObjectId).
  const ownedSharesByCorp = useMemo(() => {
    const m = new Map<string, { shares: number; pnl: number | null }>();
    for (const h of myStockHoldings) {
      if (!h || h.shares <= 0) continue;
      const entry = { shares: h.shares, pnl: h.unrealizedPnl ?? null };
      m.set(h.corporationId, entry);
      if (h.sequentialId != null) m.set(String(h.sequentialId), entry);
    }
    return m;
  }, [myStockHoldings]);
  const ownedBondUnits = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of myBondHoldings) {
      if (!h || h.units <= 0) continue;
      m.set(h.bondId, h.units);
    }
    return m;
  }, [myBondHoldings]);

  const weightedPriceChange =
    stockTimeframe === "1h"
      ? exchangeTotals.weightedChange1h
      : stockTimeframe === "48h"
        ? exchangeTotals.weightedChange48h
        : exchangeTotals.weightedChange24h;

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
      <StockTicker
        listings={data?.listings ?? []}
        commodities={commodities}
        funds={fundTickerItems}
      />
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
              compareData={compareData}
              compareLoading={compareLoading}
              compareOpen={compareOpen}
              onToggleCompare={toggleCompare}
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

        {/* Market Overview Chart on equity tabs; a compact contextual strip on
            wealth/funds/auctions where a total-market index adds little. */}
        {activeTab === "stocks" ||
        activeTab === "stats" ||
        activeTab === "bonds" ||
        activeTab === "commodities" ? (
          <MarketOverview
            exchangeFilter={exchangeFilter}
            timeframe={stockTimeframe}
            onTimeframeChange={setStockTimeframe}
            history={marketHistory}
            newestTurnDate={historyDate}
            historyLoading={loading}
          />
        ) : (
          <TabContextStrip
            activeTab={activeTab}
            wealthEntries={wealthEntries}
            funds={funds}
            auctions={auctions}
          />
        )}

        {/* Tabs */}
        <div className="space-y-6">
          <div className="border-b border-card-border flex items-end justify-between gap-4">
            <Link
              href="/guides/investing"
              className="order-2 mb-3 shrink-0 text-xs font-semibold text-muted hover:text-primary transition-colors whitespace-nowrap"
            >
              How investing works
            </Link>
            <nav
              className="-mb-px flex gap-6 overflow-x-auto order-1 min-w-0 flex-1"
              aria-label="Tabs"
            >
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
                        <StockList
                          listings={visible}
                          timeframe={stockTimeframe}
                          owned={ownedSharesByCorp}
                        />
                      </>
                    );
                  })()}
                {activeTab === "wealth" && <WealthList entries={wealthEntries} />}
                {activeTab === "bonds" && (
                  <BondTable
                    bonds={bondListings}
                    totalOutstanding={bondTotalOutstanding}
                    ownedUnits={ownedBondUnits}
                  />
                )}
                {activeTab === "commodities" && (
                  <CommodityTable commodities={commodities} exchangeFilter={exchangeFilter} />
                )}
                {activeTab === "funds" && (
                  <FundTable
                    countryCode={country}
                    exchangeFilter={exchangeFilter}
                    timeframe={stockTimeframe}
                    onCountChange={setFundCount}
                    externalFunds={funds}
                    externalLoading={loading && funds.length === 0}
                    externalError={fundsError}
                    corpNames={corpNameById}
                  />
                )}
                {activeTab === "stats" && (
                  <MarketStats
                    listings={data?.listings ?? []}
                    commodities={commodities}
                    bondListings={bondListings}
                    history={marketHistory}
                    bondTotalOutstanding={bondTotalOutstanding}
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
        foundingRate={getFoundingFxRate(playerCountryId, forexEnabled, baseRates)}
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
