import type { Character } from "@/lib/db/types";
import type { LocPaymentMode } from "@/lib/db/types/character";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import {
  LOC_IO_SURCHARGE_PERCENT_POINTS,
  computeLocInterestForTurn,
  computeLocScheduledPaymentFace,
  toInternalUnits,
} from "../locMath";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
export type CurrencyAmounts = Partial<Record<CurrencyCode, number>>;
export interface LocServiceInput {
  loc: NonNullable<Character["lineOfCredit"]>;
  personal: CurrencyAmounts;
  savings: CurrencyAmounts;
  rates: CurrencyAmounts;
  prime: CurrencyAmounts;
  spread: number;
  centralBankSpread: number;
  incomeInternal: number;
}
/** Original service arithmetic, shared by first delivery and refused-savings requotes. */
export function quoteLocService(input: LocServiceInput) {
  const { loc, rates, spread, incomeInternal } = input;
  const balances: Partial<Record<CurrencyCode, number>> = { ...(loc.balances ?? {}) };
  const arrears: Partial<Record<CurrencyCode, number>> = { ...(loc.arrears ?? {}) };
  let characterInterestAccruedInternal = 0;

  // Capture pre-turn obligation snapshot for logging.
  const preObligationByCurrency: Partial<Record<CurrencyCode, number>> = {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const obligation = (balances[c] ?? 0) + (arrears[c] ?? 0);
    if (obligation > 0) preObligationByCurrency[c] = obligation;
  }

  // 1. Accrue interest per currency onto arrears.
  const interestAccruals: Partial<Record<CurrencyCode, number>> = {};
  const modeByCurrency: Partial<Record<CurrencyCode, LocPaymentMode>> = {};
  const ioSurchargeByCurrency: Partial<Record<CurrencyCode, number>> = {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const P = balances[c] ?? 0;
    const A = arrears[c] ?? 0;
    if (P <= 0 && A <= 0) continue;
    const mode: LocPaymentMode = loc.paymentMode?.[c] ?? "pi";
    modeByCurrency[c] = mode;
    const ioSurcharge = mode === "io" ? LOC_IO_SURCHARGE_PERCENT_POINTS : 0;
    if (ioSurcharge > 0) ioSurchargeByCurrency[c] = ioSurcharge;
    const prime = input.prime[c] ?? 2.5;
    const int = computeLocInterestForTurn(
      P,
      A,
      prime,
      spread + input.centralBankSpread + ioSurcharge,
      c
    );
    if (int <= 0) continue;
    interestAccruals[c] = int;
    arrears[c] = roundSavingsAmount((arrears[c] ?? 0) + int, c);
    const rate = rates[c];
    if (rate && rate > 0) characterInterestAccruedInternal += toInternalUnits(int, rate);
  }

  // 2. Scheduled auto-payment = LOC_PER_TURN_PAYMENT_RATE × (P+A) post-accrual.
  //  The loan currency wallet is used first. If it falls short, other personal
  //  currency balances are auto-converted at market rates to cover the gap.
  //  Only a remaining shortfall after cross-conversion triggers distress/freeze.
  const payments: Partial<Record<CurrencyCode, number>> = {};
  const walletPayments: Partial<Record<CurrencyCode, number>> = {};
  const interestPortions: Partial<Record<CurrencyCode, number>> = {};
  const principalPortions: Partial<Record<CurrencyCode, number>> = {};
  // crossConverted[targetC][sourceC] = face-value of sourceC used to fund targetC payment
  const crossConverted: Partial<Record<CurrencyCode, Partial<Record<CurrencyCode, number>>>> = {};
  let appliedInternal = 0;
  let shortfallAny = false;
  // Total scheduled payment in internal units — used to check if income covers
  // it even when the wallet is empty (e.g. because income was garnished).
  let scheduledInternalTotal = 0;

  // Track available balances (personal wallet + savings) per currency so
  // multi-currency loans don't double-spend. Personal is drained first;
  // savings is overflow. Campaign funds are legally separate and never touched.
  const initialPersonalBalance: Partial<Record<CurrencyCode, number>> = {};
  const availableBalance: Partial<Record<CurrencyCode, number>> = {};
  for (const curr of FOREX_ACTIVE_CURRENCIES) {
    const personal = Math.max(0, input.personal[curr] ?? 0);
    const savings = Math.max(0, input.savings[curr] ?? 0);
    initialPersonalBalance[curr] = personal;
    availableBalance[curr] = personal + savings;
  }

  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const P = balances[c] ?? 0;
    const A = arrears[c] ?? 0;
    const obligation = P + A;
    if (obligation <= 0) continue;
    const mode: LocPaymentMode = modeByCurrency[c] ?? loc.paymentMode?.[c] ?? "pi";
    const scheduled = roundSavingsAmount(computeLocScheduledPaymentFace(mode, P, A), c);
    if (scheduled <= 0) continue;

    const cRate = rates[c];
    if (cRate && cRate > 0) scheduledInternalTotal += toInternalUnits(scheduled, cRate);

    const walletC = availableBalance[c] ?? 0;
    let pay = Math.min(scheduled, walletC);
    const walletPay = pay;

    // If the loan-currency wallet falls short, convert from other currencies.
    if (pay < scheduled - 1e-6) {
      const loanRate = rates[c];
      if (loanRate && loanRate > 0) {
        let remainingShortfall = roundSavingsAmount(scheduled - pay, c);
        // Prefer the currencies with the largest available internal value.
        const candidates = FOREX_ACTIVE_CURRENCIES.filter(
          (other) => other !== c && (availableBalance[other] ?? 0) > 1e-9
        )
          .map((other) => ({ currency: other, rate: rates[other] ?? 0 }))
          .filter((x) => x.rate > 0)
          .sort(
            (a, b) =>
              (availableBalance[b.currency] ?? 0) * b.rate -
              (availableBalance[a.currency] ?? 0) * a.rate
          );

        const convertedSources: Partial<Record<CurrencyCode, number>> = {};
        for (const { currency: other, rate: otherRate } of candidates) {
          if (remainingShortfall <= 1e-9) break;
          const otherAvailable = availableBalance[other] ?? 0;
          // How much of `other` buys `remainingShortfall` of `c` at market rates?
          const otherNeeded = roundSavingsAmount(
            (remainingShortfall * loanRate) / otherRate,
            other
          );
          const otherUsed = Math.min(otherNeeded, otherAvailable);
          if (otherUsed <= 0) continue;
          const loanGained = roundSavingsAmount((otherUsed * otherRate) / loanRate, c);
          if (loanGained <= 0) continue;
          convertedSources[other] = (convertedSources[other] ?? 0) + otherUsed;
          availableBalance[other] = otherAvailable - otherUsed;
          pay = Math.min(scheduled, roundSavingsAmount(pay + loanGained, c));
          remainingShortfall = roundSavingsAmount(Math.max(0, scheduled - pay), c);
        }
        if (Object.keys(convertedSources).length > 0) crossConverted[c] = convertedSources;
      }
    }

    if (pay < scheduled - 1e-6) shortfallAny = true;
    availableBalance[c] = Math.max(0, walletC - walletPay);
    if (pay <= 0) continue;

    // Interest portion settles arrears first; remainder reduces principal.
    const interestPart = roundSavingsAmount(Math.min(pay, A), c);
    const principalPart = roundSavingsAmount(Math.max(0, pay - interestPart), c);
    arrears[c] = roundSavingsAmount(Math.max(0, A - interestPart), c);
    balances[c] = roundSavingsAmount(Math.max(0, (balances[c] ?? 0) - principalPart), c);
    payments[c] = roundSavingsAmount(interestPart + principalPart, c);
    walletPayments[c] = walletPay;
    interestPortions[c] = interestPart;
    principalPortions[c] = principalPart;
    const rate = rates[c];
    if (rate && rate > 0) {
      appliedInternal += toInternalUnits(payments[c] ?? 0, rate);
    }
  }

  // A frozen borrower whose income would cover the scheduled payment should be
  // unfrozen. Their wallet is empty because income was garnished this turn before
  // it could reach them; once unfrozen the garnishment stops and auto-pay runs
  // from wallet normally. Without this check, garnished borrowers can never
  // escape distress even when their income dwarfs the scheduled payment.
  const incomeCoversScheduled =
    loc.drawFrozen && scheduledInternalTotal > 0 && incomeInternal >= scheduledInternalTotal - 1e-6;
  const distress = shortfallAny && !incomeCoversScheduled;
  const drawFrozen = distress;

  // Clear empty currency keys so the LOC document stays tidy.
  const newP: Partial<Record<CurrencyCode, number>> = {};
  const newA: Partial<Record<CurrencyCode, number>> = {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const p = balances[c] ?? 0;
    const a = arrears[c] ?? 0;
    if (p > 0) newP[c] = p;
    if (a > 0) newA[c] = a;
  }

  const consumed: CurrencyAmounts = { ...walletPayments };
  for (const sources of Object.values(crossConverted))
    for (const [code, amount] of Object.entries(sources ?? {}))
      consumed[code as CurrencyCode] = (consumed[code as CurrencyCode] ?? 0) + (amount ?? 0);
  const personalUsed: CurrencyAmounts = {},
    savingsUsed: CurrencyAmounts = {};
  for (const code of FOREX_ACTIVE_CURRENCIES) {
    personalUsed[code] = Math.min(consumed[code] ?? 0, input.personal[code] ?? 0);
    savingsUsed[code] = roundSavingsAmount(
      Math.max(0, (consumed[code] ?? 0) - (personalUsed[code] ?? 0)),
      code
    );
  }
  return {
    locAfter: { ...loc, balances: newP, arrears: newA, drawFrozen },
    consumed,
    personalUsed,
    savingsUsed,
    interestAccruals,
    walletPayments,
    payments,
    interestPortions,
    principalPortions,
    crossConverted,
    modeByCurrency,
    ioSurchargeByCurrency,
    appliedInternal,
    characterInterestAccruedInternal,
    distress,
    preObligationByCurrency,
    shortfallAny,
    scheduledInternalTotal,
  };
}
