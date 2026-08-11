/**
 * Phase 7a — Union-busting (`labourSystemMode >= "full"`).
 *
 * A CEO action that suppresses a sector's `unionization` at a cash cost and a
 * chance of backfire. Modeled directly on the existing whip-success pattern
 * (`src/lib/partyWhips/whipSuccess.ts`) — the only existing in-repo precedent
 * for "player-facing chance action, roll wrapped in its own function for
 * testability."
 *
 * RNG note: this is a synchronous CEO API action (like whip-calling), NOT a
 * turn-cron event, so `Math.random()` (via `rollD100`) is the correct RNG
 * here. Anything added to the turn-cron unions pass
 * (`src/lib/turn/unions/index.ts`) must instead use the seeded RNG in
 * `src/lib/events/substrate/rng.ts` — that file's own docblock says never
 * use `Math.random()` in turn paths. Do not "fix" `rollD100` to use the
 * seeded RNG; it would be wrong here.
 */

/** Turns after a busting attempt (success or backfire) before that sector can be busted again. */
export const BUSTING_COOLDOWN_TURNS = 12;

/** Unionization drop (pp) on a successful bust. */
export const BUSTING_SUCCESS_UNIONIZATION_DROP = 20;

/** Unionization spike (pp) on a failed/backfired bust. */
export const BUSTING_BACKFIRE_UNIONIZATION_SPIKE = 15;

const BUSTING_BASE_SUCCESS_CHANCE = 60;
/** Success-chance points lost per 1pp of unionization — a more organized shop is harder to bust. */
const BUSTING_UNIONIZATION_DIFFICULTY_WEIGHT = 0.4;
const BUSTING_MIN_SUCCESS_CHANCE = 20;
const BUSTING_MAX_SUCCESS_CHANCE = 80;

export interface UnionBustingSuccessCalculation {
  baseChance: number;
  unionizationPenalty: number;
  finalChance: number;
}

/**
 * Success chance (0-100) for busting a sector at the given unionization
 * level. Harder to bust a more organized shop — bounded so it's never a sure
 * thing or a sure failure.
 */
export function calculateUnionBustingSuccessChance(
  unionization: number
): UnionBustingSuccessCalculation {
  const u = Math.max(0, Math.min(100, Number.isFinite(unionization) ? unionization : 0));
  const unionizationPenalty = Math.round(u * BUSTING_UNIONIZATION_DIFFICULTY_WEIGHT);
  const finalChance = Math.max(
    BUSTING_MIN_SUCCESS_CHANCE,
    Math.min(BUSTING_MAX_SUCCESS_CHANCE, BUSTING_BASE_SUCCESS_CHANCE - unionizationPenalty)
  );
  return { baseChance: BUSTING_BASE_SUCCESS_CHANCE, unionizationPenalty, finalChance };
}

/** Uniform 1-100 roll. Impure — kept as the single call site of `Math.random()` in this module, separate from the pure decision logic below. */
export function rollD100(): number {
  return Math.floor(Math.random() * 100) + 1;
}

/** Pure success decision: does `roll` beat `finalChance`? Roll is a parameter (not generated here) so tests can be deterministic. */
export function rollUnionBustingOutcome(finalChance: number, roll: number): boolean {
  return roll <= finalChance;
}

/** New `unionization` value after a busting attempt resolves (clamped 0-100). */
export function applyUnionBustingOutcome(unionization: number, success: boolean): number {
  const u = Math.max(0, Math.min(100, Number.isFinite(unionization) ? unionization : 0));
  const delta = success ? -BUSTING_SUCCESS_UNIONIZATION_DROP : BUSTING_BACKFIRE_UNIONIZATION_SPIKE;
  return Math.max(0, Math.min(100, u + delta));
}

/** Cash cost floor so busting a brand-new/tiny sector isn't free. */
export const BUSTING_MIN_COST = 1000;
/** Cash cost as a fraction of the sector's daily gross revenue. */
export const BUSTING_COST_REVENUE_FRACTION = 0.5;

/** Cash cost to attempt a union-busting action, given the sector's daily gross revenue (home currency). */
export function unionBustingCashCost(dailyRevenue: number): number {
  const revenue = Math.max(0, Number.isFinite(dailyRevenue) ? dailyRevenue : 0);
  return Math.max(BUSTING_MIN_COST, Math.round(revenue * BUSTING_COST_REVENUE_FRACTION));
}
