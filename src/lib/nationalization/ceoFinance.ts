/**
 * Pure helpers for the National Corporation CEO finance model (spec §5):
 * the CEO sets a profit-retention share (floored so ≥25% always remits to the
 * budget); the minister sets a per-turn treasury-draw cap. No DB access.
 */
import { MAX_PROFIT_RETENTION_PERCENT } from "./constants";

/** Clamp a CEO-set retention to [0, MAX_PROFIT_RETENTION_PERCENT]. */
export function clampRetentionPercent(pct: number | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0;
  return Math.min(MAX_PROFIT_RETENTION_PERCENT, Math.max(0, Math.round(pct)));
}

/** Fraction of operating profit remitted to the budget (the rest is retained). */
export function remitFraction(retentionPercent: number): number {
  return 1 - clampRetentionPercent(retentionPercent) / 100;
}

/**
 * The SOE's actual per-turn remittance, in the corp's local currency: the
 * remitted share of (estimated) operating profit, CAPPED at on-hand
 * `liquidCapital`. A corp can't remit cash it doesn't have — an SOE whose
 * estimate shows "profit" but whose real balance is zero (a loss-backed
 * loss-maker) remits nothing. Single source of truth for both the cash move
 * (`processSoeRemittance`) and the budget revenue line, so the budget reflects
 * only what is actually remitted, never phantom estimated revenue.
 */
export function cappedRemittanceLocal(
  incomeLocal: number,
  retentionPercent: number | undefined,
  liquidCapital: number | undefined
): number {
  if (!(incomeLocal > 0)) return 0;
  const uncapped = Math.round(incomeLocal * remitFraction(retentionPercent ?? 0));
  const available = Math.max(0, Math.round(liquidCapital ?? 0));
  return Math.min(uncapped, available);
}

/**
 * The SOE's remitted share of (estimated) operating profit, in the corp's local
 * currency, WITHOUT the on-hand-cash cap. Used only for the BUDGET REVENUE ESTIMATE
 * of synthetic *scaled* national corps (`budgetRevenueMultiplier > 1`), whose budget
 * line is operating income multiplied by a large bridging factor (≈33k for the UK/JP
 * healthcare stand-ins) and so can NEVER be backed by the corp's tiny game-scale
 * `liquidCapital`. Capping the pre-multiplier remittance at on-hand cash made the
 * (huge) line blink to 0 every turn the corp's cash was drained by `processSoeRemittance`
 * — whipsawing the surplus and inflation. The ACTUAL cash transfer still uses
 * `cappedRemittanceLocal` (you can't move cash you don't have); real-scale SOEs
 * (`multiplier <= 1`) keep the cash cap on their budget line too.
 */
export function uncappedRemittanceLocal(
  incomeLocal: number,
  retentionPercent: number | undefined
): number {
  if (!(incomeLocal > 0)) return 0;
  return Math.round(incomeLocal * remitFraction(retentionPercent ?? 0));
}

/** Local-currency headroom for a draw this turn, given the cap and the turn's tally. */
export function computeDrawAllowance(input: {
  cap: number;
  drawnThisTurn: number;
  sameTurn: boolean;
}): number {
  const cap = Math.max(0, input.cap);
  const used = input.sameTurn ? Math.max(0, input.drawnThisTurn) : 0;
  return Math.max(0, cap - used);
}
