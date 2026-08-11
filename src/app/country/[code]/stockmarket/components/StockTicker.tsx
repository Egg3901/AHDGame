"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useTickerDecel } from "@/hooks/useTickerDecel";
import type { StockListing, CommodityData } from "../types";

const mobileQuery = "(max-width: 640px)";
function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(mobileQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getIsMobile() {
  return window.matchMedia(mobileQuery).matches;
}
function getIsMobileServer() {
  return false;
}

interface TickerItem {
  type: "corp" | "commodity" | "fund";
  id: string;
  name: string;
  price: number;
  priceChange24h: number;
  link: string;
  isSubsidiary?: boolean;
}

function TickerEntry({ item }: { item: TickerItem }) {
  const { formatPrice } = useCurrency();
  const changeColor =
    item.priceChange24h > 0
      ? "text-success"
      : item.priceChange24h < 0
        ? "text-error"
        : "text-muted";
  const arrow = item.priceChange24h > 0 ? "▲" : item.priceChange24h < 0 ? "▼" : "";

  return (
    <Link
      href={item.link}
      className="inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0"
    >
      <span className="text-foreground font-medium">{item.name}</span>
      {item.isSubsidiary ? (
        <span className="rounded border border-muted/40 bg-muted/25 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted shrink-0">
          Sub
        </span>
      ) : null}
      <span className="font-bold text-foreground tabular-nums">{formatPrice(item.price)}</span>
      <span className={`${changeColor} tabular-nums`}>
        {arrow}
        {item.priceChange24h > 0 ? "+" : ""}
        {item.priceChange24h.toFixed(1)}%
      </span>
    </Link>
  );
}

function Separator() {
  return <span className="text-muted/30 mx-2 shrink-0">│</span>;
}

export interface FundTickerInput {
  id: string;
  slug: string;
  tickerSymbol: string;
  name: string;
  quotedNav: number;
  navChange24: number | null;
  countryCode: string;
}

export function StockTicker({
  listings,
  commodities,
  funds = [],
}: {
  listings: StockListing[];
  commodities: CommodityData[];
  funds?: FundTickerInput[];
}) {
  const { corpItems, commodityItems, fundItems } = useMemo(() => {
    const corps: TickerItem[] = listings.map((s) => ({
      type: "corp" as const,
      id: s._id,
      // Ticker symbol is the canonical scroll-bar label for a corp; legacy
      // corps without one fall back to the full company name.
      name: s.tickerSymbol ?? s.name,
      price: s.sharePrice,
      priceChange24h: s.priceChange24h ?? 0,
      link: `/corporation/${s.sequentialId ?? s._id}`,
      isSubsidiary: s.isSubsidiary === true,
    }));
    const cmdty: TickerItem[] = commodities.map((c) => ({
      type: "commodity" as const,
      id: c.commodity,
      name: c.label,
      price: c.globalPrice,
      priceChange24h: c.annualPriceChange ?? c.priceChange ?? 0,
      link: `/commodity/${c.commodity}`,
    }));

    // Sort: gainers → losers → flat
    const sort = (items: TickerItem[]) =>
      [...items].sort((a, b) => {
        const aAbs = Math.abs(a.priceChange24h);
        const bAbs = Math.abs(b.priceChange24h);
        if (a.priceChange24h > 0 && b.priceChange24h <= 0) return -1;
        if (a.priceChange24h <= 0 && b.priceChange24h > 0) return 1;
        if (a.priceChange24h < 0 && b.priceChange24h >= 0) return 1;
        if (a.priceChange24h >= 0 && b.priceChange24h < 0) return -1;
        return bAbs - aAbs;
      });

    // Cap corporations to the top 50 movers to bound the compositor layer width.
    // A global snapshot can have 160+ listings; rendering all of them twice in a
    // willChange:transform div creates a ~65 000px-wide GPU texture that exhausts
    // RAM on mid-range machines.
    const fundItems: TickerItem[] = funds.map((f) => ({
      type: "fund" as const,
      id: f.id,
      name: f.tickerSymbol,
      price: f.quotedNav,
      priceChange24h: f.navChange24 ?? 0,
      link: `/country/${f.countryCode.toLowerCase()}/stockmarket/fund/${f.slug}`,
    }));
    return {
      corpItems: sort(corps).slice(0, 50),
      commodityItems: sort(cmdty),
      fundItems: sort(fundItems).slice(0, 20),
    };
  }, [listings, commodities, funds]);

  const hasItems = corpItems.length > 0 || commodityItems.length > 0 || fundItems.length > 0;
  const totalItems = corpItems.length + commodityItems.length + fundItems.length;

  // Detect mobile for slightly faster ticker vs desktop (same ratio as desktop tuning)
  const isMobile = useSyncExternalStore(subscribeMobile, getIsMobile, getIsMobileServer);

  // Cruise duration (seconds per loop) and initial burst rate — kept ~½ linear speed vs older defaults
  const duration = isMobile ? Math.max(totalItems * 6, 60) : Math.max(totalItems * 12, 120);
  const initialRate = isMobile ? 5 : 3;
  const decelMs = isMobile ? 4000 : 7000;

  const scrollRef = useTickerDecel(duration, 1, initialRate, decelMs);

  if (!hasItems) return null;

  // Render the full set of ticker items once
  const renderItems = () => (
    <div className="flex items-center shrink-0">
      {corpItems.length > 0 && (
        <>
          <span className="text-muted font-semibold uppercase tracking-wider mx-3 shrink-0">
            MARKET
          </span>
          {corpItems.map((item, i) => (
            <span key={`corp-${item.id}`} className="inline-flex items-center shrink-0">
              {i > 0 && <Separator />}
              <TickerEntry item={item} />
            </span>
          ))}
        </>
      )}

      {fundItems.length > 0 && (
        <>
          <span className="text-muted font-semibold uppercase tracking-wider mx-3 shrink-0">
            FUNDS
          </span>
          {fundItems.map((item, i) => (
            <span key={`fund-${item.id}`} className="inline-flex items-center shrink-0">
              {i > 0 && <Separator />}
              <TickerEntry item={item} />
            </span>
          ))}
        </>
      )}
      {commodityItems.length > 0 && (
        <>
          {corpItems.length > 0 && <Separator />}
          <span className="text-muted font-semibold uppercase tracking-wider mx-3 shrink-0">
            COMMODITIES
          </span>
          {commodityItems.map((item, i) => (
            <span key={`cmdty-${item.id}`} className="inline-flex items-center shrink-0">
              {i > 0 && <Separator />}
              <TickerEntry item={item} />
            </span>
          ))}
        </>
      )}
      <Separator />
    </div>
  );

  return (
    <div className="min-w-0 overflow-hidden border-b border-card-border bg-card sticky top-0 z-40">
      <div
        ref={scrollRef}
        className="inline-flex whitespace-nowrap py-1.5 font-mono text-xs"
        style={{ willChange: "transform" }}
      >
        {renderItems()}
        {renderItems()}
      </div>
    </div>
  );
}
