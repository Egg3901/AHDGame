/**
 * Split-step contract for work that moves off the hourly turn.
 *
 * The :30 half tick applies HALF of the coming turn's step to a document and
 * stamps that document, in the same update, with `subhourStep: { turn, fraction }`
 * where `turn` is the coming turn number (currentTurn + 1). When that turn
 * runs it applies only the remainder for every document it finds stamped for
 * it, and the full step for every document that is not (the tick was
 * skipped, failed, or never reached that document). Hourly totals are
 * therefore the same whether or not the tick ran, and a crash halfway through
 * a tick cannot apply any document's half twice.
 *
 * Per-document stamps, not a global ledger: the tick touches many documents
 * and must stay correct when it stops partway.
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
