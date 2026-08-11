import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Interest accrues every turn but is credited to the savings balance once per quarter (12 turns). */
export const SAVINGS_CREDIT_INTERVAL_TURNS = TURNS_PER_YEAR / 4;

/**
 * Max share of a national savings pool a single account earns interest on
 * (carry-trade fix, #3064 Phase 3). Interest accrues only on the lesser of the
 * account's balance and this fraction of the whole pool, so one actor cannot
 * become ~100% of a currency's savings and farm the entire pool's interest.
 * Only binds on accounts above the share; ordinary savers are unaffected.
 */
export const SAVINGS_POOL_SHARE_CAP = 0.25;

/**
 * The balance a single account earns interest on, given the whole national pool.
 * Caps at {@link SAVINGS_POOL_SHARE_CAP} of the pool. When the pool basis is
 * unknown/zero (no prior-turn stock yet) the full balance is eligible.
 */
export function interestEligibleBalance(balance: number, poolTotal: number): number {
  if (!(poolTotal > 0)) return balance;
  return Math.min(balance, SAVINGS_POOL_SHARE_CAP * poolTotal);
}

/** How many more turns until the next quarterly savings interest credit. */
export function turnsUntilSavingsCredit(currentTurn: number): number {
  return SAVINGS_CREDIT_INTERVAL_TURNS - (currentTurn % SAVINGS_CREDIT_INTERVAL_TURNS);
}

/**
 * Minimum real spread (percentage points) any savings account earns, applied
 * uniformly across every currency. A uniform floor confers no cross-currency
 * advantage, so it cannot be arbitraged — it only keeps low-real-rate currencies
 * from paying literally nothing.
 */
export const SAVINGS_REAL_RATE_FLOOR_PERCENT = 0.5;

/**
 * The savings APY a currency actually pays: half the REAL prime rate
 * (nominal prime − local inflation), floored at {@link SAVINGS_REAL_RATE_FLOOR_PERCENT}/2.
 *
 * Paying the real rate (not the raw nominal prime) is what closes the carry trade:
 * a currency with a high nominal prime also has high inflation, so its real spread —
 * and therefore its savings APY — is similar to everyone else's. Parking money in a
 * high-nominal-rate currency no longer yields a free real return.
 */
export function savingsApyPercent(primeRatePercent: number, inflationPercent: number): number {
  const realRatePercent = Math.max(
    SAVINGS_REAL_RATE_FLOOR_PERCENT,
    primeRatePercent - inflationPercent
  );
  return realRatePercent / 2;
}

/**
 * Per-turn interest on savings: APY = real-rate/2 (see {@link savingsApyPercent}),
 * accrual = simple / TURNS_PER_YEAR. primeRate and inflation are in percent points
 * (e.g. 5.25 for 5.25%). inflationPercent defaults to 0 (nominal) for callers that
 * pass an already-resolved rate; the turn accrual path passes live local inflation.
 */
export function computeSavingsInterestForTurn(
  balance: number,
  primeRatePercent: number,
  currencyCode: CurrencyCode,
  inflationPercent = 0
): number {
  if (balance <= 0 || primeRatePercent <= 0) return 0;
  const apyPercent = savingsApyPercent(primeRatePercent, inflationPercent);
  const raw = (balance * (apyPercent / 100)) / TURNS_PER_YEAR;
  return roundSavingsAmount(raw, currencyCode);
}

/**
 * Same per-turn accrual as {@link computeSavingsInterestForTurn} when given the savings APY
 * (half of prime) instead of the prime rate.
 */
export function estimateSavingsAccrualFromApy(
  balance: number,
  savingsApyPercent: number,
  currencyCode: CurrencyCode
): number {
  if (savingsApyPercent <= 0) return 0;
  return computeSavingsInterestForTurn(balance, savingsApyPercent * 2, currencyCode);
}

/** Round interest/credits to whole yen or 2 decimal places for other currencies. */
export function roundSavingsAmount(amount: number, currencyCode: CurrencyCode): number {
  if (currencyCode === "JPY") {
    return Math.round(amount);
  }
  return Math.round(amount * 100) / 100;
}
