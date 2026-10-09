/**
 * Split-step contract for work that moves off the hourly turn.
 *
 * The :30 half tick applies HALF of the coming turn's step to a document and,
 * in the same update, stamps it with `subhourStep: { turn, fraction }` (turn =
 * currentTurn + 1) and stores the start-of-hour values it overwrote under
 * `subhourBase.<system>` (stepBase.ts). Players see and trade at the :30
 * values for the rest of the hour.
 *
 * When the turn starts, rewindHalfTick.ts restores every stamped value from
 * its stored start and clears the stamps, so every phase reads the world it
 * would have read without the tick and the hour's full step lands exactly as
 * before. A tick that was skipped, failed or stopped halfway therefore changes
 * nothing about the hour's result.
 *
 * Per-document stamps, not a global ledger: the tick touches many documents
 * and must stay correct when it stops partway, and a retried tick checks the
 * stamp so it never records its own half-way value as a start value.
 */

/** Share of the hour's step the :30 tick applies. */
export const HALF_TICK_FRACTION = 0.5;

export interface SubhourStepStamp {
  /** The turn whose step was partly applied ahead of time. */
  turn: number;
  /** Share of that turn's step already applied, in (0, 1). */
  fraction: number;
}

export function subhourStepStamp(turn: number, fraction = HALF_TICK_FRACTION): SubhourStepStamp {
  return { turn, fraction };
}

/** Fraction of `turn`'s step still to apply for a document carrying `stamp`. */
export function remainingStepFraction(
  stamp: SubhourStepStamp | null | undefined,
  turn: number
): number {
  if (!stamp || stamp.turn !== turn) return 1;
  const done = Number.isFinite(stamp.fraction) ? Math.min(1, Math.max(0, stamp.fraction)) : 0;
  return 1 - done;
}

/** True when the half tick already applied part of `turn` to this document. */
export function hasSubhourStep(stamp: SubhourStepStamp | null | undefined, turn: number): boolean {
  return remainingStepFraction(stamp, turn) < 1;
}

/**
 * Per-step factor for a smoothing/mean-reversion coefficient `alpha` applied
 * over a fraction `f` of a step, so that applying f then (1 - f) equals one
 * full step exactly: 1 - (1 - alpha)^f.
 */
export function fractionalAlpha(alpha: number, f: number): number {
  if (f >= 1) return alpha;
  if (f <= 0) return 0;
  return 1 - Math.pow(1 - alpha, f);
}
