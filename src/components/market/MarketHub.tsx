"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CommodityData } from "@/app/country/[code]/stockmarket/types";
import { MARKET_TABS, parseMarketTab, type MarketTab } from "@/lib/market/hubTabs";
import { CommoditiesPanel } from "./CommoditiesPanel";
import { MarketOverview } from "./MarketOverview";
import {
  BondsPanel,
  CurrenciesPanel,
  FundsPanel,
  SectorsPanel,
  StocksPanel,
  WealthPanel,
  sectorsUrl,
  type SectorsForSaleResponse,
} from "./MarketPanels";
import { SUPPLY_PAGE_SIZE, SupplyDealsPanel, type SupplyOffersResponse } from "./SupplyDealsPanel";
import { DEFAULT_OFFER_FILTERS, offersQuery } from "./supplyOfferUi";
import { StockMarketChart } from "@/app/country/[code]/stockmarket/components/MarketOverview";
import { useMarketJson } from "./useMarketJson";

import { MarketCorporationAction } from "./MarketCorporationAction";
import { useEnabledCountries, useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { buildRuntimeExchangeMeta } from "@/app/country/[code]/stockmarket/stockMarketRouting";
import {
  ExchangeSelector,
  type ExchangeCompareRow,
} from "@/app/country/[code]/stockmarket/components/ExchangeSelector";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { aggregateExchangeTotals } from "@/lib/stockExchange/aggregate";
import type { ExchangeData } from "@/app/country/[code]/stockmarket/types";

const CHART_KEY = "market.chartOpen";

/** Chart visibility, remembered per browser; expanded until the player hides it. */
function useChartOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHART_KEY) === "0") setOpen(false);
    } catch {
      // storage unavailable: keep the default
    }
  }, []);
  return [
    open,
    (next) => {
      setOpen(next);
      try {
        window.localStorage.setItem(CHART_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable: the choice lasts for this visit
      }
    },
  ];
}

export function MarketHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseMarketTab(searchParams.get("tab"));
  const enabledCountries = useEnabledCountries();
  const countryName = useCountryDisplayName();
  const exchangeMeta = useMemo(
    () => buildRuntimeExchangeMeta(new Set(enabledCountries), "US", countryName),
    [enabledCountries, countryName]
  );
  const selectedExchange = searchParams.get("exchange")?.toUpperCase() ?? "global";
  const exchangeFilter = exchangeMeta[selectedExchange] ? selectedExchange : "global";
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, ExchangeCompareRow>>({});
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareLoaded, setCompareLoaded] = useState(false);

  // Shared with the overview and the commodities, sectors and supply tabs
  // through the response cache.
  const commodities = useMarketJson<{ commodities?: CommodityData[] }>("/api/commodities");
  const sectors = useMarketJson<SectorsForSaleResponse>(sectorsUrl(1));
  const offers = useMarketJson<SupplyOffersResponse>(
    `/api/supply-offers?${offersQuery(DEFAULT_OFFER_FILTERS, 1, SUPPLY_PAGE_SIZE)}`
  );
  const list = commodities.data?.commodities ?? null;
  const supplyEnabled = offers.data?.enabled === true;
  const [chartOpen, setChartOpen] = useChartOpen();

  useEffect(() => {
    if (!compareOpen || compareLoaded) return;
    let cancelled = false;
    void Promise.all(
      Object.entries(exchangeMeta).map(async ([key, meta]) => {
        try {
          const response = await fetch(
            `/api/stock-exchange?exchange=${encodeURIComponent(meta.exchangeApi)}`,
            { cache: "no-store" }
          );
          if (!response.ok) return null;
          const json = (await response.json()) as ExchangeData;
          const listings = json.listings ?? [];
          return [
            key,
            { listings: listings.length, marketCap: aggregateExchangeTotals(listings).marketCap },
          ] as const;
        } catch {
          return null;
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      setCompareData(
        Object.fromEntries(rows.filter((row): row is NonNullable<typeof row> => row !== null))
      );
      setCompareLoading(false);
      setCompareLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [compareOpen, compareLoaded, exchangeMeta]);

  const setTab = (next: MarketTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const setExchange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "global") params.delete("exchange");
    else params.set("exchange", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const exchangeApi =
    exchangeFilter === "global" ? "global" : (getExchangeApiKey(exchangeFilter) ?? "global");

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-heading-lg font-bold text-foreground">The Market</h1>
            <p className="text-sm text-muted">
              Stocks, bonds, funds, sectors, commodities, supply deals and currencies in one place.
            </p>
          </div>
          <MarketCorporationAction />
        </div>

        <section aria-label="Stock market chart">
          <div className="flex items-center justify-between">
            <h2 className="text-heading-sm font-bold text-foreground">Stock market</h2>
            <button
              type="button"
              aria-expanded={chartOpen}
              onClick={() => setChartOpen(!chartOpen)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-card-border px-2.5 text-xs font-medium text-foreground hover:bg-card-elevated"
            >
              {chartOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {chartOpen ? "Hide chart" : "Show chart"}
            </button>
          </div>
          <div className="mt-3 flex w-full min-w-0 flex-wrap items-start justify-end">
            <ExchangeSelector
              exchangeMeta={exchangeMeta}
              exchangeFilter={exchangeFilter}
              compareData={compareData}
              compareLoading={compareLoading}
              compareOpen={compareOpen}
              onToggleCompare={() => {
                if (!compareOpen && !compareLoaded) setCompareLoading(true);
                setCompareOpen(!compareOpen);
              }}
              onSelect={setExchange}
            />
          </div>
          {chartOpen && (
            <StockMarketChart exchangeFilter={exchangeFilter} refreshKey={null} currentTurn={0} />
          )}
        </section>

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div
            role="tablist"
            aria-label="Market sections"
            className="flex min-w-max gap-1 border-b border-card-border"
          >
            {MARKET_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" aria-label={MARKET_TABS.find((t) => t.key === tab)?.label}>
          {tab === "overview" && (
            <MarketOverview
              commodities={list}
              sectors={sectors.data}
              offers={offers.data}
              loading={commodities.loading || sectors.loading || offers.loading}
            />
          )}
          {tab === "stocks" && <StocksPanel exchange={exchangeApi} />}
          {tab === "bonds" && <BondsPanel />}
          {tab === "funds" && <FundsPanel />}
          {tab === "wealth" && <WealthPanel exchange={exchangeApi} />}
          {tab === "sectors" && <SectorsPanel />}
          {tab === "commodities" && (
            <CommoditiesPanel
              commodities={list}
              loading={commodities.loading}
              error={commodities.error}
              supplyEnabled={supplyEnabled}
            />
          )}
          {tab === "supply" && <SupplyDealsPanel />}
          {tab === "currencies" && <CurrenciesPanel />}
        </div>
      </main>
    </div>
  );
}
