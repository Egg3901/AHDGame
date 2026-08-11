"use client";

import { useState, useEffect, useCallback } from "react";
import { notificationToInboxItem, groupMailIntoThreads, mailThreadToInboxItem } from "@/lib/inbox";
import type { InboxItem, SerializedNotification, SerializedMail } from "@/lib/inbox";

export interface InboxCounts {
  all: number;
  notifs: number;
  mail: number;
  action: number;
}

export interface UseInboxDataResult {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  counts: InboxCounts;
}

export function useInboxData(): UseInboxDataResult {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [notifsRes, inboxRes, sentRes, authMeRes] = await Promise.all([
          fetch("/api/notifications?limit=100", { signal }),
          fetch("/api/mail?limit=50", { signal }),
          fetch("/api/mail/sent?limit=50", { signal }),
          fetch("/api/auth/me", { signal }),
        ]);

        if (signal.aborted) return;

        if (!notifsRes.ok || !inboxRes.ok || !sentRes.ok) {
          setError("Failed to load inbox data");
          setLoading(false);
          return;
        }

        const [notifsData, inboxData, sentData, authMeData] = await Promise.all([
          notifsRes.json() as Promise<{ notifications: SerializedNotification[] }>,
          inboxRes.json() as Promise<{ mails: SerializedMail[] }>,
          sentRes.json() as Promise<{ mails: SerializedMail[] }>,
          authMeRes.ok
            ? (authMeRes.json() as Promise<{ character?: { id: string } | null }>)
            : Promise.resolve(null),
        ]);

        if (signal.aborted) return;

        const now = Date.now();
        const selfCharacterId: string = authMeData?.character?.id ?? "";

        const notifItems = (notifsData.notifications ?? []).map((n) =>
          notificationToInboxItem(n, now)
        );

        const threads = groupMailIntoThreads(
          inboxData.mails ?? [],
          sentData.mails ?? [],
          selfCharacterId
        );
        const mailItems = threads.map((t) => mailThreadToInboxItem(t, now));

        // Merge and sort by recency — use the source ISO timestamps for comparison.
        // For notifs, source timestamp is createdAt; for mail threads, latestAt.
        // We attach the ISO string temporarily via a parallel array, then discard it.
        const notifWithTs = notifItems.map((item, i) => ({
          item,
          ts: notifsData.notifications[i]?.createdAt ?? "",
        }));
        const mailWithTs = mailItems.map((item, i) => ({
          item,
          ts: threads[i]?.latestAt ?? "",
        }));

        const merged = [...notifWithTs, ...mailWithTs].sort((a, b) => b.ts.localeCompare(a.ts));

        setItems(merged.map((x) => x.item));
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [tick]);

  const counts: InboxCounts = {
    all: items.filter((i) => i.unread).length,
    notifs: items.filter((i) => i.kind === "notif" && i.unread).length,
    mail: items.filter((i) => i.kind === "mail" && i.unread).length,
    action: items.filter((i) => i.action && i.unread).length,
  };

  return { items, loading, error, refetch, counts };
}
