"use client";

import { useEffect, useState } from "react";
import { TurnStatusLink } from "./TurnStatusLink";

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

/** Past this, the quarter-hour ticks are not landing and a countdown would mislead. */
const STALE_AFTER_MINUTES = 20;

/** Whole minutes until the next quarter-hour price refresh, at least 1. */
export function minutesUntilNextRefresh(nowMs: number): number {
  return Math.max(1, Math.ceil((nextQuarterAt(nowMs) - nowMs) / 60_000));
}

/**
 * Status bar note for the price refresh, which is separate from the turn:
 * stock prices refresh every 15 minutes (the turn at :00, market ticks at
 * :15/:30/:45). Counts down like the turn timer beside it. If no refresh has
 * landed for a while it says how old prices are instead. Both paths publish a
 * wall-clock marker; lastTurnProcessed belongs to the game clock.
 */
export function MarketTickNote({
  lastMarketTickAt,
  statusLink = false,
}: {
  lastMarketTickAt?: string | null;
  statusLink?: boolean;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Clock read after mount and every 15 s keeps SSR deterministic.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const parsed = lastMarketTickAt ? new Date(lastMarketTickAt).getTime() : Number.NaN;
  const lastMs = Number.isFinite(parsed) ? parsed : null;
  if (nowMs === null || lastMs === null) return null;
  const ago = minutesSince(lastMs, nowMs) ?? 0;
  const agoText = ago < 1 ? "just now" : `${ago} min ago`;
  const nextIn = minutesUntilNextRefresh(nowMs);
  const stale = ago > STALE_AFTER_MINUTES;
  return (
    <TurnStatusLink
      enabled={statusLink}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted sm:text-xs"
    >
      <span
        className="inline-flex items-center gap-1"
        title={`Stock prices refresh every 15 minutes, between turns too. Last refresh ${agoText}.`}
      >
        <svg
          className="h-3 w-3 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 17l6-6 4 4 8-8"
          />
        </svg>
        {stale ? (
          <>
            <span className="hidden sm:inline">Prices {ago}m old</span>
            <span className="sm:hidden tabular-nums">{ago}m old</span>
          </>
        ) : (
          <>
            <span className="hidden sm:inline">
              Prices refresh in <span className="tabular-nums">{nextIn}m</span>
            </span>
            <span className="sm:hidden tabular-nums">{nextIn}m</span>
          </>
        )}
      </span>
    </TurnStatusLink>
  );
}
