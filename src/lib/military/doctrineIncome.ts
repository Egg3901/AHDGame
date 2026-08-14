/**
 * National doctrine-point income: one extra point at the start of each game year
 * after the world starts. Scarce on purpose — the tree is 369 points; this is
 * enough to specialise as decades unlock, not enough to clear it.
 *
 * Income is booked against `incomeThroughYear` on the country's doctrine doc so
 * a catch-up grant (opening an office mid-year, or a world that has already
 * ticked past start) cannot double-pay.
 */
export const DOCTRINE_POINTS_PER_YEAR = 1;

/**
 * Points not yet booked for `currentYear`, given the last year income was
 * granted through (or the world start, when nothing has been booked).
 */
export function doctrineIncomeDue(
  startingYear: number,
  currentYear: number,
  incomeThroughYear?: number
): number {
  if (!Number.isFinite(startingYear) || !Number.isFinite(currentYear)) return 0;
  const from = Number.isFinite(incomeThroughYear) ? (incomeThroughYear as number) : startingYear;
  return Math.max(0, currentYear - from) * DOCTRINE_POINTS_PER_YEAR;
}
