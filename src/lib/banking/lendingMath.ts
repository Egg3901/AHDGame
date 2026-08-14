/**
 * Named-loan underwriting math. Client-safe: the hub form quotes the same
 * caps originateLoan enforces.
 *
 * Two borrower-cash fractions used to live here (25% of personal, 50% of
 * corp LC). Those capped the people who need the loan on the cash they
 * already hold, and they used the holding company's treasury for a bank
 * that now keeps its own vault in `bankCharter.cashReserves`.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Character named-loan rate = posted lending rate + this spread (pp). */
export const CHARACTER_LOAN_SPREAD_PP = 1.5;

/**
 * Share of demonstrated per-turn income that may go to private-bank debt
 * service. Stricter than the central-bank LOC's 70% DTI: named loans amortize
 * (principal + interest each turn), so 70% would underwrite a huge book.
 * 35% matches the IMF facility income-capture fraction.
 */
export const NAMED_LOAN_DTI_MAX_FRACTION = 0.35;

/** Corp income is a short demonstrated window, not a one-turn spike. */
export const CORP_INCOME_AVERAGING_TURNS = 12;

/** Matches bankingTurn named-loan servicing: interest + straight-line principal. */
export function namedLoanPaymentDue(
  outstanding: number,
  ratePercent: number,
  remainingTurns: number
): number {
  const principal = Math.max(0, Number.isFinite(outstanding) ? outstanding : 0);
  const remaining = Math.max(1, Number.isFinite(remainingTurns) ? remainingTurns : 1);
  const rate = Number.isFinite(ratePercent) ? ratePercent : 0;
  const interestDue = (principal * (rate / 100)) / TURNS_PER_YEAR;
  return interestDue + principal / remaining;
}

export function remainingLoanTurns(
  originatedTurn: number,
  termTurns: number,
  currentTurn: number
): number {
  const originated = Number.isFinite(originatedTurn) ? originatedTurn : currentTurn;
  const term = Number.isFinite(termTurns) ? termTurns : 1;
  const now = Number.isFinite(currentTurn) ? currentTurn : originated;
  return Math.max(1, originated + term - now);
}

/**
 * Largest principal whose first-turn payment fits in leftover DTI budget.
 *
 * payment = P / term + P × (rate/100) / TURNS_PER_YEAR
 * leftover = dti × income − already-committed named-loan payments
 */
export function maxPrincipalFromIncome(input: {
  incomePerTurn: number;
  ratePercent: number;
  termTurns: number;
  committedPaymentPerTurn?: number;
  dtiFraction?: number;
}): number {
  const dti = input.dtiFraction ?? NAMED_LOAN_DTI_MAX_FRACTION;
  const income = Math.max(0, Number.isFinite(input.incomePerTurn) ? input.incomePerTurn : 0);
  const committed = Math.max(
    0,
    Number.isFinite(input.committedPaymentPerTurn) ? (input.committedPaymentPerTurn ?? 0) : 0
  );
  const budget = income * dti - committed;
  if (budget <= 0) return 0;
  const term = Math.max(1, Number.isFinite(input.termTurns) ? input.termTurns : 1);
  const rate = Number.isFinite(input.ratePercent) ? input.ratePercent : 0;
  const perUnit = 1 / term + rate / 100 / TURNS_PER_YEAR;
  if (!(perUnit > 0)) return 0;
  return budget / perUnit;
}

export function namedLoanPrincipalCap(input: {
  bankCashReserves: number;
  lendableHeadroom: number;
  incomeCap: number;
}): number {
  const cash = Math.max(0, Number.isFinite(input.bankCashReserves) ? input.bankCashReserves : 0);
  const headroom = Math.max(
    0,
    Number.isFinite(input.lendableHeadroom) ? input.lendableHeadroom : 0
  );
  const income = Math.max(0, Number.isFinite(input.incomeCap) ? input.incomeCap : 0);
  return Math.min(cash, headroom, income);
}

export type NamedLoanCapBind = "cashReserves" | "headroom" | "income";

export function bindingNamedLoanCap(input: {
  bankCashReserves: number;
  lendableHeadroom: number;
  incomeCap: number;
}): NamedLoanCapBind {
  const cash = Math.max(0, Number.isFinite(input.bankCashReserves) ? input.bankCashReserves : 0);
  const headroom = Math.max(
    0,
    Number.isFinite(input.lendableHeadroom) ? input.lendableHeadroom : 0
  );
  const income = Math.max(0, Number.isFinite(input.incomeCap) ? input.incomeCap : 0);
  if (cash <= headroom && cash <= income) return "cashReserves";
  if (headroom <= income) return "headroom";
  return "income";
}

/** Face amount in `to` given FX rates as local-per-anchor. Same currency is identity. */
export function convertFaceBetweenCurrencies(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fromRate: number,
  toRate: number
): number {
  if (!Number.isFinite(amount)) return 0;
  if (fromCurrency === toCurrency) return Math.max(0, amount);
  if (!(fromRate > 0) || !(toRate > 0)) return 0;
  return (Math.max(0, amount) / fromRate) * toRate;
}
