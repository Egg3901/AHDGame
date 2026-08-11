/**
 * NPP savings interest (v3 full-agency finance).
 *
 * Mirrors the forex character path in `savingsInterestTurn.ts` — two-phase
 * quarterly compounding — but operates on the `npps` collection using the
 * NPP-mirrored `currencyBalances` fields. Kept in its own function (called from
 * the character phase, gated by v3) so the player accrual logic is untouched.
 *
 * Scope deliberately narrower than the player path: NPP savings do NOT write the
 * player-facing `savingsLedger`, emit tx-log entries, or feed the national
 * savings balance (inflation signal). Those are player UX / macro accounting;
 * the NPP balance + compounding is what the wealth-concentration sim metric
 * needs. Each pass is a single bulkWrite, so this stays cheap at scale.
 */

import type { Db } from "mongodb";
import type { NPP } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import {
  computeSavingsInterestForTurn,
  interestEligibleBalance,
  SAVINGS_CREDIT_INTERVAL_TURNS,
} from "@/lib/currency/savingsInterest";

export async function processNppSavingsInterest(
  db: Db,
  turn: number,
  resolvePrime: (currency: CurrencyCode) => number,
  resolveInflation: (currency: CurrencyCode) => number = () => 0,
  resolvePoolTotal: (currency: CurrencyCode) => number = () => 0
): Promise<{ nppsAccrued: number; totalInterest: number }> {
  // Phase 1: accrue this turn's interest into the pending bucket for any NPP
  // holding savings in an active currency.
  const accrualFilter = {
    $or: FOREX_ACTIVE_CURRENCIES.map((c) => ({
      [`currencyBalances.savings.${c}`]: { $gt: 0 },
    })),
  };
  const accrualNpps = await db
    .collection<NPP>("npps")
    .find(accrualFilter)
    .project({ _id: 1, currencyBalances: 1 })
    .toArray();

  const accrualOps: { updateOne: { filter: object; update: object } }[] = [];
  for (const npp of accrualNpps) {
    const savings = npp.currencyBalances?.savings ?? {};
    const perNppInc: Record<string, number> = {};
    for (const [code, bal] of Object.entries(savings)) {
      const oldBalance = typeof bal === "number" ? bal : 0;
      if (oldBalance <= 0) continue;
      const currency = code as CurrencyCode;
      const prime = resolvePrime(currency);
      const eligible = interestEligibleBalance(oldBalance, resolvePoolTotal(currency));
      const interest = computeSavingsInterestForTurn(
        eligible,
        prime,
        currency,
        resolveInflation(currency)
      );
      if (interest <= 0) continue;
      perNppInc[`currencyBalances.pendingSavingsInterest.${currency}`] = interest;
    }
    if (Object.keys(perNppInc).length > 0) {
      accrualOps.push({ updateOne: { filter: { _id: npp._id }, update: { $inc: perNppInc } } });
    }
  }
  if (accrualOps.length > 0) {
    await db.collection("npps").bulkWrite(accrualOps);
  }

  // Phase 2 (quarterly): flush pending → savings balance + lifetime interestEarned,
  // then zero pending. This is where compounding happens.
  let totalInterest = 0;
  const isQuarterlyCredit = turn > 0 && turn % SAVINGS_CREDIT_INTERVAL_TURNS === 0;
  if (isQuarterlyCredit) {
    const creditFilter = {
      $or: FOREX_ACTIVE_CURRENCIES.map((c) => ({
        [`currencyBalances.pendingSavingsInterest.${c}`]: { $gt: 0 },
      })),
    };
    const creditNpps = await db
      .collection<NPP>("npps")
      .find(creditFilter)
      .project({ _id: 1, currencyBalances: 1 })
      .toArray();

    const creditOps: { updateOne: { filter: object; update: object } }[] = [];
    for (const npp of creditNpps) {
      const pending = npp.currencyBalances?.pendingSavingsInterest ?? {};
      const perNppInc: Record<string, number> = {};
      const perNppSet: Record<string, number> = {};
      for (const [code, pendingAmt] of Object.entries(pending)) {
        const amount = typeof pendingAmt === "number" ? pendingAmt : 0;
        if (amount <= 0) continue;
        const currency = code as CurrencyCode;
        totalInterest += amount;
        perNppInc[`currencyBalances.savings.${currency}`] = amount;
        perNppInc[`currencyBalances.interestEarned.${currency}`] = amount;
        perNppSet[`currencyBalances.pendingSavingsInterest.${currency}`] = 0;
      }
      if (Object.keys(perNppInc).length > 0) {
        creditOps.push({
          updateOne: { filter: { _id: npp._id }, update: { $inc: perNppInc, $set: perNppSet } },
        });
      }
    }
    if (creditOps.length > 0) {
      await db.collection("npps").bulkWrite(creditOps);
    }
  }

  return { nppsAccrued: accrualOps.length, totalInterest };
}
