/**
 * The single write path for alignment shares.
 *
 * INVARIANT: every share is a multiple of 0.01 in [0, 100], and
 * `sum(shares) + nonAligned === 100`.
 *
 * Seeding, drift, plays and era crossing ALL route through this function. Any
 * code path that writes `shares` without it is a defect — the invariant is what
 * lets every consumer treat a row as a complete distribution without guarding.
 *
 * WHY HUNDREDTHS, AND WHY THE ARITHMETIC IS INTEGER. Shares were whole numbers,
 * and that quietly destroyed every effect worth less than half a point: a share
 * was re-rounded each turn, so a recurring 0.4 was not "slow", it was nothing at
 * all, forever. Sub-point levers could not accumulate no matter how long they
 * ran. Tenths fixed that for the levers of the day and then hit the same wall
 * one order down: membership drift at 1 point per 24 turns is 0.042 a turn,
 * which rounds to zero on a tenth grid every single turn. A hundredth is fine
 * enough that a lever meant to take game-years to matter can actually run.
 *
 * Every computation below runs in INTEGER hundredths (0–10000) rather than on
 * the decimal values themselves. That is not fussiness: neither 0.1 nor 0.01 has
 * an exact binary representation, so summing decimal shares drifts and the
 * exact-total invariant would fail on floating-point dust. Integers make the
 * apportionment exact; the division happens once, at the very end, purely to
 * present the result.
 *
 * STORED PRECISION IS NOT DISPLAYED PRECISION — though here they happen to
 * agree. Every player-facing share, remainder, lead and trend is written by
 * {@link formatShare}, which fixes two decimals; {@link roundToShareGrid} snaps
 * derived values back onto the storage grid before they reach a gate. The two
 * are separate on purpose: a display rule must never be able to move a
 * threshold.
 */
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";

export interface AlignmentShares {
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
}

/** Resolution of a share: a hundredth of a point. Nothing finer survives a write. */
const UNITS_PER_POINT = 100;
const TOTAL_UNITS = 100 * UNITS_PER_POINT;

/** A value in points → whole hundredths, clamped to the legal range. */
const toUnits = (v: number): number => {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(TOTAL_UNITS, Math.round(v * UNITS_PER_POINT));
};

/** Whole hundredths → points. The only place a decimal share is ever produced. */
const toPoints = (units: number): number => units / UNITS_PER_POINT;

/**
 * Snap a value derived from shares back onto the STORAGE grid.
 *
 * Stored shares are clean, but anything computed FROM them is not: a hundredth
 * has no exact binary form, so `33.44 - 33.14` yields 0.30000000000000071. That
 * is harmless for a threshold test and disastrous for a gate comparison at the
 * boundary. Derived quantities that feed a gate — a lead, above all — round
 * through here so the true value (always a whole number of hundredths) is what
 * the thresholds see.
 */
export const roundToShareGrid = (v: number): number =>
  Math.round(v * UNITS_PER_POINT) / UNITS_PER_POINT;

/**
 * A share as it is written on screen: always two decimals.
 *
 * Fixed width rather than trimmed, because these are read in tabular columns and
 * against each other — "56.00" beside "56.04" shows a nation moving, where "56"
 * beside "56.04" reads as a formatting glitch. Membership drift is 0.04 a turn,
 * so the second digit IS the turn-by-turn story; hiding it would leave a player
 * watching a number that appears frozen for twenty-five turns and then jumps.
 */
export const formatShare = (v: number): string => v.toFixed(2);

/** Signed form of {@link formatShare}, for trends and axis positions. */
export const formatShareDelta = (v: number): string =>
  v > 0 ? `+${formatShare(v)}` : formatShare(v);

export function normalizeShares(
  raw: Partial<Record<AlignmentPoleId, number>>,
  poles: readonly AlignmentPoleId[]
): AlignmentShares {
  // Only poles that exist in this set survive; each is always present, even at
  // zero, so consumers can read a complete distribution.
  const units: Partial<Record<AlignmentPoleId, number>> = {};
  for (const pole of poles) units[pole] = toUnits(raw[pole] ?? 0);

  let total = poles.reduce((sum, p) => sum + (units[p] ?? 0), 0);

  // An over-100 row is malformed, and the only meaningful thing it still
  // carries is the RELATIVE standing of its poles — so scale proportionally
  // rather than shaving. Shaving the largest repeatedly would equalise the
  // poles (80/60 -> 50/50), and shaving only the top until it fits would
  // invert them (80/60 -> 40/60). Both destroy the ordering; scaling keeps it.
  if (total > TOTAL_UNITS) {
    const scale = TOTAL_UNITS / total;
    const exact = poles.map((pole) => ({ pole, value: (units[pole] ?? 0) * scale }));
    let assigned = 0;
    for (const e of exact) {
      units[e.pole] = Math.floor(e.value);
      assigned += units[e.pole] ?? 0;
    }
    // Flooring leaves up to (poles.length - 1) hundredths unassigned. Largest
    // remainder (Hamilton) apportionment gives each to the pole whose exact
    // value was cut by most, which lands closest to the true proportions —
    // 80/60 becomes 57.1/42.9, not the 58/42 that favouring the largest gives.
    const byRemainder = [...exact].sort(
      (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value))
    );
    for (let i = 0; assigned < TOTAL_UNITS; i++, assigned++) {
      const pole = byRemainder[i % byRemainder.length].pole;
      units[pole] = (units[pole] ?? 0) + 1;
    }
    total = TOTAL_UNITS;
  }

  const shares: Partial<Record<AlignmentPoleId, number>> = {};
  for (const pole of poles) shares[pole] = toPoints(units[pole] ?? 0);

  return { shares, nonAligned: toPoints(TOTAL_UNITS - total) };
}
