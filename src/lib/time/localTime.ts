/**
 * Deterministic time formatting for SSR-safe hydration.
 *
 * `"use client"` components are server-rendered (UTC, render-time "now") then hydrated on the
 * client (user timezone, hydration-time "now"). Formatting a timestamp with a locale/timezone-
 * dependent call there produces different text on each side -> React hydration error #418.
 *
 * `formatStableUtc` pins both locale and timezone, so it returns the same string on the server
 * and the client. It is the SSR / first-client-render pass for `<LocalTime>` / `<RelativeTime>`,
 * which then swap to the user's local representation after mount.
 */

export type TimeValue = string | number | Date;

const STABLE_LOCALE = "en-US";

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

/**
 * Format an instant deterministically: fixed `en-US` locale, fixed UTC timezone. Identical on
 * server and client regardless of host locale/timezone, which is what makes it hydration-safe.
 */
export function formatStableUtc(value: TimeValue, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(STABLE_LOCALE, {
    ...(options ?? DEFAULT_OPTIONS),
    timeZone: "UTC",
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Relative time ("just now" / "Nm ago" / "Nh ago" / "Nd ago"), falling back to an absolute UTC
 * date at one week or more. `now` is passed in (not read from `Date.now()`) so callers control
 * determinism — the SSR pass uses `formatStableUtc` instead, and the client passes `Date.now()`.
 */
export function formatRelative(value: TimeValue, nowMs: number): string {
  const date = value instanceof Date ? value : new Date(value);
  const diff = nowMs - date.getTime();

  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  return formatStableUtc(date, { year: "numeric", month: "short", day: "numeric" });
}
