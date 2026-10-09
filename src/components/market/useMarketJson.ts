"use client";

import { useCallback, useEffect, useState } from "react";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

interface Settled<T> {
  url: string;
  data: T | null;
  error: string;
}

/**
 * GET a JSON endpoint once per url. Pass null to stay idle (inactive tabs), so
 * nothing loads until its tab is shown. Results are kept for a minute so
 * moving between tabs does not refetch.
 */
export function useMarketJson<T>(url: string | null) {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    if (url) cache.delete(url);
    setRevision((n) => n + 1);
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL_MS) {
      void Promise.resolve().then(() => setSettled({ url, data: hit.data as T, error: "" }));
      return;
    }
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setSettled({ url, data: null, error: "Could not load this section." });
          return;
        }
        cache.set(url, { at: Date.now(), data: body });
        setSettled({ url, data: body as T, error: "" });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSettled({ url, data: null, error: "Could not load this section." });
        }
      });
    return () => controller.abort();
  }, [url, revision]);

  const current = settled && settled.url === url ? settled : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? "",
    loading: url !== null && current === null,
    reload,
  };
}

/** Test hook: drop cached responses between cases. */
export function clearMarketJsonCache() {
  cache.clear();
}
