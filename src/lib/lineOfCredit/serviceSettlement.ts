import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { runSavingsCommand } from "@/lib/savings/accountsShell";
import { quoteLocService, type LocServiceInput } from "./rules/servicing";
import { locInterestCredits, type LocPlan, type LocEffect } from "./settlement";

export interface ServiceIntent {
  input: LocServiceInput;
  authoritative: CurrencyCode[];
  home: CurrencyCode;
  characterName: string;
}

/** Original service quote survives withdrawal delivery and any subsequent crash. */
export async function prepareServiceEffect(
  db: Db,
  key: string,
  turn: number,
  plan: LocPlan
): Promise<LocEffect> {
  const intent = plan.service!;
  const input = structuredClone(intent.input);
  const initial = quoteLocService(input);
  const withdrawals: Partial<Record<CurrencyCode, number>> = {};
  const refused: CurrencyCode[] = [];
  for (const c of intent.authoritative) {
    const amount = initial.savingsUsed[c] ?? 0;
    if (amount <= 0) continue;
    const result = await runSavingsCommand(
      db,
      plan.characterId,
      c,
      { type: "withdraw", amount },
      `${key}:savings:${c}`
    );
    if (result.ok) withdrawals[c] = amount;
    else {
      input.savings[c] = 0;
      refused.push(c);
    }
  }
  // A refused withdrawal remains savings. Only funded wallet/legacy savings may pay debt.
  const quote = quoteLocService(input);
  const walletInc: Record<string, number> = {};
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const personal = quote.personalUsed[c] ?? 0,
      savings = quote.savingsUsed[c] ?? 0;
    const fromWallet = personal + (intent.authoritative.includes(c) ? savings : 0);
    if (fromWallet > 0) walletInc[`currencyBalances.personal.${c}`] = -fromWallet;
    if (savings > 0 && !intent.authoritative.includes(c))
      walletInc[`currencyBalances.savings.${c}`] = -savings;
  }
  const ledger: LocEffect["ledger"] = [],
    transactions: LocEffect["transactions"] = [];
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    const base = {
      characterId: plan.characterId,
      countryId: getCountryIdForCurrency(c),
      currencyCode: c,
      balanceAfter: quote.locAfter.balances[c] ?? 0,
      arrearsAfter: quote.locAfter.arrears[c] ?? 0,
      turn,
    };
    const meta = {
      primePercent: input.prime[c] ?? 2.5,
      spreadPercentPoints: input.spread,
      centralBankSpreadHikePercentPoints: input.centralBankSpread,
      distress: quote.distress,
      paymentMode: quote.modeByCurrency[c],
      ...(quote.ioSurchargeByCurrency[c]
        ? { ioSurchargePoints: quote.ioSurchargeByCurrency[c] }
        : {}),
    };
    const txBase = {
      turn,
      subjectType: "character" as const,
      subjectId: plan.characterId,
      subjectName: intent.characterName,
      currencyCode: c,
    };
    const interest = quote.interestAccruals[c] ?? 0,
      paid = quote.payments[c] ?? 0;
    if (interest > 0) {
      ledger.push({ ...base, type: "interest", amount: interest, meta });
      transactions.push({ ...txBase, type: "loc_interest", amount: -interest, meta });
    }
    if (paid > 0) {
      const portions = {
        interestPortion: quote.interestPortions[c] ?? 0,
        principalPortion: quote.principalPortions[c] ?? 0,
      };
      ledger.push({
        ...base,
        type: "auto_payment",
        amount: paid,
        ...portions,
        meta: {
          ...meta,
          incomeInternalApplied: quote.appliedInternal,
          ...(quote.crossConverted[c] ? { crossConverted: quote.crossConverted[c] } : {}),
        },
      });
      transactions.push({
        ...txBase,
        type: "loc_repay",
        amount: -paid,
        meta: { ...portions, distress: quote.distress },
      });
    }
  }
  if (quote.distress !== Boolean(input.loc.drawFrozen))
    ledger.push({
      characterId: plan.characterId,
      countryId: getCountryIdForCurrency(intent.home),
      currencyCode: intent.home,
      type: quote.distress ? "freeze" : "unfreeze",
      amount: 0,
      balanceAfter: quote.locAfter.balances[intent.home] ?? 0,
      arrearsAfter: quote.locAfter.arrears[intent.home] ?? 0,
      turn,
    });
  const flows: LocEffect["flows"] = [];
  for (const c of FOREX_ACTIVE_CURRENCIES) {
    for (const [kind, amount, note] of [
      ["debit", quote.consumed[c] ?? 0, "Funded wallet or legacy savings payment"],
      ["credit", quote.interestPortions[c] ?? 0, "Lender interest reserve"],
      ["burn", quote.principalPortions[c] ?? 0, "LOC principal retired"],
    ] as const)
      if (amount > 0) flows.push({ currency: c, kind, amount, note });
  }
  for (const [target, sources] of Object.entries(quote.crossConverted)) {
    for (const [currency, amount] of Object.entries(sources ?? {}))
      if (amount && amount > 0)
        flows.push({
          currency,
          kind: "burn",
          amount,
          note: `Original quoted LOC conversion into ${target}`,
        });
    const received =
      (quote.payments[target as CurrencyCode] ?? 0) -
      (quote.walletPayments[target as CurrencyCode] ?? 0);
    if (received > 0)
      flows.push({
        currency: target,
        kind: "mint",
        amount: received,
        note: "Original quoted cross-currency LOC payment",
      });
  }
  return {
    locAfter: quote.locAfter,
    walletInc,
    reserves: locInterestCredits(quote.interestPortions),
    ledger,
    transactions,
    flows,
    result: {
      charactersProcessed: 1,
      paymentsInternal: quote.appliedInternal,
      interestAccruedInternal: quote.characterInterestAccruedInternal,
      distress: quote.distress,
      refusedSavings: refused,
      withdrawals,
      crossConverted: quote.crossConverted,
      rates: input.rates,
    },
  };
}
