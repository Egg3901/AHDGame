/**
 * Strategy cadence rules (#2693).
 *
 * The NPP strategy loop has two halves with different cadences:
 *
 *   ACCRUAL    recording what the current strategy is achieving. Cheap, runs
 *              for every corporation every turn (`advanceStrategy` always does
 *              it before anything else).
 *   EVALUATION judging the strategy and possibly switching. Only reachable on
 *              the corporation's stagger slot once the tenure window has
 *              elapsed, or on first sight.
 *
 * Everything the evaluation half needs that is expensive to derive (headroom
 * scans over the unowned pools) is therefore only worth computing when the
 * evaluation can actually run. These helpers say when, and when the persisted
 * memory actually needs rewriting. Pure: no db, clock, random or env.
 */

import { NPP_CORP_STRATEGIES, tenureSatisfied, type NppStrategyState } from "../corpStrategy";

/**
 * Whether `advanceStrategy` can reach its switch evaluation this turn. When
 * false the situation inputs beyond the score are never read.
 */
export function strategyEvaluationDue(args: {
  prior: NppStrategyState | undefined;
  turn: number;
  eligible: boolean;
}): boolean {
  const { prior, turn, eligible } = args;
  if (!prior || !NPP_CORP_STRATEGIES.includes(prior.id)) return true;
  return eligible && tenureSatisfied(prior, turn);
}

/** Memoize a derivation so a lazily-read situation field is computed at most once. */
export function memoizeOnce<T>(compute: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = compute();
      done = true;
    }
    return value;
  };
}

/**
 * Whether the persisted strategy memory differs from what the corporation
 * already stores, ignoring `lastScore`. `lastScore` is a per-turn diagnostic
 * that no rule reads (decisions use `baselineScore` and the best-ever
 * `scores`), so rewriting the document every turn just to refresh it is pure
 * write amplification. Identity, adoption turn, baseline and the best-score
 * memory are all still persisted the moment they change.
 */
export function strategyStateNeedsPersist(
  stored: NppStrategyState | undefined,
  next: NppStrategyState
): boolean {
  if (!stored) return true;
  if (stored.id !== next.id) return true;
  if (stored.adoptedTurn !== next.adoptedTurn) return true;
  if (stored.baselineScore !== next.baselineScore) return true;
  const a = stored.scores ?? {};
  const b = next.scores ?? {};
  for (const key of NPP_CORP_STRATEGIES) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}
