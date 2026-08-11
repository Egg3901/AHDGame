"use client";

import { useEffect, useState } from "react";

export interface UseActionPreviewResult<T> {
  preview: T | null;
  loading: boolean;
}

/**
 * Generic pre-click preview fetcher for the PS-spend Org actions. The caller
 * builds `url` (e.g. `…/build-org/preview`) and bumps `refetchKey` after each
 * successful spend so the projection for the
 * NEXT click refreshes — this is the "updates with each click" behavior.
 *
 * Returns `preview` parsed as `T` (the route's discriminated `{ ok: true | false }`
 * union) and a `loading` flag. On network error `preview` is set to null and the
 * panel renders its own fallback.
 */
export function useActionPreview<T>(
  url: string | null,
  { enabled, refetchKey }: { enabled: boolean; refetchKey: number }
): UseActionPreviewResult<T> {
  const [preview, setPreview] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(url);
        const data = (await r.json()) as T;
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, enabled, refetchKey]);

  return { preview, loading };
}
