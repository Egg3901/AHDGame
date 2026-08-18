"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CommodityDetail } from "./types";
import type { MapMode } from "./components/CommodityMapModeToggle";
import HeroPanel from "./components/HeroPanel";
import DemandDriverBanner from "./components/DemandDriverBanner";
import SupplyDemandBar from "./components/SupplyDemandBar";
import FlowLedgerStrip from "./components/FlowLedgerStrip";
import CommodityChart from "./components/charts/CommodityChart";
import TopProducersConsumers from "./components/TopProducersConsumers";
import { getStateDisplayName, groupStatesByCountry } from "@/lib/commodity-map";
import { buildCommodityMarketScope } from "./lib/marketScope";

const CommodityWorldMapView = dynamic(() => import("./components/CommodityWorldMapView"), {
  ssr: false,
  loading: () => <Skeleton className="h-[520px] w-full rounded-xl" />,
});

const CommodityCountryDrilldownView = dynamic(
  () => import("./components/CommodityCountryDrilldownView"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[520px] w-full rounded-xl" />,
  }
);

const DislocationPanel = dynamic(() => import("./components/DislocationPanel"), {
  loading: () => null,
});
const RegionalBreakdown = dynamic(() => import("./components/RegionalBreakdown"), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full rounded-xl" />,
});

const ResourceAvailabilityPanel = dynamic(() => import("./components/ResourceAvailabilityPanel"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-xl" />,
});

const ProductionFlow = dynamic(() => import("./components/ProductionFlow"), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full rounded-xl" />,
});

interface CommodityDetailClientProps {
  initialData: CommodityDetail;
}

export default function CommodityDetailClient({ initialData }: CommodityDetailClientProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [mapMode, setMapMode] = useState<MapMode>("supply");
  const [drillDownCountry, setDrillDownCountry] = useState<CountryId | null>(null);
  const [drillDownState, setDrillDownState] = useState<string | null>(null);
  const [showAdvancedSections, setShowAdvancedSections] = useState(false);
  const [heavyLoaded, setHeavyLoaded] = useState(false);
  const [forexEnabled, setForexEnabled] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<Partial<Record<CurrencyCode, number>>>({});

  useEffect(() => {
    const id = window.setTimeout(() => setShowAdvancedSections(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(initialData);
    setHeavyLoaded(false);

    async function loadHeavyData() {
      try {
        const res = await fetch(`/api/commodities/${initialData.commodity}`);
        const json = (await res.json()) as CommodityDetail;
        if (!cancelled && res.ok) {
          setData(json);
        }
      } catch {
        // Keep the light payload if the background refresh fails.
      } finally {
        if (!cancelled) {
          setHeavyLoaded(true);
        }
      }
    }

    void loadHeavyData();

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  useEffect(() => {
    let cancelled = false;

    async function loadForex() {
      try {
        const statusRes = await fetch("/api/game/turn/status");
        const status = (await statusRes.json()) as { forexEnabled?: boolean };
        if (cancelled) return;

        const enabled = statusRes.ok && status.forexEnabled === true;
        setForexEnabled(enabled);
        if (!enabled) return;

        const ratesRes = await fetch("/api/forex/rates");
        if (!ratesRes.ok) return;
        const ratesJson = (await ratesRes.json()) as {
          rates?: Partial<Record<CurrencyCode, number>>;
        };
        if (!cancelled) {
          setExchangeRates(ratesJson.rates ?? {});
        }
      } catch {
        if (!cancelled) {
          setForexEnabled(false);
          setExchangeRates({});
        }
      }
    }

    void loadForex();

    return () => {
      cancelled = true;
    };
  }, []);

  const marketScope = useMemo(
    () => buildCommodityMarketScope(data, drillDownCountry, drillDownState),
    [data, drillDownCountry, drillDownState]
  );

  function handleSelectCountry(countryId: CountryId | null) {
    setDrillDownCountry(countryId);
    setDrillDownState(null);
  }

  const stateOptions = drillDownCountry
    ? (groupStatesByCountry(Object.keys(data.stateCountryMap ?? {}), data.stateCountryMap ?? {})[
        drillDownCountry
      ] ?? [])
    : [];

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          <Link
            href="/country/us/stockmarket?tab=commodities"
            className="hover:text-foreground transition-colors"
          >
            Commodities
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground font-medium">{data.label}</span>
        </nav>

        <HeroPanel
          data={data}
          marketScope={marketScope}
          activeCountry={marketScope.activeCountry}
          forexEnabled={forexEnabled}
          exchangeRates={exchangeRates}
          onSelectExchange={handleSelectCountry}
        />
        {drillDownCountry && stateOptions.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="commodity-state-select" className="text-xs font-semibold text-muted">
              State
            </label>
            <select
              id="commodity-state-select"
              value={drillDownState ?? ""}
              onChange={(event) => setDrillDownState(event.target.value || null)}
              className="rounded-lg border border-card-border bg-card px-3 py-1 text-xs font-bold text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Whole country</option>
              {stateOptions.map((stateId) => (
                <option key={stateId} value={stateId}>
                  {getStateDisplayName(drillDownCountry, stateId)}
                </option>
              ))}
            </select>
          </div>
        )}
        <DemandDriverBanner demandDriver={data.demandDriver} unit={data.unit} />
        <SupplyDemandBar
          supply={marketScope.supply}
          demand={marketScope.demand}
          unit={data.unit}
          marketLabel={marketScope.marketLabel}
        />
        {data.flows && <FlowLedgerStrip flows={data.flows} unit={data.unit} />}
        {data.capacityByState !== undefined && heavyLoaded && (
          <ResourceAvailabilityPanel
            unit={data.unit}
            capacityByState={marketScope.capacityByState ?? {}}
            totalCapacity={marketScope.totalCapacity ?? 0}
            currentSupply={marketScope.supply}
            capacityLabel={
              marketScope.activeCountry ? `${marketScope.marketLabel} Capacity` : "Global Capacity"
            }
            stateCountryMap={marketScope.stateCountryMap}
            stateNames={Object.fromEntries(
              Object.entries(marketScope.stateCountryMap).map(([id, countryId]) => [
                id,
                getStateDisplayName(countryId as CountryId, id),
              ])
            )}
          />
        )}
        <CommodityChart
          history={data.history}
          basePrice={data.basePrice}
          unit={data.unit}
          scopeLabel={marketScope.activeCountry ? "Global history" : marketScope.marketLabel}
        />

        {heavyLoaded && showAdvancedSections && (
          <div className="mb-6">
            {drillDownCountry ? (
              <CommodityCountryDrilldownView
                countryId={drillDownCountry}
                commodityLabel={data.label}
                unit={data.unit}
                basePrice={data.basePrice}
                mode={mapMode}
                onModeChange={setMapMode}
                stateSupply={marketScope.stateSupply}
                stateDemand={marketScope.stateDemand}
                statePrices={marketScope.statePrices}
                stateCountryMap={marketScope.stateCountryMap}
                capacityByState={marketScope.capacityByState}
                forexEnabled={forexEnabled}
                exchangeRates={exchangeRates}
                onBack={() => handleSelectCountry(null)}
              />
            ) : (
              <CommodityWorldMapView
                commodityLabel={data.label}
                unit={data.unit}
                basePrice={data.basePrice}
                globalPrice={data.globalPrice}
                forexEnabled={forexEnabled}
                exchangeRates={exchangeRates}
                stateSupply={marketScope.stateSupply}
                stateDemand={marketScope.stateDemand}
                statePrices={marketScope.statePrices}
                nationalSupply={data.nationalSupply}
                nationalDemand={data.nationalDemand}
                reachableBooks={data.reachableBooks}
                stateCountryMap={marketScope.stateCountryMap}
                capacityByState={marketScope.capacityByState}
                mode={mapMode}
                onModeChange={setMapMode}
                onDrillDown={(countryId) => handleSelectCountry(countryId)}
                onViewCountryPage={(countryId) => {
                  const config = COUNTRY_CONFIGS[countryId];
                  if (config) router.push(config.overviewPath);
                }}
              />
            )}
          </div>
        )}
        {(!heavyLoaded || !showAdvancedSections) && (
          <div className="mb-6">
            <Skeleton className="h-[520px] w-full rounded-xl" />
          </div>
        )}

        <a
          href="/world/trade"
          className="mb-6 flex items-center justify-between rounded-xl border border-card-border bg-card px-4 py-3 transition-colors hover:border-foreground/30"
        >
          <span className="text-[12.5px] font-semibold text-foreground">
            World Trade Ledger
            <span className="ml-2 font-normal text-muted">
              cross-border balance of trade by nation
            </span>
          </span>
          <span className="text-[11px] text-primary">&rarr;</span>
        </a>

        <TopProducersConsumers
          topProducers={marketScope.topProducers}
          topConsumers={marketScope.topConsumers}
          syntheticDemandSources={marketScope.syntheticDemandSources}
          unit={data.unit}
          commodity={data.commodity}
          consumerNote={data.demandDriver?.consumerNote}
          marketLabel={marketScope.marketLabel}
        />

        {heavyLoaded && (
          <DislocationPanel
            statePrices={marketScope.statePrices}
            stateSupply={marketScope.stateSupply}
            stateDemand={marketScope.stateDemand}
            stateCountryMap={marketScope.stateCountryMap}
            basePrice={data.basePrice}
            capacityByState={marketScope.capacityByState}
            unit={data.unit}
          />
        )}

        {heavyLoaded && showAdvancedSections ? (
          <RegionalBreakdown
            stateSupply={marketScope.stateSupply}
            stateDemand={marketScope.stateDemand}
            statePrices={marketScope.statePrices}
            stateCountryMap={marketScope.stateCountryMap}
            globalPrice={data.globalPrice}
            forexEnabled={forexEnabled}
            exchangeRates={exchangeRates}
            unit={data.unit}
          />
        ) : (
          <Skeleton className="mb-6 h-[320px] w-full rounded-xl" />
        )}

        {heavyLoaded && showAdvancedSections ? (
          <ProductionFlow suppliers={data.suppliers} consumers={data.consumers} />
        ) : (
          <Skeleton className="mb-6 h-[220px] w-full rounded-xl" />
        )}
      </main>
    </div>
  );
}
