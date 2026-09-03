/**
 * Loan arithmetic shared by origination, approval and the banking turn.
 *
 * Every number here used to have at least two homes: the instalment was
 * computed in `lendingMath.ts` for the DTI cap and again inline in the turn
 * for the actual charge, the investment-bank headroom rule lived in
 * origination but not in approval, and the NPC book constants sat in the
 * lending module with the servicing loop reading them from a turn file.
 */

import type { BankCharter, BankLoan } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { getCashReserves, type BalanceSheetOptions } from "@/lib/banking/rules/balanceSheet";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { getLendableHeadroom } from "@/lib/banking/rules/reserves";
import { remainingLoanTurns } from "@/lib/banking/rules/lendingMath";

/** Provisional - consecutive shortfall turns before a named loan defaults. */
export const ARREARS_DEFAULT_TURNS = 8;

/** Max fraction of the household target that can migrate or be lent each turn. */
export const MAX_NPC_FLOW_PER_TURN_FRACTION = 0.025;

/** Provisional - each pp of lending rate above this reference shrinks NPC volume. */
export const NPC_LOAN_BOOK_RATE_REFERENCE_PERCENT = 4;

/** Provisional - volume sensitivity per pp above the rate reference. */
export const NPC_LOAN_BOOK_RATE_SENSITIVITY = 0.08;

/** Provisional - floor on the NPC volume rate factor. */
export const NPC_LOAN_BOOK_VOLUME_FACTOR_MIN = 0.2;

/** NPC household borrowing cannot exceed the bank's lendable deposits. */
export const NPC_LOAN_BOOK_VOLUME_FACTOR_MAX = 1;

/** Provisional - base expected default rate (percent) at the default reference rate. */
export const NPC_LOAN_BOOK_DEFAULT_BASE_PERCENT = 1.0;

/** Provisional - each pp of lending rate above this reference raises expected defaults. */
export const NPC_LOAN_BOOK_DEFAULT_RATE_REFERENCE_PERCENT = 6;

/** Provisional - default-rate sensitivity per pp above the default reference. */
export const NPC_LOAN_BOOK_DEFAULT_SENSITIVITY = 0.5;

/** Provisional - floor on expected NPC default rate (percent). */
export const NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT = 0.5;

/** Provisional - ceiling on expected NPC default rate (percent). */
export const NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT = 12;

export type NpcLoanBook = {
  volume: number;
  expectedDefaultRatePercent: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure NPC household loan-book math.
 *
 * volume = lendableDeposits * clamp(1 - (rate - RATE_REF) * SENS, VOL_MIN, VOL_MAX)
 * expectedDefaultRatePercent = clamp(BASE + max(0, rate - DEF_REF) * DEF_SENS, DEF_MIN, DEF_MAX)
 */
export function computeNpcLoanBook(
  lendableDeposits: number,
  lendingRatePercent: number
): NpcLoanBook {
  const funding = Number.isFinite(lendableDeposits) && lendableDeposits > 0 ? lendableDeposits : 0;
  const rate = Number.isFinite(lendingRatePercent) ? lendingRatePercent : 0;

  const volumeFactor = clamp(
    1 - (rate - NPC_LOAN_BOOK_RATE_REFERENCE_PERCENT) * NPC_LOAN_BOOK_RATE_SENSITIVITY,
    NPC_LOAN_BOOK_VOLUME_FACTOR_MIN,
    NPC_LOAN_BOOK_VOLUME_FACTOR_MAX
  );
  const volume = funding * volumeFactor;

  const expectedDefaultRatePercent = clamp(
    NPC_LOAN_BOOK_DEFAULT_BASE_PERCENT +
      Math.max(0, rate - NPC_LOAN_BOOK_DEFAULT_RATE_REFERENCE_PERCENT) *
        NPC_LOAN_BOOK_DEFAULT_SENSITIVITY,
    NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT,
    NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT
  );

  return { volume, expectedDefaultRatePercent };
}

/** Apply a payment against outstanding. Returns the fields to merge onto the loan. */
export function applyLoanPayment(
  loan: Pick<BankLoan, "outstanding" | "status">,
  payment: number
): Pick<BankLoan, "outstanding" | "status"> {
  const pay = Number.isFinite(payment) && payment > 0 ? payment : 0;
  const nextOutstanding = Math.max(0, (loan.outstanding ?? 0) - pay);
  return {
    outstanding: nextOutstanding,
    status: nextOutstanding <= 0 ? "repaid" : loan.status === "arrears" ? "current" : loan.status,
  };
}

/** Mark a loan defaulted. Returns the fields to merge onto the loan. */
export function markLoanDefaulted(
  loan: Pick<BankLoan, "outstanding" | "status">
): Pick<BankLoan, "outstanding" | "status"> {
  return {
    outstanding: loan.outstanding,
    status: "defaulted",
  };
}

/**
 * Cash a bank may put behind a NEW named loan.
 *
 * A bank funded by deposits lends the lendable share of its deposit base after
 * the reserve requirement and the loans already out. A bank with no deposit
 * base (an investment charter) lends its own cash less what it has lent. One
 * rule, read by origination and by the CEO's later approval alike.
 */
export function namedLoanHeadroom(
  charter: Pick<
    BankCharter,
    "type" | "status" | "npcDeposits" | "playerDeposits" | "totalLoans" | "cashReserves"
  >,
  reserveRatio: number,
  options: BalanceSheetOptions = {}
): number {
  if (charterMay(charter, "acceptNpcFunding")) {
    return getLendableHeadroom(charter, reserveRatio, options);
  }
  return Math.max(0, getCashReserves(charter) - Math.max(0, charter.totalLoans ?? 0));
}

/** Per-turn simple interest on a balance at an annual percent rate. */
export function perTurnInterestOn(balance: number, annualPercent: number): number {
  if (!(balance > 0) || !(annualPercent > 0)) return 0;
  return (balance * (annualPercent / 100)) / TURNS_PER_YEAR;
}

/**
 * Per-turn interest on a savings balance, rounded to the currency's minor
 * unit. Matches the central-bank savings pass so a balance earns the same
 * for a given rate whoever holds it.
 */
export function perTurnInterest(
  balance: number,
  annualPercent: number,
  currency: CurrencyCode
): number {
  const raw = perTurnInterestOn(balance, annualPercent);
  return raw > 0 ? roundSavingsAmount(raw, currency) : 0;
}

/**
 * How far a household stock may move toward its target in one turn: inflow
 * and outflow are both capped at a fraction of the larger of current and
 * target, so a book neither appears nor vanishes in a single pass.
 */
export function npcFlowDelta(current: number, target: number): number {
  const cur = Math.max(0, current);
  const desired = target - cur;
  const maxOutflow = MAX_NPC_FLOW_PER_TURN_FRACTION * cur;
  const maxInflow = MAX_NPC_FLOW_PER_TURN_FRACTION * Math.max(target, cur);
  return clamp(desired, -maxOutflow, maxInflow);
}

export interface LoanInstalment {
  interestDue: number;
  principalDue: number;
  paymentDue: number;
  remainingTurns: number;
}

/**
 * This turn's instalment on a named loan: simple interest on the outstanding
 * balance plus straight-line principal over the turns left in the term.
 */
export function namedLoanInstalment(
  loan: Pick<BankLoan, "outstanding" | "ratePercent" | "originatedTurn" | "termTurns">,
  turn: number
): LoanInstalment {
  const outstanding = Math.max(0, loan.outstanding ?? 0);
  const remainingTurns = remainingLoanTurns(loan.originatedTurn, loan.termTurns, turn);
  const interestDue = perTurnInterestOn(outstanding, loan.ratePercent);
  const principalDue = outstanding / remainingTurns;
  return { interestDue, principalDue, paymentDue: interestDue + principalDue, remainingTurns };
}
