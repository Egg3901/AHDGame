"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { SectionLabel } from "@/components/ui";
import type { ProfileBorderKey } from "@/lib/db/types";
import { fetchJson } from "@/lib/observability/fetchJson";

interface LeaderboardEntry {
  characterId: string;
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  subscriberCount: number;
  totalLikes: number;
  borderKey?: ProfileBorderKey | null;
  tintColor?: string | null;
}

const INITIAL_SHOW = 10;

function MiniList({
  title,
  entries,
  sortBy,
  loading,
}: {
  title: string;
  entries: LeaderboardEntry[];
  sortBy: "likes" | "subscribers";
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...entries].sort((a, b) =>
    sortBy === "likes"
      ? b.totalLikes - a.totalLikes || b.subscriberCount - a.subscriberCount
      : b.subscriberCount - a.subscriberCount || b.totalLikes - a.totalLikes
  );
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_SHOW);
  const hasMore = sorted.length > INITIAL_SHOW;

  if (loading) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted">{title}</h4>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 animate-pulse">
            <div className="h-6 w-6 rounded-lg bg-card-border shrink-0" />
            <div className="h-3 flex-1 rounded bg-card-border" />
          </div>
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold text-muted mb-2">{title}</h4>
        <p className="text-[10px] text-muted">No data yet</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted mb-2">{title}</h4>
      <div className="space-y-2">
        {visible.map((e, i) => (
          <div key={e.characterId} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-[10px] font-medium text-muted">{i + 1}</span>
            <Avatar
              url={e.avatarUrl}
              name={e.characterName}
              size="h-6 w-6"
              borderKey={e.borderKey}
              tintColor={e.tintColor}
            />
            <Link
              href={`/character/${e.sequentialId ?? e.characterId}`}
              className="flex-1 min-w-0 text-xs font-medium text-foreground hover:text-primary transition-colors truncate"
            >
              {e.characterName}
            </Link>
            <span className="shrink-0 text-[10px] text-muted">
              {sortBy === "likes"
                ? `${e.totalLikes} like${e.totalLikes !== 1 ? "s" : ""}`
                : `${e.subscriberCount} sub${e.subscriberCount !== 1 ? "s" : ""}`}
            </span>
          </div>
        ))}
      </div>
      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View more
        </button>
      )}
    </div>
  );
}

export function NewsWhoToWatch() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ entries?: LeaderboardEntry[] } | null>("/api/news/leaderboard", {
      feature: "news-who-to-watch",
    })
      .then((data) => {
        if (data?.entries) setEntries(data.entries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-6">
      <SectionLabel as="h3">Top Posters</SectionLabel>
      <MiniList title="By Total Likes" entries={entries} sortBy="likes" loading={loading} />
      <MiniList title="By Subscribers" entries={entries} sortBy="subscribers" loading={loading} />
    </div>
  );
}
