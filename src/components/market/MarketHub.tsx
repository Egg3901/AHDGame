"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CommodityData, MarketCapPoint } from "@/app/country/[code]/stockmarket/types";
import { MARKET_TABS, parseMarketTab, type MarketTab } from "@/lib/market/hubTabs";
import { CommoditiesPanel, vsBasePct } from "./CommoditiesPanel";
import { MarketOverview } from "./MarketOverview";
import {
  BondsPanel,
  CurrenciesPanel,
  FundsPanel,
  SectorsPanel,
  StocksPanel,
  sectorsUrl,
  type SectorsForSaleResponse,
} from "./MarketPanels";
import { SupplyDealsPanel, type SupplyOffersResponse } from "./SupplyDealsPanel";
import { StatTile, pctText, toneClass } from "./marketUi";
import { useMarketJson } from "./useMarketJson";

interface HistoryResponse {
  points?: MarketCapPoint[];
}

export function MarketHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseMarketTab(searchParams.get("tab"));

  // Headline data: four small reads, in parallel, shared with the overview and
  // the commodities, sectors and supply tabs through the response cache.
  const history = useMarketJson<HistoryResponse>(
    "/api/stock-exchange/market-cap-history?exchange=global&limit=2"
  );
  const commodities = useMarketJson<{ commodities?: CommodityData[] }>("/api/commodities");
  const sectors = useMarketJson<SectorsForSaleResponse>(sectorsUrl(1));
  const offers = useMarketJson<SupplyOffersResponse>("/api/supply-offers?page=1&pageSize=20");

  const points = history.data?.points ?? [];
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : undefined;
  const indexChange =
    last && prev && prev.marketCap > 0 ? (last.marketCap / prev.marketCap - 1) * 100 : null;
  const list = commodities.data?.commodities ?? null;
  const above = (list ?? []).filter((c) => (vsBasePct(c) ?? 0) > 0.5).length;
  const below = (list ?? []).filter((c) => (vsBasePct(c) ?? 0) < -0.5).length;
  const supplyEnabled = offers.data?.enabled === true;

  const setTab = (next: MarketTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-heading-lg font-bold text-foreground">The Market</h1>
          <p className="text-sm text-muted">
            Stocks, bonds, funds, sectors, commodities, supply deals and currencies in one place.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Market index"
            value={last ? Math.round(last.marketCap).toLocaleString() : "n/a"}
            sub={indexChange == null ? undefined : `${pctText(indexChange, 2)} last turn`}
            href="/market?tab=stocks"
          />
          <StatTile
            label="Sectors for sale"
            value={String(sectors.data?.counts.forSale ?? sectors.data?.totalItems ?? 0)}
            sub="Open one to buy"
            href="/market?tab=sectors"
          />
          <StatTile
            label="Open supply offers"
            value={supplyEnabled ? (offers.data?.total ?? 0).toLocaleString() : "Off"}
            sub={supplyEnabled ? "Across all commodities" : "Not enabled in this world"}
            href="/market?tab=supply"
          />
          <div className="rounded-xl border border-card-border bg-card px-4 py-3 shadow-card">
            <span className="text-body-sm font-medium text-muted">Commodities vs base</span>
            <span className="mt-1 flex items-baseline gap-3 text-xl font-bold tabular-nums">
              <span className={toneClass(1)}>{above} above</span>
              <span className={toneClass(-1)}>{below} below</span>
            </span>
            <Link
              href="/market?tab=commodities"
              className="mt-0.5 block text-[11px] text-primary hover:underline"
            >
              See prices
            </Link>
          </div>
        </div>

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
          {tab === "stocks" && <StocksPanel />}
          {tab === "bonds" && <BondsPanel />}
          {tab === "funds" && <FundsPanel />}
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
