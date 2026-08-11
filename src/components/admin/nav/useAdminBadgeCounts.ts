"use client";

import { useEffect, useState } from "react";
import type { MainTabId } from "@/components/admin/tabs/AdminTabsConfig";

export type TabCounts = Partial<Record<MainTabId, number>>;

/** Per-queue pending counts behind the tab badges. Fetched once and shared so
 * the sidebar badges, status-bar total, and dashboard queue rail agree. */
export interface QueueCounts {
  suggestions?: number;
  mailReports?: number;
  wikiReview?: number;
  suspicious?: number;
  feedback?: number;
}

export interface AdminBadgeCounts {
  /** Main-tab badges derived from the queues. */
  tabs: TabCounts;
  queues: QueueCounts;
  /** Sum of all known queue counts (status-bar "Pending" chip). */
  pendingTotal: number;
}

/** Queue → deep-link metadata used by the dashboard rail and pinned entries. */
export const QUEUE_DESTINATIONS: {
  key: keyof QueueCounts;
  label: string;
  tab: MainTabId;
  sub: string;
  dotClass: string;
}[] = [
  {
    key: "suggestions",
    label: "Suggestions",
    tab: "support",
    sub: "suggestions",
    dotClass: "bg-secondary",
  },
  {
    key: "mailReports",
    label: "Mail reports",
    tab: "support",
    sub: "mail-reports",
    dotClass: "bg-error",
  },
  {
    key: "wikiReview",
    label: "Wiki review",
    tab: "content",
    sub: "wiki-review",
    dotClass: "bg-info",
  },
  {
    key: "suspicious",
    label: "Suspicious activity",
    tab: "players",
    sub: "suspicious",
    dotClass: "bg-warning",
  },
  {
    key: "feedback",
    label: "Feedback (legacy)",
    tab: "support",
    sub: "feedback",
    dotClass: "bg-muted",
  },
];

/** `"tab/sub"` → queue key, for badge lookups on pinned destinations. */
export const QUEUE_TAB_SUBS: Record<string, keyof QueueCounts> = Object.fromEntries(
  QUEUE_DESTINATIONS.map((q) => [`${q.tab}/${q.sub}`, q.key])
);

function deriveTabs(queues: QueueCounts): TabCounts {
  const tabs: TabCounts = {};
  const support = (queues.mailReports ?? 0) + (queues.suggestions ?? 0);
  if (support > 0) tabs.support = support;
  if ((queues.wikiReview ?? 0) > 0) tabs.content = queues.wikiReview;
  if ((queues.suspicious ?? 0) > 0) tabs.players = queues.suspicious;
  return tabs;
}

/** Pulls live counts for the queues whose backend already exposes a count.
 * Each fetch is independent so a slow/failing endpoint never blocks the others.
 * Called once in AdminTabs and passed down so every consumer shares a single
 * set of requests. */
export function useAdminBadgeCounts(): AdminBadgeCounts {
  const [queues, setQueues] = useState<QueueCounts>({});

  useEffect(() => {
    let cancelled = false;
    const update = (patch: QueueCounts) => {
      if (cancelled) return;
      setQueues((prev) => ({ ...prev, ...patch }));
    };
    const quietly = (label: string) => (err: unknown) => {
      // Badges are decorative — degrade silently but keep the error observable.
      console.debug(`admin ${label} badge fetch failed`, err);
    };

    fetch("/api/admin/suggestions/counts", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const open = data?.counts?.not_reviewed;
        if (typeof open === "number") update({ suggestions: open });
      })
      .catch(quietly("suggestions"));

    fetch("/api/admin/mail-reports?status=pending&limit=1", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.total === "number") update({ mailReports: data.total });
      })
      .catch(quietly("mail-reports"));

    fetch("/api/admin/wiki/review-queue", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.pending)) update({ wikiReview: data.pending.length });
      })
      .catch(quietly("wiki-review"));

    fetch("/api/admin/suspicious?severity=high&limit=1", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const high = data?.counts?.high;
        if (typeof high === "number") update({ suspicious: high });
      })
      .catch(quietly("suspicious"));

    fetch("/api/admin/feedback?status=open&limit=1", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.total === "number") update({ feedback: data.total });
      })
      .catch(quietly("feedback"));

    return () => {
      cancelled = true;
    };
  }, []);

  const pendingTotal = Object.values(queues).reduce((sum, n) => sum + (n ?? 0), 0);
  return { tabs: deriveTabs(queues), queues, pendingTotal };
}

export function formatBadge(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toString();
}
