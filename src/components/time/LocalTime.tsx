"use client";

import { useEffect, useState } from "react";
import { formatRelative, formatStableUtc, type TimeValue } from "@/lib/time/localTime";

function toIso(value: TimeValue): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

interface LocalTimeProps {
  value: TimeValue;
  /** Intl options for the displayed string. Defaults to a medium date + short time. */
  options?: Intl.DateTimeFormatOptions;
  className?: string;
}

/**
 * Render a timestamp in the user's local timezone without a hydration mismatch.
 *
 * SSR and the first client render both emit the deterministic UTC string (`formatStableUtc`),
 * so the server output and the first client render are identical (no #418). After mount, the
 * component swaps to the user's local representation.
 */
export function LocalTime({ value, options, className }: LocalTimeProps) {
  const [mounted, setMounted] = useState(false);
  // Detect mount to switch from the deterministic SSR string to the user's local time. Setting
  // state in this effect is the intended two-pass hydration pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const text = mounted
    ? new Date(value instanceof Date ? value : new Date(value)).toLocaleString("en-US", options)
    : formatStableUtc(value, options);

  return (
    <time dateTime={toIso(value)} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}

interface RelativeTimeProps {
  value: TimeValue;
  className?: string;
}

/**
 * Render a relative timestamp ("5m ago") that updates over time, without a hydration mismatch.
 *
 * SSR and the first client render emit the deterministic absolute UTC string; after mount the
 * component shows the relative phrase and refreshes it once a minute.
 */
export function RelativeTime({ value, className }: RelativeTimeProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Read the clock only after mount (then once a minute) so SSR stays deterministic. Setting
  // state in this effect is the intended pattern for syncing to an external system (the clock).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const text = nowMs === null ? formatStableUtc(value) : formatRelative(value, nowMs);

  return (
    <time dateTime={toIso(value)} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
