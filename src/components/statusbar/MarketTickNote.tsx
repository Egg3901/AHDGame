"use client";

import { useEffect, useState } from "react";

const QUARTER_MS = 15 * 60_000;

/** Minutes since `lastMs`, or null before the first market update. */
export function minutesSince(lastMs: number | null, nowMs: number): number | null {
  if (lastMs === null || !Number.isFinite(lastMs)) return null;
  return Math.max(0, Math.floor((nowMs - lastMs) / 60_000));
}

/** Start of the next quarter-hour slot after `nowMs`. */
export function nextQuarterAt(nowMs: number): number {
  return (Math.floor(nowMs / QUARTER_MS) + 1) * QUARTER_MS;
}

/**
 * Status bar note: when stock prices last updated. Prices re-price every 15
 * minutes (the turn at :00, market ticks at :15/:30/:45). Both paths publish
 * a wall-clock completion marker; lastTurnProcessed belongs to the game clock.
 */
export function MarketTickNote({ lastMarketTickAt }: { lastMarketTickAt?: string | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Clock read after mount and every 30 s keeps SSR deterministic.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const parsed = lastMarketTickAt ? new Date(lastMarketTickAt).getTime() : Number.NaN;
  const lastMs = Number.isFinite(parsed) ? parsed : null;
  if (nowMs === null || lastMs === null) return null;
  const minutes = minutesSince(lastMs, nowMs) ?? 0;
  const ago = minutes < 1 ? "just now" : `${minutes}m ago`;
  const nextIn = Math.max(1, Math.ceil((nextQuarterAt(nowMs) - nowMs) / 60_000));
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted sm:text-xs"
      title={`Stock prices update every 15 minutes. Next update in ${nextIn} min.`}
    >
      <svg
        className="h-3 w-3 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
      </svg>
      <span className="hidden sm:inline">Markets {ago}</span>
      <span className="sm:hidden tabular-nums">{minutes < 1 ? "now" : `${minutes}m`}</span>
    </span>
  );
}
