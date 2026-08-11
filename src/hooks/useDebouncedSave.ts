"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Debounced autosave of a whole slice, with the server's refusal surfaced.
 *
 * The military builders (commands, theaters, formations) persist by PUTting their
 * entire slice whenever it changes. That shape is self-healing for a single dropped
 * write — the next edit re-sends the current state — so the value here is not
 * rollback but VISIBILITY: a write that fails for a standing reason (the seat was
 * lost, the subsystem was disabled, the session expired) would otherwise discard
 * every later edit in silence, and the player would only discover it on reload.
 *
 * Skips the first run so seeding the state from the server does not immediately
 * write it back.
 *
 * @param url     endpoint to PUT to; a null/empty url disables saving (read-only viewer)
 * @param body    the slice to persist — re-serialized on every change
 * @param enabled false for viewers who may not write
 * @returns the last refusal reason, or null while saves are succeeding
 */
export function useDebouncedSave(
  url: string | null,
  body: unknown,
  enabled: boolean,
  fallbackMessage = "Your changes could not be saved."
): string | null {
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const serialized = JSON.stringify(body ?? null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled || !url) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: serialized,
          });
          if (!res.ok) {
            const payload = (await res.json().catch(() => null)) as { error?: string } | null;
            setError(payload?.error ?? fallbackMessage);
            return;
          }
          setError(null);
        } catch {
          setError(fallbackMessage);
        }
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [serialized, url, enabled, fallbackMessage]);

  return error;
}
