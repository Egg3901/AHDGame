/** Player-facing daily reset boundary (cabinet ministerial actions, etc.). */
export const DAILY_RESET_TIMEZONE = "America/New_York";

/**
 * Calendar day (`YYYY-MM-DD`) for `instant` in `timeZone`.
 * Uses `en-CA` so the formatted value is ISO-like and stable for comparisons.
 */
export function getCalendarDayInTimezone(
  instant: Date,
  timeZone: string = DAILY_RESET_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** True when `lastResetDay` is missing or before today's calendar day in `timeZone`. */
export function shouldApplyDailyReset(
  lastResetDay: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = DAILY_RESET_TIMEZONE
): boolean {
  return getCalendarDayInTimezone(now, timeZone) !== lastResetDay;
}
