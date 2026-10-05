/**
 * Advertising agreement term arithmetic (pure: no db, clock, random, env).
 *
 * Acceptance, settlement, and cancellation all read the same window so they
 * cannot disagree. A command runs against the LAST COMPLETED turn, while the
 * next settlement pass runs on the following turn, so the first unsettled
 * turn is `lastCompletedTurn + 1`. Windows are half-open: a turn `t` settles
 * when `start <= t < end`, so an N-turn term settles exactly N times.
 *
 * Compatibility: agreements stored before term version 2 recorded the last
 * completed turn as the start and measured expiry and notice from it, which
 * dropped one paid turn. `normalizeAgreementTerm` shifts those windows by one
 * turn so in-flight agreements receive their full term too.
 */

/** Stored on agreements written with the first-unsettled-turn boundary. */
export const AD_AGREEMENT_TERM_VERSION = 2;

/** First turn a command issued after `lastCompletedTurn` can still settle. */
export function firstUnsettledTurn(lastCompletedTurn: number): number {
  return lastCompletedTurn + 1;
}

export interface AcceptedTerm {
  startsAtTurn: number;
  /** Exclusive end, absent for open-ended agreements. */
  expiresAtTurn?: number;
}

/** Window written when an offer is accepted on `lastCompletedTurn`. */
export function acceptedTerm(lastCompletedTurn: number, durationTurns?: number): AcceptedTerm {
  const startsAtTurn = firstUnsettledTurn(lastCompletedTurn);
  return durationTurns === undefined
    ? { startsAtTurn }
    : { startsAtTurn, expiresAtTurn: startsAtTurn + durationTurns };
}

/**
 * Exclusive turn on which a notice served on `lastCompletedTurn` takes
 * effect: the notice settles exactly `noticeTurns` more turns.
 */
export function cancelEffectiveTurnFor(lastCompletedTurn: number, noticeTurns: number): number {
  return firstUnsettledTurn(lastCompletedTurn) + noticeTurns;
}

export interface StoredTerm {
  startsAtTurn?: number;
  expiresAtTurn?: number;
  cancelEffectiveTurn?: number;
  termVersion?: number;
}

export interface NormalizedTerm {
  startsAtTurn?: number;
  expiresAtTurn?: number;
  cancelEffectiveTurn?: number;
}

/** Version 2 boundaries for a stored term, shifting legacy documents by one turn. */
export function normalizeAgreementTerm(stored: StoredTerm): NormalizedTerm {
  const shift = stored.termVersion === AD_AGREEMENT_TERM_VERSION ? 0 : 1;
  const bump = (turn: number | undefined) => (turn === undefined ? undefined : turn + shift);
  const startsAtTurn = bump(stored.startsAtTurn);
  const expiresAtTurn = bump(stored.expiresAtTurn);
  const cancelEffectiveTurn = bump(stored.cancelEffectiveTurn);
  return {
    ...(startsAtTurn !== undefined ? { startsAtTurn } : {}),
    ...(expiresAtTurn !== undefined ? { expiresAtTurn } : {}),
    ...(cancelEffectiveTurn !== undefined ? { cancelEffectiveTurn } : {}),
  };
}

/** True when `turn` falls inside the normalized settlement window. */
export function isTurnInTerm(term: NormalizedTerm, turn: number): boolean {
  if (!Number.isFinite(turn)) return false;
  if (term.startsAtTurn !== undefined && turn < term.startsAtTurn) return false;
  if (term.expiresAtTurn !== undefined && turn >= term.expiresAtTurn) return false;
  if (term.cancelEffectiveTurn !== undefined && turn >= term.cancelEffectiveTurn) return false;
  return true;
}

/** True when the term has ended as of `turn` (expiry or served notice reached). */
export function hasTermEnded(term: NormalizedTerm, turn: number): boolean {
  return (
    (term.expiresAtTurn !== undefined && turn >= term.expiresAtTurn) ||
    (term.cancelEffectiveTurn !== undefined && turn >= term.cancelEffectiveTurn)
  );
}
