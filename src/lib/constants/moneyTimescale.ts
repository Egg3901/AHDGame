import { TURNS_PER_DAY, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";

/**
 * The one place that converts a stored money figure into a display period.
 *
 * Every money figure the economy persists (sector revenue, realized revenue,
 * maintenance, wages, growth cost, profit, corp income) is a **daily** rate on
 * the 24-turn financial day. Surfaces used to each do their own arithmetic:
 * the sectors tab offered `/hr` (÷24) and `/yr` (×2), the sector detail page
 * hard-coded `/day` with a per-hour column, and the corporation financials tab
 * repeated the ÷24 and ×2 inline. Same stored number, three different units,
 * no shared label — which is what made the numbers unreadable across screens
 * (player report, #gameplay-advisors, 2026-07-30).
 *
 * `daily` is canonical because it is the basis the values are stored in, so it
 * needs no conversion and cannot drift. The other two are views on it.
 *
 * The annual factor is deliberately 2, not 365: a game year is
 * GROWTH_RATE_TURNS_PER_YEAR (48) turns and a financial day is TURNS_PER_DAY
 * (24) turns, so one game year is two financial days. Deriving it from the two
 * constants keeps it correct if either clock ever moves.
 */
export type MoneyPeriod = "hourly" | "daily" | "annual";

export const MONEY_PERIODS: readonly MoneyPeriod[] = ["hourly", "daily", "annual"] as const;

/** Multiply a stored (daily) figure by this to display it in the given period. */
export const MONEY_PERIOD_FACTOR: Record<MoneyPeriod, number> = {
  hourly: 1 / TURNS_PER_DAY,
  daily: 1,
  annual: GROWTH_RATE_TURNS_PER_YEAR / TURNS_PER_DAY,
};

/** Suffix appended to a formatted amount, e.g. "$1.2M/day". */
export const MONEY_PERIOD_SUFFIX: Record<MoneyPeriod, string> = {
  hourly: "/hr",
  daily: "/day",
  annual: "/yr",
};

/** Human label for headers and toggles. */
export const MONEY_PERIOD_LABEL: Record<MoneyPeriod, string> = {
  hourly: "Hourly",
  daily: "Daily",
  annual: "Annual",
};

/** Short toggle-button text. */
export const MONEY_PERIOD_SHORT: Record<MoneyPeriod, string> = {
  hourly: "Hour",
  daily: "Day",
  annual: "Year",
};

/** Prose form for sentences, e.g. "budget per day". */
export const MONEY_PERIOD_PER_LABEL: Record<MoneyPeriod, string> = {
  hourly: "per hour",
  daily: "per day",
  annual: "per year",
};

/**
 * Explains why a game year is only 2× a day. Shown wherever the period toggle
 * appears, because "annual revenue is twice daily revenue" reads as a bug
 * without it.
 */
export const MONEY_PERIOD_HELP =
  `One turn is one hour. ${TURNS_PER_DAY} turns is one financial day, and ` +
  `${GROWTH_RATE_TURNS_PER_YEAR} turns is one game year. A game year is therefore ` +
  `two financial days, so annual figures are 2× daily figures, not 365×.`;

export function scaleMoney(dailyValue: number, period: MoneyPeriod): number {
  return dailyValue * MONEY_PERIOD_FACTOR[period];
}

/**
 * Inverse of {@link scaleMoney}: turn a figure the player typed or dragged in
 * the displayed period back into the daily rate the API and DB expect.
 */
export function unscaleMoney(displayValue: number, period: MoneyPeriod): number {
  return displayValue / MONEY_PERIOD_FACTOR[period];
}
