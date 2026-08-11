"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { WireItem } from "@/lib/news/types";
import { useTickerDecel } from "@/hooks/useTickerDecel";
import { fetchJson } from "@/lib/observability/fetchJson";

const TYPE_COLORS: Record<WireItem["type"], string> = {
  corporation_founded: "text-primary",
  corporation_relocated: "text-sky-400",
  corporation_dissolved: "text-error",
  bond_issued: "text-amber-400",
  corp_credit_rating: "text-warning",
  dividend_changed: "text-success",
  system_news: "text-foreground",
  pvp_action: "text-error",
};

function Separator() {
  return <span className="text-muted/30 mx-3 shrink-0">◆</span>;
}

function WireTickerEntry({ item, interactive }: { item: WireItem; interactive: boolean }) {
  const className = `${interactive ? "hover:opacity-80 transition-opacity" : ""} font-medium`;
  const colorClass = interactive ? TYPE_COLORS[item.type] : "text-muted";

  if (interactive && item.href) {
    return (
      <Link href={item.href} className={`${colorClass} ${className} shrink-0`}>
        {item.headline}
      </Link>
    );
  }

  return <span className={`${colorClass} ${className}`}>{item.headline}</span>;
}

const PLACEHOLDER_ITEMS: WireItem[] = [
  { id: "ph-1", type: "system_news", headline: "Awaiting wire reports...", timestamp: "" },
  { id: "ph-2", type: "system_news", headline: "No recent activity", timestamp: "" },
  { id: "ph-3", type: "system_news", headline: "Awaiting wire reports...", timestamp: "" },
  { id: "ph-4", type: "system_news", headline: "No recent activity", timestamp: "" },
];

export function WireTicker() {
  const [items, setItems] = useState<WireItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchJson<{ items?: WireItem[] } | null>("/api/news/wire", {
      feature: "wire-ticker",
    })
      .then((data) => {
        if (data?.items) setItems(data.items);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const displayItems = items.length > 0 ? items : PLACEHOLDER_ITEMS;
  const duration = items.length > 0 ? Math.max(items.length * 16, 160) : 120;

  // Opposite direction from stock ticker (scrolls right)
  const scrollRef = useTickerDecel(duration, -1);

  const renderItems = () => (
    <div className="flex items-center shrink-0">
      <span className="text-primary font-semibold uppercase tracking-wider mx-3 shrink-0">
        WIRE
      </span>
      {displayItems.map((item, i) => (
        <span key={`${item.id}-${i}`} className="inline-flex items-center shrink-0">
          {i > 0 && <Separator />}
          <WireTickerEntry item={item} interactive={items.length > 0} />
        </span>
      ))}
      <Separator />
    </div>
  );

  return (
    <div
      className={`min-w-0 overflow-hidden border-b border-card-border bg-card-muted/50 transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
    >
      <div
        ref={scrollRef}
        className="inline-flex whitespace-nowrap py-1.5 font-mono text-[11px]"
        style={{ willChange: "transform" }}
      >
        {renderItems()}
        {renderItems()}
      </div>
    </div>
  );
}
