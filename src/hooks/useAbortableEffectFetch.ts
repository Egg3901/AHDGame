"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Run a fetch on mount (and on dependency change) with an `AbortSignal` that is
 * aborted when the component unmounts or the effect re-runs.
 *
 * ## Why this exists
 *
 * The overwhelming majority of components in this app fetch inside a bare
 * `useEffect` with no abort handling. Two consequences, one visible and one
 * not:
 *
 *  - **In tests**, happy-dom tears the window down while those requests are
 *    still in flight, and every one of them rejects with
 *    `DOMException [AbortError]` during teardown. A full suite run emits
 *    between 68 and 333 of them. They have not failed a run so far, but they
 *    bury real errors in the log.
 *  - **In the browser**, the response lands after the component has gone,
 *    setting state on something nobody is looking at and burning a request
 *    the user navigated away from.
 *
 * `useBondHistory` already solved this properly for one hook, with a shared
 * in-flight controller in a ref. This is that pattern, generalised, so the next
 * component gets it in one line instead of re-deriving it.
 *
 * ## Using it
 *
 * ```ts
 * const reload = useAbortableEffectFetch(
 *   async (signal) => {
 *     const res = await fetch(`/api/thing/${id}`, { signal });
 *     if (!res.ok) return;
 *     setThing(await res.json());
 *   },
 *   [id]
 * );
 * ```
 *
 * The returned function re-runs the same load on demand (after a mutation, say)
 * and aborts whatever was already in flight, so a slow first response can never
 * overwrite a fast second one.
 *
 * `AbortError` is swallowed: an aborted request is the expected outcome of
 * unmounting, not a failure the caller should have to filter out of its own
 * error state. Every other rejection propagates to the callback's own handling.
 */
export function useAbortableEffectFetch(
  run: (signal: AbortSignal) => Promise<void>,
  deps: readonly unknown[]
): () => void {
  const inFlightRef = useRef<AbortController | null>(null);
  // The callback is captured in a ref so a caller can write it inline without
  // the effect re-running on every render.
  const runRef = useRef(run);
  runRef.current = run;

  const start = useCallback(() => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    void runRef.current(controller.signal).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    });
  }, []);

  useEffect(() => {
    start();
    return () => inFlightRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return start;
}
