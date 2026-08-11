import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-safe persisted numbers backing the Cold War pages' shared/local state
 * (DEFCON, bloc cohesion). The mockups stash these in localStorage so every
 * screen reflects them; this reads via `useSyncExternalStore` (server snapshot =
 * fallback, no hydration mismatch) and stays reactive to same-tab writes via a
 * custom event (plus cross-tab `storage`).
 */

const EVT = "cw-persist";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

function clamp(n: number, min?: number, max?: number): number {
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

function read(key: string, fallback: number, min?: number, max?: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? "", 10);
    if (!Number.isNaN(v)) return clamp(v, min, max);
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return fallback;
}

export function writePersistedNumber(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
    window.dispatchEvent(new Event(EVT));
  } catch {
    // localStorage unavailable — no-op.
  }
}

/** `[value, setValue]` for a persisted, reactive, clamped integer. */
export function usePersistedNumber(
  key: string,
  fallback: number,
  min?: number,
  max?: number
): [number, (v: number) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback, min, max),
    () => fallback
  );
  const set = useCallback(
    (v: number) => writePersistedNumber(key, clamp(Math.round(v), min, max)),
    [key, min, max]
  );
  return [value, set];
}
