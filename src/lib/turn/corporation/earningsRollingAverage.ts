import { FUNDAMENTAL_ROLLING_AVG_TURNS } from "@/lib/constants/corporations";

/**
 * Appends `newValue` to the earnings history and trims to the rolling window.
 * Returns a new array; does not mutate the input.
 */
export function pushEarningsHistory(history: number[] | undefined, newValue: number): number[] {
  const next = [...(history ?? []), newValue];
  return next.slice(-FUNDAMENTAL_ROLLING_AVG_TURNS);
}

/**
 * Returns the arithmetic mean of the history entries, or 0 if empty.
 * Used as `normalizedEarnings` in the earnings-power formula component.
 */
export function normalizedEarningsFromHistory(history: number[]): number {
  if (history.length === 0) return 0;
  return history.reduce((sum, v) => sum + v, 0) / history.length;
}
