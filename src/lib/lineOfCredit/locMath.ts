import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import type { LocPaymentMode } from "@/lib/db/types/character";

/**
 * Fraction of (deposits + reserves) that the exchange can lend out via LOC.
 * System-wide limit: total outstanding across all borrowers ≤ 70% of the pool.
 */
export const LOC_DEPOSIT_FRACTION = 0.7;

/**
 * Per-player DTI cap: per-turn loan payment may not exceed this fraction of
 * per-turn income. Pairs with {@link LOC_PER_TURN_PAYMENT_RATE} to cap principal
 * at a level whose declining-balance per-turn payment stays within a realistic
 * service window.
 */
export const LOC_DTI_MAX_FRACTION = 0.7;

/**
 * Secondary equity ceiling for total LOC exposure.
 * A borrower cannot owe more than their current economic equity, which stops
 * debt-funded asset purchases from recursively expanding the credit limit.
 */
export const LOC_NET_WORTH_LIMIT_MULTIPLIER = 1;

/**
 * Per-turn auto-payment rate as a fraction of outstanding balance.
 * Real-world mortgages use ~1.625% of principal per **month** as a rule-of-thumb
 * total payment on modest fixed-rate loans; one game month is 4 turns, so the
 * per-turn equivalent is 1.625% / 4 = 0.40625%. Applied to (principal + arrears)
 * after interest accrual each turn. Over ~23 game years a zero-interest loan is
 * ~99% paid off, matching a typical long mortgage horizon.
 */
export const LOC_PER_TURN_PAYMENT_RATE = 0.01625 / 4;

/**
 * Extra spread (percentage points) added to the player's annual rate while a
 * currency's account is in interest-only mode. Applied per-currency, not globally.
 */
export const LOC_IO_SURCHARGE_PERCENT_POINTS = 2.0;

/**
 * Minimum turns the player must wait between flipping paymentMode for the same
 * currency. At 1 turn/hour this is 24 real hours.
 */
export const LOC_PAYMENT_MODE_COOLDOWN_TURNS = 24;

/**
 * Compute the scheduled auto-payment for a borrower with the given outstanding
 * obligation (principal + arrears, post-interest-accrual) in internal units.
 * Rounding is the caller's responsibility.
 */
export function computeAutoPaymentInternal(obligationInternal: number): number {
  if (!Number.isFinite(obligationInternal) || obligationInternal <= 0) return 0;
  return obligationInternal * LOC_PER_TURN_PAYMENT_RATE;
}

/**
 * Scheduled auto-payment for one currency, sized per payment mode.
 *
 * - "pi": current behavior — LOC_PER_TURN_PAYMENT_RATE × (principal + arrears).
 * - "io": pays arrears only (which, immediately after this turn's interest accrual,
 *   equals "freshly-accrued interest + any prior unpaid arrears"). Principal stays flat.
 *
 * Caller is responsible for rounding to currency precision.
 */
export function computeLocScheduledPaymentFace(
  mode: LocPaymentMode,
  principalFace: number,
  arrearsFace: number
): number {
  if (mode === "io") {
    return Math.max(0, arrearsFace);
  }
  const obligation = Math.max(0, principalFace) + Math.max(0, arrearsFace);
  return obligation * LOC_PER_TURN_PAYMENT_RATE;
}

/**
 * Per-player credit limit in internal units derived from Debt-To-Income ratio.
 * Caps the principal so that the scheduled per-turn auto-payment
 * (LOC_PER_TURN_PAYMENT_RATE × balance) stays under LOC_DTI_MAX_FRACTION × per-turn income.
 *
 * cap: LOC_PER_TURN_PAYMENT_RATE × principal ≤ DTI × income_per_turn
 * → max principal = (DTI × income_per_turn) / LOC_PER_TURN_PAYMENT_RATE
 *
 * Returns 0 when income is zero — borrowing requires verified income.
 */
export function computePerPlayerDtiLimitInternal(
  incomePerTurnFace: number,
  homeRate: number
): number {
  if (incomePerTurnFace <= 0 || homeRate <= 0) return 0;
  const incomeInternalPerTurn = toInternalUnits(incomePerTurnFace, homeRate);
  const maxPaymentInternalPerTurn = LOC_DTI_MAX_FRACTION * incomeInternalPerTurn;
  return maxPaymentInternalPerTurn / LOC_PER_TURN_PAYMENT_RATE;
}

/**
 * Equity-based ceiling for total LOC exposure in internal units.
 * Net worth already excludes current LOC debt, so debt-funded bond or stock
 * purchases cannot inflate this ceiling unless the player creates real equity.
 */
export function computePerPlayerNetWorthLimitInternal(netWorthInternal: number): number {
  if (!Number.isFinite(netWorthInternal) || netWorthInternal <= 0) return 0;
  return netWorthInternal * LOC_NET_WORTH_LIMIT_MULTIPLIER;
}

/** Convert currency amount to internal units (local per 1 internal from exchange rate doc). */
export function toInternalUnits(amount: number, rate: number): number {
  if (rate <= 0 || !Number.isFinite(amount)) return 0;
  return amount / rate;
}

/** Convert internal units to currency face amount. */
export function fromInternalUnits(internal: number, rate: number): number {
  if (rate <= 0 || !Number.isFinite(internal)) return 0;
  return internal * rate;
}

export function sumObligationInternal(
  balances: Partial<Record<CurrencyCode, number>>,
  arrears: Partial<Record<CurrencyCode, number>>,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  const codes = new Set([
    ...Object.keys(balances ?? {}),
    ...Object.keys(arrears ?? {}),
  ]) as Set<CurrencyCode>;
  let sum = 0;
  for (const code of codes) {
    const rate = rates[code];
    if (rate === undefined || rate <= 0) continue;
    const p = balances[code] ?? 0;
    const a = arrears[code] ?? 0;
    sum += toInternalUnits(p + a, rate);
  }
  return sum;
}

/**
 * System-wide LOC cap for one currency exchange in internal units.
 * depositsInternal and reservesInternal are the exchange's savings pool and
 * accumulated interest reserves, both converted to internal units by the caller.
 */
export function maxLocForExchangeInternal(
  depositsInternal: number,
  reservesInternal: number
): number {
  const pool = Math.max(0, depositsInternal + reservesInternal);
  return pool * LOC_DEPOSIT_FRACTION;
}

/**
 * Remaining lending capacity for a currency exchange in internal units.
 * totalOutstandingInternal is the sum of all borrowers' principal + arrears
 * for that currency, converted to internal units.
 */
export function availableForExchangeInternal(
  depositsInternal: number,
  reservesInternal: number,
  totalOutstandingInternal: number
): number {
  return Math.max(
    0,
    maxLocForExchangeInternal(depositsInternal, reservesInternal) - totalOutstandingInternal
  );
}

/**
 * Simple interest for one turn on total obligation (principal + arrears) before this turn’s accrual.
 * Accrued interest is intended to be added to arrears by the caller.
 */
export function computeLocInterestForTurn(
  principal: number,
  arrears: number,
  primePercent: number,
  spreadPercentPoints: number,
  currencyCode: CurrencyCode
): number {
  const obligation = principal + arrears;
  if (obligation <= 0) return 0;
  const annual = primePercent + spreadPercentPoints;
  const raw = (obligation * (annual / 100)) / TURNS_PER_YEAR;
  return roundSavingsAmount(raw, currencyCode);
}

/**
 * Apply a payment budget in internal units: reduce arrears first (stable currency order), then principal.
 * Returns updated maps and total internal actually applied.
 */
export function allocateInternalPaymentToLoc(
  payInternal: number,
  principal: Partial<Record<CurrencyCode, number>>,
  arrears: Partial<Record<CurrencyCode, number>>,
  rates: Partial<Record<CurrencyCode, number>>
): {
  principal: Partial<Record<CurrencyCode, number>>;
  arrears: Partial<Record<CurrencyCode, number>>;
  appliedInternal: number;
} {
  if (payInternal <= 0) {
    return {
      principal: { ...principal },
      arrears: { ...arrears },
      appliedInternal: 0,
    };
  }

  let remaining = payInternal;
  const newA: Partial<Record<CurrencyCode, number>> = { ...arrears };
  const newP: Partial<Record<CurrencyCode, number>> = { ...principal };

  const payBucket = (bucket: Partial<Record<CurrencyCode, number>>) => {
    for (const c of FOREX_ACTIVE_CURRENCIES) {
      if (remaining <= 0) break;
      const rate = rates[c];
      if (rate === undefined || rate <= 0) continue;
      const cur = bucket[c] ?? 0;
      if (cur <= 0) continue;
      const curInternal = toInternalUnits(cur, rate);
      const take = Math.min(remaining, curInternal);
      const payFace = fromInternalUnits(take, rate);
      const next = roundSavingsAmount(Math.max(0, cur - payFace), c);
      if (next <= 0) delete bucket[c];
      else bucket[c] = next;
      remaining -= take;
    }
  };

  payBucket(newA);
  payBucket(newP);

  const appliedInternal = payInternal - Math.max(0, remaining);
  return {
    principal: newP,
    arrears: newA,
    appliedInternal,
  };
}
