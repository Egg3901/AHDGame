"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

/**
 * Recent activity feed - a single chronological view of treasury and slate
 * events for this party. Each row carries a small type pill pointing at
 * the tab that hosts the relevant detail.
 */

interface FeedItem {
  id: string;
  type: "treasury" | "slate";
  createdAt: string;
  summary: string;
  detail?: string;
  link?: { tab: string };
}

interface FeedResponse {
  items: FeedItem[];
  nextBefore: string | null;
}

const TYPE_LABEL: Record<FeedItem["type"], string> = {
  treasury: "Treasury",
  slate: "Slate",
};

const TYPE_TONE: Record<FeedItem["type"], string> = {
  treasury: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  slate: "border-primary/40 bg-primary/15 text-primary",
};

interface Props {
  countryCode: string;
  partyId: string;
}

export function RecentActivityCard({ countryCode, partyId }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/country/${countryCode}/parties/${partyId}/activity-feed?limit=20`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed to load feed (${res.status})`);
        }
        const json = (await res.json()) as FeedResponse;
        if (!cancelled) setItems(json.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load feed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode, partyId]);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Recent activity</h3>
        <p className="mt-0.5 text-[11px] text-muted">
          Latest treasury and slate events for this party.
        </p>
      </div>

      {loading && (
        <div className="min-h-[9rem] divide-y divide-card-border/40">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-5 w-14 rounded-full shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-2.5 w-12 shrink-0" />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-muted">No activity in the last few turns.</p>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-card-border/40">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2 text-xs">
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TYPE_TONE[item.type]}`}
              >
                {TYPE_LABEL[item.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate">{item.summary}</p>
                {item.detail && <p className="text-[10px] text-muted/80 truncate">{item.detail}</p>}
              </div>
              <LocalTime
                value={item.createdAt}
                options={{ dateStyle: "medium" }}
                className="shrink-0 text-[10px] text-muted"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
